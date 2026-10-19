import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveInfraNames, validateFlowsResources } from "./naming.mjs";
import { flowsWorkerConfig } from "./flows-worker-config.mjs";
import { pluginEditorWorkerConfig } from "./auxiliary-worker-config.mjs";
import { normalizeTenantSlug } from "../../packages/tenant-host/src/tenant-slug.mjs";

const defaultDocumentsBucket = "savia-documents";
const defaultPublicOrigin = "https://savia.hefesoft.com";
const defaultBootstrapEmail = "savia.admin@example.test";
const privateMcpUrl = "https://savia-mcp.internal/mcp";

function requiredValue(value, name) {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`${name} is required`);
  return value.trim();
}

function originValue(value) {
  const origin = new URL(value ?? defaultPublicOrigin);
  if (origin.protocol !== "https:")
    throw new Error("SAVIA_PUBLIC_ORIGIN must use HTTPS");
  return origin.origin;
}

export function validateTenantSubdomains(value, deploymentEnvironment) {
  if (!Array.isArray(value))
    throw new Error(
      "SAVIA_TENANT_SUBDOMAINS must be an array of tenant subdomains",
    );
  const labels = [];
  const seen = new Set();
  for (const candidate of value) {
    const label = normalizeTenantSlug(candidate);
    if (!label) throw new Error("Invalid tenant subdomain label");
    if (seen.has(label))
      throw new Error(`Duplicate tenant subdomain: ${label}`);
    seen.add(label);
    labels.push(label);
  }
  if (deploymentEnvironment === "preview" && labels.length > 0)
    throw new Error("Preview cannot configure production tenant subdomains");
  return labels;
}

function authConfig({ authD1Id, authDatabaseName, publicOrigin }) {
  return {
    $schema: "../../node_modules/wrangler/config-schema.json",
    name: "savia-auth",
    compatibility_date: "2026-08-31",
    compatibility_flags: ["nodejs_compat"],
    main: "src/index.ts",
    workers_dev: false,
    services: [{ binding: "SAVIA_IDENTITY", service: "savia-agencies" }],
    d1_databases: [
      {
        binding: "AUTH_DB",
        database_name: authDatabaseName,
        database_id: authD1Id,
      },
    ],
    vars: {
      BETTER_AUTH_URL: publicOrigin,
      BETTER_AUTH_BOOTSTRAP_EMAIL: defaultBootstrapEmail,
      SAVIA_API_RESOURCE: publicOrigin,
      SAVIA_ADMIN_REDIRECT_URI: `${publicOrigin}/auth/callback`,
      SAVIA_SCALAR_REDIRECT_URI: `${publicOrigin}/docs`,
    },
    secrets: { required: ["BETTER_AUTH_SECRET"] },
  };
}

