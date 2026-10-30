import assert from "node:assert/strict";
import { mkdtemp, readFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { flowsWorkerConfig } from "./flows-worker-config.mjs";
import { buildSecretUploads } from "../../scripts/upload-cloudflare-secrets.mjs";
import {
  renderProductionConfigs,
  validateTenantSubdomains,
} from "./worker-config.mjs";

const preview = {
  deploymentEnvironment: "preview",
  authD1Id: "auth-id",
  domainD1Id: "domain-id",
  publicOrigin: "https://savia-preview.hefesoft.com",
  documentsBucket: "savia-documents-preview",
};
const production = {
  deploymentEnvironment: "production",
  authD1Id: "auth-id",
  domainD1Id: "domain-id",
  publicOrigin: "https://savia.hefesoft.com",
  documentsBucket: "savia-documents",
};
const flows = {
  databaseId: "flows-db-id",
  kvNamespaceId: "flows-kv-id",
  workerName: "savia-flows-preview",
  workflowName: "savia-flows-execute-preview",
  queueName: "savia-flows-execute-preview",
  deadLetterQueueName: "savia-flows-execute-dlq-preview",
  buckets: {
    resources: "savia-flows-resources-preview",
    datasets: "savia-flows-datasets-preview",
    inboxes: "savia-flows-inboxes-preview",
  },
};
const productionFlows = {
  databaseId: "flows-db-id",
  kvNamespaceId: "flows-kv-id",
  workerName: "savia-flows",
  workflowName: "savia-flows-execute",
  queueName: "savia-flows-execute",
  deadLetterQueueName: "savia-flows-execute-dlq",
  buckets: {
    resources: "savia-flows-resources",
    datasets: "savia-flows-datasets",
    inboxes: "savia-flows-inboxes",
  },
};
const readConfig = async (root, app, environment = "preview") =>
  JSON.parse(
    await readFile(
      join(root, "apps", app, `wrangler.${environment}.jsonc`),
      "utf8",
    ),
  );

test("preview and production API secret manifests match canonical and compatibility uploads", async () => {
  for (const deploymentEnvironment of ["preview", "production"]) {
    for (const secretInput of [
      { STUDIO_INTEGRATION_KEY: "canonical-studio-key" },
      { CRM_INTEGRATION_KEY: "legacy-crm-key" },
    ]) {
      const root = await mkdtemp(join(tmpdir(), "savia-iac-api-secrets-"));
      try {
        const profile =
          deploymentEnvironment === "preview" ? preview : production;
        await renderProductionConfigs({
          ...profile,
          outputRoot: root,
        });
        const api = await readConfig(root, "api", deploymentEnvironment),
          uploads = buildSecretUploads(deploymentEnvironment, {
            BETTER_AUTH_SECRET: "better-auth-secret",
            ASSISTANT_SETTINGS_ENCRYPTION_KEY: "assistant-settings-key",
            EXTENSION_CONNECTIONS_ENCRYPTION_KEY: "extension-connections-key",
            NANGO_API_KEY: "nango-api-key",
            SAVIA_MCP_SHARED_SECRET: "mcp-shared-secret",
            SAVIA_REQUEST_ENCRYPTION_KEY: "request-encryption-key",
            SAVIA_BACKUP_CONTROL_SECRET: "b".repeat(32),
            ...secretInput,
          }).find((entry) => entry.app === "api");
        for (const required of api.secrets.required)
          assert.ok(
            Object.hasOwn(uploads.secrets, required),
            `${deploymentEnvironment} ${required} is not supplied for ${Object.keys(secretInput)[0]}`,
          );
        assert.equal(
          uploads.secrets.STUDIO_INTEGRATION_KEY,
          Object.values(secretInput)[0],
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  }
});

test("final API manifests explicitly clear lifecycle flags left by quiesce and warmup", async () => {
  const lifecycleFlags = [
    "SAVIA_RUNTIME_BOOTSTRAP",
    "SAVIA_RUNTIME_RETIRED",
    "SAVIA_RUNTIME_WARMUP",
    "SAVIA_MAINTENANCE",
    "SAVIA_FLOWS_MAINTENANCE",
  ];
  for (const deploymentEnvironment of ["preview", "production"]) {
    for (const flowsEnabled of [false, true]) {
      const root = await mkdtemp(join(tmpdir(), "savia-iac-runtime-flags-"));
      try {
        const profile =
            deploymentEnvironment === "preview" ? preview : production,
          flowsResources = flowsEnabled
            ? deploymentEnvironment === "preview"
              ? flows
              : productionFlows
            : undefined;
        await renderProductionConfigs({
          ...profile,
          flowsResources,
          flowsExecutionEnabled: flowsEnabled,
          outputRoot: root,
        });
        const api = await readConfig(root, "api", deploymentEnvironment),
          seeded = Object.fromEntries(
            lifecycleFlags.map((flag) => [flag, "true"]),
          ),
          afterQuiesce = {
            ...seeded,
            SAVIA_MAINTENANCE: "true",
            SAVIA_FLOWS_MAINTENANCE: "true",
          },
          afterWarmup = {
            ...afterQuiesce,
            SAVIA_RUNTIME_BOOTSTRAP: "true",
            SAVIA_RUNTIME_WARMUP: "true",
            SAVIA_FLOWS_MAINTENANCE: "true",
            PRESERVED_REMOTE_FLAG: "keep-me",
          },
          finalRuntimeVars = { ...afterWarmup, ...api.vars };
        assert.equal(api.keep_vars, true);
        for (const flag of lifecycleFlags)
          assert.equal(
            finalRuntimeVars[flag],
            "false",
            `${deploymentEnvironment} Flows=${flowsEnabled} retained ${flag}`,
          );
        assert.equal(finalRuntimeVars.PRESERVED_REMOTE_FLAG, "keep-me");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  }
});

test("preview preserves canonical and wildcard tenant gateway routes", async () => {
  const root = await mkdtemp(join(tmpdir(), "savia-iac-tenant-routes-"));
  try {
    await renderProductionConfigs({ ...preview, outputRoot: root });
    const gateway = await readConfig(root, "admin");
    assert.equal(gateway.name, "savia-preview");
    assert.equal(gateway.vars.CANONICAL_HOST, "savia-preview.hefesoft.com");
    assert.deepEqual(gateway.routes, [
      { custom_domain: true, pattern: "savia-preview.hefesoft.com" },
      {
        pattern: "*.savia-preview.hefesoft.com/*",
        zone_name: "hefesoft.com",
      },
    ]);
    await renderProductionConfigs({ ...production, outputRoot: root });
    const productionGateway = JSON.parse(
      await readFile(
        join(root, "apps/admin/wrangler.production.jsonc"),
        "utf8",
      ),
    );
    assert.equal(productionGateway.name, "savia");
    assert.equal(productionGateway.vars.CANONICAL_HOST, "savia.hefesoft.com");
    assert.equal(
      productionGateway.routes.some((route) =>
        route.pattern.includes("savia-preview"),
      ),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preview generates the isolated plugin editor manifest from the infrastructure project", async () => {
  const root = await mkdtemp(join(tmpdir(), "savia-iac-editor-"));
  try {
    await renderProductionConfigs({ ...preview, outputRoot: root });
    const editor = await readConfig(root, "plugin-editor-runtime");
    assert.equal(editor.name, "savia-plugin-editor-preview");
    assert.equal(editor.assets.directory, "../admin/dist-plugin-editor");
    assert.equal(editor.workers_dev, true);
    assert.equal("r2_buckets" in editor, false);
    assert.equal("d1_databases" in editor, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("disabled Flows neither adds a binding nor leaves a generated cloud manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "savia-iac-workers-"));
  try {
    await renderProductionConfigs({ ...preview, outputRoot: root });
    const api = await readConfig(root, "api");
    assert.equal(api.vars.CLOUDFLARE_ENV, "preview");
    assert.equal(api.vars.SAVIA_FLOWS_EXECUTION_ENABLED, "false");
    assert.equal(api.vars.SAVIA_FLOWS_QUOTAS_ENABLED, "false");
    assert.equal(
      api.services.some((b) => b.binding === "SAVIA_FLOWS"),
      false,
    );
    await assert.rejects(
      access(join(root, "apps/flows/api/wrangler.preview.jsonc")),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preview without a reviewed search index does not synthesize search bindings", async () => {
  const root = await mkdtemp(join(tmpdir(), "savia-iac-pages-search-"));
  try {
    await renderProductionConfigs({ ...preview, outputRoot: root });
    const api = await readConfig(root, "api");
    assert.equal("vectorize" in api, false);
    assert.equal("ai" in api, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an explicitly configured search index is retained without native AI inference", async () => {
  const root = await mkdtemp(join(tmpdir(), "savia-iac-pages-search-"));
  try {
    await renderProductionConfigs({
      ...preview,
      flowsResources: flows,
      pagesSearchIndex: "savia-pages-search-preview",
      outputRoot: root,
    });
    const api = await readConfig(root, "api");
    assert.deepEqual(api.vectorize, [
      { binding: "PAGES_VECTORIZE", index_name: "savia-pages-search-preview" },
    ]);
    const configs = await Promise.all(
      [
        "api",
        "auth",
        "savia-request",
        "hook-executor",
        "mcp",
        "connector-gateway",
        "backup-coordinator",
        "admin",
        "plugin-editor-runtime",
        "flows/api",
      ].map((app) => readConfig(root, app)),
    );
    assert.equal(
      configs.some((config) => "ai" in config),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Flows manifest uses stack resource IDs and isolated reciprocal bindings", async () => {
  const root = await mkdtemp(join(tmpdir(), "savia-iac-workers-"));
  try {
    await renderProductionConfigs({
      ...preview,
      flowsResources: flows,
      outputRoot: root,
    });
    const flow = await readConfig(root, "flows/api");
    const api = await readConfig(root, "api");
    assert.equal(flow.name, flows.workerName);
    assert.equal(flow.d1_databases[0].database_id, flows.databaseId);
    assert.equal(flow.kv_namespaces[0].id, flows.kvNamespaceId);
    assert.deepEqual(flow.services, [
      { binding: "SAVIA_HOST", service: "savia-agencies-preview" },
      {
        binding: "CODE_EXECUTOR",
        service: "savia-hook-executor-preview",
        entrypoint: "FlowsExecutor",
      },
    ]);
    assert.ok(
      api.services.some(
        (b) => b.binding === "SAVIA_FLOWS" && b.service === flows.workerName,
      ),
    );
    assert.equal(flow.workflows[0].name, flows.workflowName);
    assert.equal(flow.queues.producers[0].queue, flows.queueName);
    assert.equal(flow.queues.consumers[0].queue, flows.queueName);
    assert.equal(
      flow.queues.consumers[0].dead_letter_queue,
      flows.deadLetterQueueName,
    );
    assert.equal(flow.queues.consumers[0].retry_delay, 60);
    assert.equal(flow.queues.consumers[0].max_retries, 5);
    assert.equal(flow.migrations[0].new_sqlite_classes.length, 5);
    assert.deepEqual(flow.triggers.crons, ["* * * * *"]);
    assert.equal("worker_loaders" in flow, false);
    assert.equal(flow.vars.WEBSITE_URL, preview.publicOrigin);
    assert.equal(flow.vars.SAVIA_FLOWS_LOCAL_ONLY, "true");
    assert.equal(api.vars.CLOUDFLARE_ENV, "preview");
    assert.equal(api.vars.SAVIA_FLOWS_EXECUTION_ENABLED, "false");
    assert.equal(api.vars.SAVIA_FLOWS_QUOTAS_ENABLED, "true");
    for (const [name, value] of Object.entries(flow.vars)) {
      if (name.startsWith("SAVIA_FLOWS_MAX_"))
        assert.equal(api.vars[name], value, name);
    }
    for (const key of [
      "ai",
      "browser",
      "containers",
      "send_email",
      "analytics_engine_datasets",
    ])
      assert.equal(key in flow, false);
    assert.equal(flow.workers_dev, false);
    assert.equal(flow.preview_urls, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("production Flows uses the named private QuickJS executor service binding", async () => {
  const root = await mkdtemp(join(tmpdir(), "savia-iac-workers-"));
  try {
    await renderProductionConfigs({
      ...production,
      flowsResources: productionFlows,
      outputRoot: root,
    });
    const flow = JSON.parse(
      await readFile(
        join(root, "apps/flows/api/wrangler.production.jsonc"),
        "utf8",
      ),
    );
    assert.ok(
      flow.services.some(
        (service) =>
          service.binding === "CODE_EXECUTOR" &&
          service.service === "savia-hook-executor" &&
          service.entrypoint === "FlowsExecutor",
      ),
    );
    assert.equal("worker_loaders" in flow, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("production manifests bind the adopted D1 names from stack outputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "savia-iac-adopted-d1-"));
  try {
    await renderProductionConfigs({
      ...production,
      authDatabaseName: "savia-auth-local-canonical-20260913-v2",
      domainDatabaseName: "savia-agencies-local-canonical-20260913-v2",
      outputRoot: root,
    });
    const auth = JSON.parse(
      await readFile(join(root, "apps/auth/wrangler.production.jsonc"), "utf8"),
    );
    const api = JSON.parse(
      await readFile(join(root, "apps/api/wrangler.production.jsonc"), "utf8"),
    );
    const request = JSON.parse(
      await readFile(
        join(root, "apps/savia-request/wrangler.production.jsonc"),
        "utf8",
      ),
    );
    const connectors = JSON.parse(
      await readFile(
        join(root, "apps/connector-gateway/wrangler.production.jsonc"),
        "utf8",
      ),
    );
    assert.equal(
      auth.d1_databases[0].database_name,
      "savia-auth-local-canonical-20260913-v2",
    );
    for (const config of [api, request, connectors]) {
      assert.equal(
        config.d1_databases[0].database_name,
        "savia-agencies-local-canonical-20260913-v2",
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("production gateway preserves canonical tenant domains without legacy-host routes", async () => {
  const root = await mkdtemp(join(tmpdir(), "savia-iac-tenant-domains-"));
  try {
    await renderProductionConfigs({
      ...production,
      tenantSubdomains: ["tenant-home", "acme-team"],
      outputRoot: root,
    });
    const gateway = await readConfig(root, "admin", "production");
    assert.deepEqual(gateway.routes, [
      { custom_domain: true, pattern: "savia.hefesoft.com" },
      { custom_domain: true, pattern: "tenant-home.savia.hefesoft.com" },
      { custom_domain: true, pattern: "acme-team.savia.hefesoft.com" },
      { pattern: "savia.hefesoft.com/*", zone_name: "hefesoft.com" },
      { pattern: "*.savia.hefesoft.com/*", zone_name: "hefesoft.com" },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tenant subdomains reject reserved labels, wildcards, duplicates, and preview use", async () => {
  const root = await mkdtemp(join(tmpdir(), "savia-iac-tenant-domains-"));
  try {
    for (const tenantSubdomains of [
      ["api"],
      ["*.savia.app.hefesoft.com"],
      ["acme", "acme"],
      ["acme", "ACME"],
      "acme",
    ]) {
      await assert.rejects(
        renderProductionConfigs({
          ...production,
          tenantSubdomains,
          outputRoot: root,
        }),
        /tenant subdomain/i,
      );
    }
    await assert.rejects(
      renderProductionConfigs({
        ...preview,
        tenantSubdomains: ["tenant-home"],
        outputRoot: root,
      }),
      /preview.*tenant subdomain/i,
    );
    await renderProductionConfigs({ ...preview, outputRoot: root });
    const gateway = await readConfig(root, "admin");
    assert.deepEqual(gateway.routes, [
      { custom_domain: true, pattern: "savia-preview.hefesoft.com" },
      { pattern: "*.savia-preview.hefesoft.com/*", zone_name: "hefesoft.com" },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exports tenant-subdomain validation for Pulumi stack outputs", () => {
  assert.deepEqual(validateTenantSubdomains(["Tenant-Home"], "production"), [
    "tenant-home",
  ]);
  assert.throws(() => validateTenantSubdomains(["api"], "production"));
  assert.throws(() =>
    validateTenantSubdomains(["*.example.test"], "production"),
  );
  assert.throws(() => validateTenantSubdomains(["tenant-home"], "preview"));
});

test("preview rejects production Flows resources before generating manifests", async () => {
  const root = await mkdtemp(join(tmpdir(), "savia-iac-workers-"));
  try {
    await assert.rejects(
      renderProductionConfigs({
        ...preview,
        outputRoot: root,
        flowsResources: { ...flows, workerName: "savia-flows" },
      }),
      /Flows|flows|isolat/,
    );
    await assert.rejects(access(join(root, "apps/api/wrangler.preview.jsonc")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("disabling Flows removes an earlier generated manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "savia-iac-workers-"));
  try {
    await renderProductionConfigs({
      ...preview,
      flowsResources: flows,
      outputRoot: root,
    });
    await renderProductionConfigs({ ...preview, outputRoot: root });
    await assert.rejects(
      access(join(root, "apps/flows/api/wrangler.preview.jsonc")),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("execution cannot be enabled from legacy outputs without a dead-letter queue", () => {
  const { deadLetterQueueName, ...legacy } = flows;
  assert.throws(
    () => flowsWorkerConfig(legacy, preview.publicOrigin, "preview", true),
    /dead-letter queue/,
  );
  assert.doesNotThrow(() =>
    flowsWorkerConfig(legacy, preview.publicOrigin, "preview", false),
  );
});

test("all production and preview storage writers share their environment backup barrier", async () => {
  for (const settings of [production, preview]) {
    const root = await mkdtemp(join(tmpdir(), "savia-backup-gate-config-"));
    try {
      await renderProductionConfigs({ ...settings, outputRoot: root });
      const configs = {};
      for (const app of ["api", "auth", "savia-request", "connector-gateway"])
        configs[app] = JSON.parse(
          await readFile(
            join(
              root,
              "apps",
              app,
              `wrangler.${settings.deploymentEnvironment}.jsonc`,
            ),
            "utf8",
          ),
        );
      for (const [app, config] of Object.entries(configs)) {
        assert.equal(config.vars.SAVIA_BACKUP_GATE_REQUIRED, "true");
        const binding = config.durable_objects.bindings.find(
          (value) => value.name === "BACKUP_GATE",
        );
        assert.equal(binding.class_name, "BackupCoordinator");
      }
      const coordinator = JSON.parse(
        await readFile(
          join(
            root,
            "apps",
            "backup-coordinator",
            `wrangler.${settings.deploymentEnvironment}.jsonc`,
          ),
          "utf8",
        ),
      );
      assert.equal(
        coordinator.name,
        settings.deploymentEnvironment === "preview"
          ? "savia-backup-coordinator-preview"
          : "savia-backup-coordinator",
      );
      assert.equal(coordinator.main, "src/index.ts");
      assert.equal(
        coordinator.workers_dev,
        settings.deploymentEnvironment === "production",
      );
      assert.equal(coordinator.preview_urls, false);
      assert.deepEqual(coordinator.services, [
        {
          binding: "AGENCIES",
          service:
            settings.deploymentEnvironment === "preview"
              ? "savia-agencies-preview"
              : "savia-agencies",
        },
      ]);
      assert.deepEqual(coordinator.durable_objects.bindings, []);
      assert.deepEqual(coordinator.migrations, [
        { tag: "v1", new_sqlite_classes: ["BackupCoordinator"] },
      ]);
      assert.equal("d1_databases" in coordinator, false);
      assert.equal("r2_buckets" in coordinator, false);
      assert.equal("vars" in coordinator, false);
      assert.equal("secrets" in coordinator, false);
      for (const config of Object.values(configs))
        assert.equal(
          config.durable_objects.bindings.find(
            (value) => value.name === "BACKUP_GATE",
          ).script_name,
          coordinator.name,
        );
      assert.equal(
        configs.api.migrations.some((value) =>
          value.new_sqlite_classes?.includes("BackupCoordinator"),
        ),
        false,
      );
      assert.equal(
        configs.api.secrets.required.includes("SAVIA_BACKUP_CONTROL_SECRET"),
        settings.deploymentEnvironment === "production",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
