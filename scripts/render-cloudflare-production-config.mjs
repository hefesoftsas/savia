import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const defaultDocumentsBucket = "savia-documents";
const defaultPublicOrigin = "https://savia.app.hefesoft.com";
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

function authConfig({ authD1Id, publicOrigin }) {
  return {
    $schema: "../../node_modules/wrangler/config-schema.json",
    name: "savia-auth",
    compatibility_date: "2026-08-31",
    compatibility_flags: ["nodejs_compat"],
    main: "src/index.ts",
    workers_dev: false,
    d1_databases: [
      {
        binding: "AUTH_DB",
        database_name: "savia-auth",
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

function apiConfig({ documentsBucket, domainD1Id, publicOrigin }) {
  return {
    $schema: "../../node_modules/wrangler/config-schema.json",
    name: "savia-agencies",
    compatibility_date: "2026-08-31",
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
        name: "REALTIME_RATE_LIMITER",
        namespace_id: "879101",
        simple: { limit: 30, period: 60 },
      },
    ],
    durable_objects: {
      bindings: [{ name: "REALTIME_HUB", class_name: "RealtimeHub" }],
    },
    migrations: [{ tag: "v1", new_sqlite_classes: ["RealtimeHub"] }],
    d1_databases: [
      {
        binding: "DB",
        database_name: "savia-agencies",
        database_id: domainD1Id,
        migrations_dir: "../../packages/db/migrations",
      },
    ],
    r2_buckets: [{ binding: "DOCUMENTS", bucket_name: documentsBucket }],
    vars: {
      NANGO_BASE_URL: "https://nango.cloud.hefesoft.com",
      NANGO_CONNECT_URL: "https://nango-connect.cloud.hefesoft.com",
      NANGO_HUBSPOT_INTEGRATION_ID: "hubspot",
      NANGO_GOOGLE_CALENDAR_INTEGRATION_ID: "google-calendar",
      NANGO_GOOGLE_DRIVE_INTEGRATION_ID: "google-drive",
      NANGO_GMAIL_INTEGRATION_ID: "google-mail",
      NANGO_ONEDRIVE_BUSINESS_INTEGRATION_ID: "one-drive",
      NANGO_ONEDRIVE_PERSONAL_INTEGRATION_ID: "one-drive-personal",
      NANGO_OUTLOOK_INTEGRATION_ID: "outlook",
      SAVIA_API_RESOURCE: publicOrigin,
      SAVIA_OAUTH_ISSUER: `${publicOrigin}/api/auth`,
      SAVIA_PUBLIC_ORIGIN: publicOrigin,
      SAVIA_MCP_URL: privateMcpUrl,
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

function requestsConfig({ domainD1Id }) {
  return {
    name: "savia-request",
    main: "src/server/index.ts",
    compatibility_date: "2026-09-04",
    workers_dev: false,
    preview_urls: false,
    worker_loaders: [{ binding: "LOADER" }],
    d1_databases: [
      {
        binding: "DB",
        database_name: "savia-agencies",
        database_id: domainD1Id,
        migrations_dir: "../../packages/db/migrations",
      },
    ],
    secrets: { required: ["ENCRYPTION_KEY"] },
    observability: { enabled: false },
  };
}

function connectorsConfig({ domainD1Id }) {
  return {
    name: "savia-connectors",
    main: "src/index.ts",
    compatibility_date: "2026-08-31",
    workers_dev: false,
    preview_urls: false,
    d1_databases: [
      {
        binding: "DB",
        database_name: "savia-agencies",
        database_id: domainD1Id,
      },
    ],
    services: [{ binding: "SAVIA_REQUEST", service: "savia-request" }],
    secrets: { required: ["EXTENSION_CONNECTIONS_ENCRYPTION_KEY"] },
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

function gatewayConfig({ publicOrigin }) {
  const hostname = new URL(publicOrigin).hostname;
  return {
    $schema: "../../node_modules/wrangler/config-schema.json",
    name: "savia",
    compatibility_date: "2026-08-31",
    main: "src/edge-gateway.ts",
    routes: [{ custom_domain: true, pattern: hostname }],
    services: [{ binding: "API", service: "savia-agencies" }],
    assets: {
      directory: "./dist",
      binding: "ASSETS",
      not_found_handling: "single-page-application",
      run_worker_first: [
        "/api/*",
        "/v1/*",
        "/.well-known/*",
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
  authD1Id,
  domainD1Id,
  documentsBucket = defaultDocumentsBucket,
  outputRoot,
  publicOrigin = defaultPublicOrigin,
}) {
  if (!["production", "preview"].includes(deploymentEnvironment)) {
    throw new Error("Unsupported deployment environment");
  }
  if (
    deploymentEnvironment === "preview" &&
    (documentsBucket === defaultDocumentsBucket ||
      originValue(publicOrigin) !== "https://savia-preview.hefesoft.com")
  ) {
    throw new Error(
      "preview requires an isolated documents bucket and public origin",
    );
  }
  const rendered = {
    authD1Id: requiredValue(authD1Id, "SAVIA_AUTH_D1_ID"),
    documentsBucket: requiredValue(documentsBucket, "SAVIA_DOCUMENTS_BUCKET"),
    domainD1Id: requiredValue(domainD1Id, "SAVIA_DOMAIN_D1_ID"),
    outputRoot: requiredValue(outputRoot, "SAVIA_DEPLOY_CONFIG_ROOT"),
    publicOrigin: originValue(publicOrigin),
  };

  const configs = {
    auth: authConfig(rendered),
    api: apiConfig(rendered),
    "savia-request": requestsConfig(rendered),
    mcp: mcpConfig(rendered),
    "connector-gateway": connectorsConfig(rendered),
    admin: gatewayConfig(rendered),
  };
  if (openrouterModel) configs.api.vars.OPENROUTER_MODEL = openrouterModel;
  if (deploymentEnvironment === "preview") {
    for (const config of Object.values(configs)) {
      config.name += "-preview";
      for (const binding of config.services ?? [])
        binding.service += "-preview";
      for (const binding of config.d1_databases ?? [])
        binding.database_name += "-preview";
      config.workers_dev = false;
      config.preview_urls = false;
    }
    configs.api.triggers = { crons: [] };
    configs.api.vars.SAVIA_MCP_URL = "https://savia-mcp-preview.internal/mcp";
    configs.admin.vars = {
      CANONICAL_HOST: new URL(rendered.publicOrigin).hostname,
    };
    configs.admin.routes = [
      { custom_domain: true, pattern: new URL(rendered.publicOrigin).hostname },
    ];
  }
  await Promise.all(
    Object.entries(configs).map(([app, config]) =>
      writeConfig(rendered.outputRoot, app, config, deploymentEnvironment),
    ),
  );
}

async function main() {
  await renderProductionConfigs({
    deploymentEnvironment: process.env.SAVIA_DEPLOY_ENVIRONMENT,
    openrouterModel: process.env.OPENROUTER_MODEL,
    authD1Id: process.env.SAVIA_AUTH_D1_ID,
    documentsBucket: process.env.SAVIA_DOCUMENTS_BUCKET,
    domainD1Id: process.env.SAVIA_DOMAIN_D1_ID,
    outputRoot: process.env.SAVIA_DEPLOY_CONFIG_ROOT ?? process.cwd(),
    publicOrigin: process.env.SAVIA_PUBLIC_ORIGIN,
  });
  process.stdout.write("Rendered Cloudflare deployment configuration.\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