function apiConfig({
  documentsBucket,
  domainD1Id,
  domainDatabaseName,
  jiraIntegrationId,
  githubIntegrationId,
  zoomIntegrationId,
  slackIntegrationId,
  microsoftTeamsIntegrationId,
  publicOrigin,
}) {
  return {
    $schema: "../../node_modules/wrangler/config-schema.json",
    name: "savia-agencies",
    compatibility_date: "2026-08-31",
    compatibility_flags: ["global_fetch_strictly_public", "nodejs_als"],
    main: "src/index.ts",
    workers_dev: false,
    keep_vars: true,
    observability: { enabled: true, head_sampling_rate: 1 },
    triggers: { crons: ["* * * * *"] },
    services: [
      { binding: "AUTH", service: "savia-auth" },
      { binding: "MCP", service: "savia-mcp" },
      { binding: "SAVIA_REQUEST", service: "savia-request" },
      { binding: "CONNECTOR_GATEWAY", service: "savia-connectors" },
    ],
    ratelimits: [
      {
        name: "PUBLIC_FORMS_RATE_LIMITER",
        namespace_id: "879102",
        simple: { limit: 30, period: 60 },
      },
      {
        name: "REALTIME_RATE_LIMITER",
        namespace_id: "879101",
        simple: { limit: 30, period: 60 },
      },
    ],
    durable_objects: {
      bindings: [
        { name: "REALTIME_HUB", class_name: "RealtimeHub" },
        { name: "WHATSAPP_DISPATCHER", class_name: "WhatsappDispatcher" },
      ],
    },
    migrations: [
      { tag: "v1", new_sqlite_classes: ["RealtimeHub"] },
      { tag: "v2", new_sqlite_classes: ["WhatsappDispatcher"] },
    ],
    d1_databases: [
      {
        binding: "DB",
        database_name: domainDatabaseName,
        database_id: domainD1Id,
        migrations_dir: "../../packages/db/migrations",
      },
    ],
    r2_buckets: [{ binding: "DOCUMENTS", bucket_name: documentsBucket }],
    vars: {
      WHATSAPP_PROCESSING_MODE: "events",
      NANGO_BASE_URL: "https://nango.cloud.hefesoft.com",
      NANGO_CONNECT_URL: "https://nango-connect.cloud.hefesoft.com",
      NANGO_HUBSPOT_INTEGRATION_ID: "hubspot",
      NANGO_GOOGLE_CALENDAR_INTEGRATION_ID: "google-calendar",
      NANGO_GOOGLE_DRIVE_INTEGRATION_ID: "google-drive",
      NANGO_GMAIL_INTEGRATION_ID: "google-mail",
      NANGO_ONEDRIVE_BUSINESS_INTEGRATION_ID: "one-drive",
      NANGO_ONEDRIVE_PERSONAL_INTEGRATION_ID: "one-drive-personal",
      NANGO_OUTLOOK_INTEGRATION_ID: "outlook",
      NANGO_LINEAR_INTEGRATION_ID: "linear",
      NANGO_WHATSAPP_INTEGRATION_ID: "whatsapp-business",
      ...(zoomIntegrationId
        ? { NANGO_ZOOM_INTEGRATION_ID: zoomIntegrationId }
        : {}),
      ...(slackIntegrationId
        ? { NANGO_SLACK_INTEGRATION_ID: slackIntegrationId }
        : {}),
      ...(microsoftTeamsIntegrationId
        ? { NANGO_MICROSOFT_TEAMS_INTEGRATION_ID: microsoftTeamsIntegrationId }
        : {}),
      ...(githubIntegrationId
        ? { NANGO_GITHUB_INTEGRATION_ID: githubIntegrationId }
        : {}),
      ...(jiraIntegrationId
        ? { NANGO_JIRA_INTEGRATION_ID: jiraIntegrationId }
        : {}),
      SAVIA_API_RESOURCE: publicOrigin,
      SAVIA_OAUTH_ISSUER: `${publicOrigin}/api/auth`,
      SAVIA_PUBLIC_ORIGIN: publicOrigin,
      SAVIA_MCP_URL: privateMcpUrl,
      SHLINK_SERVER_URL: "https://go.cloud.hefesoft.com",
    },
    secrets: {
      required: [
        "ASSISTANT_SETTINGS_ENCRYPTION_KEY",
        "CRM_INTEGRATION_KEY",
        "EXTENSION_CONNECTIONS_ENCRYPTION_KEY",
        "NANGO_API_KEY",
        "SAVIA_MCP_SHARED_SECRET",
      ],
    },
  };
}

function requestsConfig({ domainD1Id, domainDatabaseName }) {
  return {
    name: "savia-request",
    main: "src/server/index.ts",
    compatibility_date: "2026-09-04",
    compatibility_flags: ["nodejs_als"],
    workers_dev: false,
    preview_urls: false,
    services: [{ binding: "HOOK_SERVICE", service: "savia-hook-executor" }],
    d1_databases: [
      {
        binding: "DB",
        database_name: domainDatabaseName,
        database_id: domainD1Id,
        migrations_dir: "../../packages/db/migrations",
      },
    ],
    secrets: { required: ["ENCRYPTION_KEY"] },
    observability: { enabled: false },
  };
}

function hookExecutorConfig() {
  return {
    name: "savia-hook-executor",
    main: "src/index.ts",
    compatibility_date: "2026-09-04",
    workers_dev: false,
    preview_urls: false,
    limits: { cpu_ms: 30000 },
    rules: [
      {
        type: "CompiledWasm",
        globs: ["**/*.wasm"],
        fallthrough: true,
      },
    ],
  };
}

function connectorsConfig({ domainD1Id, domainDatabaseName }) {
  return {
    name: "savia-connectors",
    main: "src/index.ts",
    compatibility_date: "2026-08-31",
    compatibility_flags: ["nodejs_als"],
    workers_dev: false,
    preview_urls: false,
    d1_databases: [
      {
        binding: "DB",
        database_name: domainDatabaseName,
        database_id: domainD1Id,
      },
    ],
    services: [{ binding: "SAVIA_REQUEST", service: "savia-request" }],
    secrets: { required: ["EXTENSION_CONNECTIONS_ENCRYPTION_KEY"] },
  };
}

function backupCoordinatorConfig() {
  return {
    $schema: "../../node_modules/wrangler/config-schema.json",
    name: "savia-backup-coordinator",
    compatibility_date: "2026-08-31",
    compatibility_flags: ["nodejs_als"],
    main: "src/index.ts",
    workers_dev: true,
    preview_urls: false,
    services: [{ binding: "AGENCIES", service: "savia-agencies" }],
    durable_objects: { bindings: [] },
    migrations: [{ tag: "v1", new_sqlite_classes: ["BackupCoordinator"] }],
  };
}

function mcpConfig({ publicOrigin }) {
  return {
    $schema: "../../node_modules/wrangler/config-schema.json",
    name: "savia-mcp",
    compatibility_date: "2026-08-31",
    compatibility_flags: ["nodejs_compat"],
    main: "src/worker.ts",
    workers_dev: false,
    services: [{ binding: "API", service: "savia-agencies" }],
    vars: { SAVIA_API_URL: publicOrigin },
    secrets: { required: ["SAVIA_MCP_SHARED_SECRET"] },
  };
}

function gatewayConfig({
  publicOrigin,
  documentsBucket,
  tenantSubdomains,
  runWorkerFirst,
}) {
  const hostname = new URL(publicOrigin).hostname;
  const routes = [
    hostname,
    ...tenantSubdomains.map((label) => `${label}.${hostname}`),
  ].map((pattern) => ({ custom_domain: true, pattern }));
  return {
    $schema: "../../node_modules/wrangler/config-schema.json",
    name: "savia",
    compatibility_date: "2026-08-31",
    main: "src/edge-gateway.ts",
    vars: { CANONICAL_HOST: hostname },
    routes:
      hostname === "savia.hefesoft.com"
        ? [
            ...routes,
            { pattern: `${hostname}/*`, zone_name: "hefesoft.com" },
            { pattern: `*.${hostname}/*`, zone_name: "hefesoft.com" },
            { custom_domain: true, pattern: "savia.app.hefesoft.com" },
            ...[...new Set(["savia-team", ...tenantSubdomains])].map(
              (label) => ({
                custom_domain: true,
                pattern: `${label}.savia.app.hefesoft.com`,
              }),
            ),
            {
              pattern: "*.savia.app.hefesoft.com/*",
              zone_name: "hefesoft.com",
            },
          ]
        : routes,

    services: [{ binding: "API", service: "savia-agencies" }],
    r2_buckets: [{ binding: "OFFICE_RUNTIME", bucket_name: documentsBucket }],
    assets: {
      directory: "./dist",
      binding: "ASSETS",
      not_found_handling: "single-page-application",
      run_worker_first:
        runWorkerFirst && hostname === "savia.hefesoft.com"
          ? true
          : [
              "/companion-downloads.json",
              "/register",
              "/public/forms",
              "/public/forms/*",
              "/public/bookings",
              "/public/bookings/*",
              "/public/quotes",
              "/public/quotes/*",
              "/office",
              "/office/*",
              "/api/*",
              "/v1/*",
              "/webhooks/whatsapp",
              "/s/*",
              "/.well-known/*",
              "/mcp",
              "/health",
              "/docs",
              "/openapi.json",
            ],
    },
  };
}

async function writeConfig(outputRoot, app, config, deploymentEnvironment) {
  const file = join(
    outputRoot,
    "apps",
    app,
    `wrangler.${deploymentEnvironment}.jsonc`,
  );
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
}

export async function renderProductionConfigs({
  deploymentEnvironment = "production",
  openrouterModel,
  pagesSearchIndex,
  flowsResources,
  flowsExecutionEnabled = false,
  tenantSubdomains = [],
  authD1Id,
  authDatabaseName,
  domainD1Id,
  domainDatabaseName,
  documentsBucket = defaultDocumentsBucket,
  jiraIntegrationId,
  githubIntegrationId,
  zoomIntegrationId,
  slackIntegrationId,
  microsoftTeamsIntegrationId,
  outputRoot,
  publicOrigin = defaultPublicOrigin,
}) {
  if (!["production", "preview"].includes(deploymentEnvironment)) {
    throw new Error("Unsupported deployment environment");
  }
  const normalizedTenantSubdomains = validateTenantSubdomains(
    tenantSubdomains,
    deploymentEnvironment,
  );
  if (
    deploymentEnvironment === "preview" &&
    (documentsBucket === defaultDocumentsBucket ||
      originValue(publicOrigin) !== "https://savia-preview.hefesoft.com")
  ) {
    throw new Error(
      "preview requires an isolated documents bucket and public origin",
    );
  }
  const flows = validateFlowsResources(flowsResources, deploymentEnvironment);
  const resolvedNames = resolveInfraNames({
    environment: deploymentEnvironment,
    documentsBucket,
    publicOrigin,
    ...(deploymentEnvironment === "production"
      ? { authDatabaseName, domainDatabaseName }
      : {}),
  });
  if (
    deploymentEnvironment === "preview" &&
    ((authDatabaseName !== undefined &&
      authDatabaseName !== resolvedNames.databases.auth) ||
      (domainDatabaseName !== undefined &&
        domainDatabaseName !== resolvedNames.databases.domain))
  ) {
    throw new Error(
      "Preview D1 names do not match isolated infrastructure outputs",
    );
  }
  if (
    typeof flowsExecutionEnabled !== "boolean" ||
    (flowsExecutionEnabled && !flows)
  ) {
    throw new Error("Invalid Flows execution setting");
  }
  const rendered = {
    authD1Id: requiredValue(authD1Id, "SAVIA_AUTH_D1_ID"),
    authDatabaseName: resolvedNames.databases.auth,
    documentsBucket: requiredValue(documentsBucket, "SAVIA_DOCUMENTS_BUCKET"),
    domainD1Id: requiredValue(domainD1Id, "SAVIA_DOMAIN_D1_ID"),
    domainDatabaseName: resolvedNames.databases.domain,
    outputRoot: requiredValue(outputRoot, "SAVIA_DEPLOY_CONFIG_ROOT"),
    publicOrigin: originValue(publicOrigin),
    tenantSubdomains: normalizedTenantSubdomains,
    ...(zoomIntegrationId?.trim()
      ? {
          zoomIntegrationId: requiredValue(
            zoomIntegrationId,
            "NANGO_ZOOM_INTEGRATION_ID",
          ),
        }
      : {}),
    ...(slackIntegrationId?.trim()
      ? { slackIntegrationId: slackIntegrationId.trim() }
      : {}),
    ...(microsoftTeamsIntegrationId?.trim()
      ? { microsoftTeamsIntegrationId: microsoftTeamsIntegrationId.trim() }
      : {}),
    ...(githubIntegrationId?.trim()
      ? {
          githubIntegrationId: requiredValue(
            githubIntegrationId,
            "NANGO_GITHUB_INTEGRATION_ID",
          ),
        }
      : {}),
    ...(jiraIntegrationId?.trim()
      ? {
          jiraIntegrationId: requiredValue(
            jiraIntegrationId,
            "NANGO_JIRA_INTEGRATION_ID",
          ),
        }
      : {}),
  };

  const configs = {
    auth: authConfig(rendered),
    api: apiConfig(rendered),
    "savia-request": requestsConfig(rendered),
    "hook-executor": hookExecutorConfig(),
    mcp: mcpConfig(rendered),
    "connector-gateway": connectorsConfig(rendered),
    "backup-coordinator": backupCoordinatorConfig(),
    admin: gatewayConfig({
      ...rendered,
      runWorkerFirst: deploymentEnvironment === "production",
    }),
  };
  // One namespace per deployment environment, shared by every D1/R2 writer.
  // Cross-script names are resolved after preview worker names are rewritten.
  for (const app of ["api", "auth", "savia-request", "connector-gateway"]) {
    const config = configs[app];
    config.vars = { ...config.vars, SAVIA_BACKUP_GATE_REQUIRED: "true" };
    config.durable_objects ??= { bindings: [] };
    config.durable_objects.bindings.push({
      name: "BACKUP_GATE",
      class_name: "BackupCoordinator",
      script_name: configs["backup-coordinator"].name,
    });
  }
  if (deploymentEnvironment === "production")
    configs.api.secrets.required.push("SAVIA_BACKUP_CONTROL_SECRET");
  if (openrouterModel) configs.api.vars.OPENROUTER_MODEL = openrouterModel;
  const searchIndex =
    pagesSearchIndex?.trim() ||
    (deploymentEnvironment === "preview"
      ? "savia-pages-search-preview"
      : undefined);
  if (searchIndex) {
    if (
      deploymentEnvironment === "preview" &&
      searchIndex !== "savia-pages-search-preview"
    )
      throw new Error("Preview requires an isolated Pages search index");
    if (
      deploymentEnvironment === "production" &&
      searchIndex === "savia-pages-search-preview"
    )
      throw new Error("Production cannot use the preview Pages search index");
    configs.api.ai = { binding: "AI" };
    configs.api.ratelimits.push({
      name: "PAGES_SEARCH_RATE_LIMITER",
      namespace_id: deploymentEnvironment === "preview" ? "879104" : "879103",
      simple: { limit: 30, period: 60 },
    });
    configs.api.vectorize = [
      { binding: "PAGES_VECTORIZE", index_name: searchIndex },
    ];
  }
  if (deploymentEnvironment === "preview") {
    for (const config of Object.values(configs)) {
      config.name += "-preview";
      for (const binding of config.services ?? [])
        binding.service += "-preview";
      config.workers_dev = false;
      config.preview_urls = false;
    }
    configs.api.triggers = { crons: ["* * * * *"] };
    configs.api.vars.CLOUDFLARE_ENV = "preview";
    configs.api.vars.SAVIA_WORKFLOW_ONLY_SCHEDULE = "true";
    configs.api.vars.SAVIA_MAINTENANCE = "false";
    configs.api.vars.SAVIA_FLOWS_EXECUTION_ENABLED = String(
      Boolean(flows) && flowsExecutionEnabled,
    );
    configs.api.vars.SAVIA_FLOWS_QUOTAS_ENABLED = String(Boolean(flows));
    configs.api.vars.SAVIA_FLOWS_EXTERNAL_SERVICES_ENABLED = "false";
    configs.api.vars.COMPANION_ENABLED = "true";
    configs.api.vars.SAVIA_MCP_URL = "https://savia-mcp-preview.internal/mcp";
    configs.admin.vars = {
      CANONICAL_HOST: new URL(rendered.publicOrigin).hostname,
    };
    configs.admin.routes = [
      { custom_domain: true, pattern: new URL(rendered.publicOrigin).hostname },
      // Preserve the existing tenant route; Custom Domains cannot use wildcards.
      {
        pattern: `*.${new URL(rendered.publicOrigin).hostname}/*`,
        zone_name: "hefesoft.com",
      },
    ];
  }
  for (const app of ["api", "auth", "savia-request", "connector-gateway"])
    configs[app].durable_objects.bindings.find(
      (binding) => binding.name === "BACKUP_GATE",
    ).script_name = configs["backup-coordinator"].name;
  if (deploymentEnvironment === "preview") {
    configs["plugin-editor-runtime"] = pluginEditorWorkerConfig({
      outputRoot: rendered.outputRoot,
    });
  }
  if (flows) {
    configs["flows/api"] = flowsWorkerConfig(
      flows,
      rendered.publicOrigin,
      deploymentEnvironment,
      flowsExecutionEnabled,
    );
    configs.api.services.push({
      binding: "SAVIA_FLOWS",
      service: flows.workerName,
    });
    configs.api.secrets.required.push("SAVIA_FLOWS_BRIDGE_SECRET");
    configs.api.vars.SAVIA_MAINTENANCE = "false";
    configs.api.vars.SAVIA_FLOWS_EXECUTION_ENABLED = String(
      flowsExecutionEnabled,
    );
    configs.api.vars.SAVIA_FLOWS_QUOTAS_ENABLED = "true";
    configs.api.vars.SAVIA_FLOWS_EXTERNAL_SERVICES_ENABLED = "false";
    for (const [name, value] of Object.entries(configs["flows/api"].vars)) {
      if (name.startsWith("SAVIA_FLOWS_MAX_")) configs.api.vars[name] = value;
    }
  } else {
    // A stale generated file must not accidentally activate a disabled module.
    await rm(
      join(
        rendered.outputRoot,
        "apps/flows/api",
        `wrangler.${deploymentEnvironment}.jsonc`,
      ),
      { force: true },
    );
  }
  await Promise.all(
    Object.entries(configs).map(([app, config]) =>
      writeConfig(rendered.outputRoot, app, config, deploymentEnvironment),
    ),
  );
}

export async function renderCloudflareConfigFromEnv(env = process.env) {
  await renderProductionConfigs({
    deploymentEnvironment: env.SAVIA_DEPLOY_ENVIRONMENT,
    openrouterModel: env.OPENROUTER_MODEL,
    authD1Id: env.SAVIA_AUTH_D1_ID,
    authDatabaseName: env.SAVIA_AUTH_D1_NAME,
    documentsBucket: env.SAVIA_DOCUMENTS_BUCKET,
    domainD1Id: env.SAVIA_DOMAIN_D1_ID,
    domainDatabaseName: env.SAVIA_DOMAIN_D1_NAME,
    pagesSearchIndex: env.SAVIA_PAGES_SEARCH_INDEX,
    flowsExecutionEnabled: env.SAVIA_FLOWS_EXECUTION_ENABLED === "true",
    tenantSubdomains: env.SAVIA_TENANT_SUBDOMAINS
      ? JSON.parse(env.SAVIA_TENANT_SUBDOMAINS)
      : [],
    flowsResources: env.SAVIA_FLOWS_RESOURCES
      ? JSON.parse(env.SAVIA_FLOWS_RESOURCES)
      : null,
    jiraIntegrationId: env.NANGO_JIRA_INTEGRATION_ID,
    githubIntegrationId: env.NANGO_GITHUB_INTEGRATION_ID,
    zoomIntegrationId: env.NANGO_ZOOM_INTEGRATION_ID,
    slackIntegrationId: env.NANGO_SLACK_INTEGRATION_ID,
    microsoftTeamsIntegrationId: env.NANGO_MICROSOFT_TEAMS_INTEGRATION_ID,
    outputRoot: env.SAVIA_DEPLOY_CONFIG_ROOT ?? process.cwd(),
    publicOrigin: env.SAVIA_PUBLIC_ORIGIN,
  });
  process.stdout.write("Rendered Cloudflare deployment configuration.\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  renderCloudflareConfigFromEnv().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
