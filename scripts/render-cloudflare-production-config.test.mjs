import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { renderProductionConfigs } from "./render-cloudflare-production-config.mjs";

async function config(outputRoot, worker) {
  return JSON.parse(
    await readFile(
      join(outputRoot, `apps/${worker}/wrangler.production.jsonc`),
      "utf8",
    ),
  );
}

test("writes only the supported production workers and retains their runtime settings", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "savia-cloudflare-config-"));

  try {
    await renderProductionConfigs({
      authD1Id: "auth-d1-id",
      domainD1Id: "domain-d1-id",
      outputRoot,
    });

    const auth = await config(outputRoot, "auth");
    const api = await config(outputRoot, "api");
    const mcp = await config(outputRoot, "mcp");
    const providers = await config(outputRoot, "savia-request");
    const admin = await config(outputRoot, "admin");
    const connectors = await config(outputRoot, "connector-gateway");

    assert.equal(auth.name, "savia-auth");
    assert.equal(auth.d1_databases[0].database_id, "auth-d1-id");
    assert.equal(auth.vars.BETTER_AUTH_URL, "https://savia.app.hefesoft.com");
    assert.equal(
      auth.vars.BETTER_AUTH_BOOTSTRAP_EMAIL,
      "savia.admin@example.test",
    );
    assert.equal("BETTER_AUTH_SECRET" in auth.vars, false);
    assert.deepEqual(auth.secrets, { required: ["BETTER_AUTH_SECRET"] });
    assert.equal(api.name, "savia-agencies");
    assert.equal(api.d1_databases[0].database_id, "domain-d1-id");
    assert.equal(api.r2_buckets[0].bucket_name, "savia-documents");
    assert.deepEqual(api.services, [
      { binding: "AUTH", service: "savia-auth" },
      { binding: "MCP", service: "savia-mcp" },
      { binding: "SAVIA_REQUEST", service: "savia-request" },
      { binding: "CONNECTOR_GATEWAY", service: "savia-connectors" },
    ]);
    assert.equal(api.vars.SAVIA_MCP_URL, "https://savia-mcp.internal/mcp");
    assert.equal("OPENROUTER_MODEL" in api.vars, false);
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(api.vars).filter(([key]) => key.startsWith("NANGO_")),
      ),
      {
        NANGO_BASE_URL: "https://nango.cloud.hefesoft.com",
        NANGO_CONNECT_URL: "https://nango-connect.cloud.hefesoft.com",
        NANGO_HUBSPOT_INTEGRATION_ID: "hubspot",
        NANGO_GOOGLE_CALENDAR_INTEGRATION_ID: "google-calendar",
        NANGO_GOOGLE_DRIVE_INTEGRATION_ID: "google-drive",
        NANGO_GMAIL_INTEGRATION_ID: "google-mail",
        NANGO_ONEDRIVE_BUSINESS_INTEGRATION_ID: "one-drive",
        NANGO_ONEDRIVE_PERSONAL_INTEGRATION_ID: "one-drive-personal",
        NANGO_OUTLOOK_INTEGRATION_ID: "outlook",
      },
    );
    assert.equal(api.keep_vars, true);
    assert.deepEqual(api.triggers, { crons: ["* * * * *"] });
    assert.deepEqual(api.observability, {
      enabled: true,
      head_sampling_rate: 1,
    });
    assert.deepEqual(api.secrets, {
      required: [
        "ASSISTANT_SETTINGS_ENCRYPTION_KEY",
        "CRM_INTEGRATION_KEY",
        "EXTENSION_CONNECTIONS_ENCRYPTION_KEY",
        "NANGO_API_KEY",
        "SAVIA_MCP_SHARED_SECRET",
      ],
    });
    assert.equal("OPENROUTER_API_KEY" in api.vars, false);
    assert.equal("ASSISTANT_SETTINGS_ENCRYPTION_KEY" in api.vars, false);
    assert.equal("SAVIA_MCP_SHARED_SECRET" in api.vars, false);
    await assert.rejects(
      config(outputRoot, "legacy-api"),
      (error) => error?.code === "ENOENT",
    );
    assert.equal(mcp.name, "savia-mcp");
    assert.equal(mcp.main, "src/worker.ts");
    assert.equal(mcp.workers_dev, false);
    assert.deepEqual(mcp.services, [
      { binding: "API", service: "savia-agencies" },
    ]);
    assert.equal(mcp.vars.SAVIA_API_URL, "https://savia.app.hefesoft.com");
    assert.equal("SAVIA_MCP_SHARED_SECRET" in mcp.vars, false);
    assert.deepEqual(mcp.secrets, {
      required: ["SAVIA_MCP_SHARED_SECRET"],
    });
    assert.equal(providers.name, "savia-request");
    assert.equal(providers.main, "src/server/index.ts");
    assert.equal(providers.workers_dev, false);
    assert.equal("routes" in providers, false);
    assert.equal(providers.d1_databases[0].binding, "DB");
    assert.equal(providers.d1_databases[0].database_id, "domain-d1-id");
    assert.equal("ENCRYPTION_KEY" in (providers.vars ?? {}), false);
    assert.deepEqual(providers.secrets, {
      required: ["ENCRYPTION_KEY"],
    });
    assert.equal(connectors.name, "savia-connectors");
    assert.equal(connectors.workers_dev, false);
    assert.equal(connectors.preview_urls, false);
    assert.equal("routes" in connectors, false);
    assert.equal(connectors.d1_databases[0].database_id, "domain-d1-id");
    assert.deepEqual(connectors.services, [
      { binding: "SAVIA_REQUEST", service: "savia-request" },
    ]);
    assert.deepEqual(connectors.secrets, {
      required: ["EXTENSION_CONNECTIONS_ENCRYPTION_KEY"],
    });
    assert.equal(admin.name, "savia");
    assert.deepEqual(admin.routes, [
      { custom_domain: true, pattern: "savia.app.hefesoft.com" },
    ]);
    assert.ok(admin.assets.run_worker_first.includes("/health"));
    assert.equal(admin.assets.not_found_handling, "single-page-application");
  } finally {
    await rm(outputRoot, { force: true, recursive: true });
  }
});

test("rejects an empty D1 identifier before rendering files", async () => {
  await assert.rejects(
    renderProductionConfigs({
      authD1Id: "",
      domainD1Id: "domain-d1-id",
      outputRoot: "/tmp/savia-config-not-written",
    }),
    /SAVIA_AUTH_D1_ID is required/,
  );
});

test("preview isolates worker names, bindings, origins, storage and schedules", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "savia-preview-config-"));
  try {
    await renderProductionConfigs({
      deploymentEnvironment: "preview",
      authD1Id: "preview-auth-id",
      domainD1Id: "preview-domain-id",
      documentsBucket: "savia-documents-preview",
      publicOrigin: "https://savia-preview.hefesoft.com",
      outputRoot,
    });
    for (const app of [
      "auth",
      "api",
      "mcp",
      "savia-request",
      "connector-gateway",
      "admin",
    ]) {
      const conf = JSON.parse(
        await readFile(
          join(outputRoot, `apps/${app}/wrangler.preview.jsonc`),
          "utf8",
        ),
      );
      assert.ok(conf.name.endsWith("-preview"));
      for (const binding of conf.services ?? [])
        assert.ok(binding.service.endsWith("-preview"));
      for (const binding of conf.d1_databases ?? [])
        assert.ok(binding.database_id.startsWith("preview-"));
      if (app === "api") {
        assert.deepEqual(conf.triggers, { crons: [] });
        assert.equal(conf.r2_buckets[0].bucket_name, "savia-documents-preview");
        assert.equal(
          conf.vars.SAVIA_MCP_URL,
          "https://savia-mcp-preview.internal/mcp",
        );
      }
      if (app === "admin") {
        assert.equal(conf.vars.CANONICAL_HOST, "savia-preview.hefesoft.com");
        assert.deepEqual(conf.routes, [
          { custom_domain: true, pattern: "savia-preview.hefesoft.com" },
        ]);
      }
    }
    await assert.rejects(
      readFile(join(outputRoot, "apps/api/wrangler.production.jsonc")),
      /ENOENT/,
    );
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("preview refuses production storage defaults and unknown environments", async () => {
  const base = {
    authD1Id: "auth",
    domainD1Id: "domain",
    outputRoot: "/tmp/savia-refused",
  };
  await assert.rejects(
    renderProductionConfigs({ ...base, deploymentEnvironment: "other" }),
    /environment/,
  );
  await assert.rejects(
    renderProductionConfigs({ ...base, deploymentEnvironment: "preview" }),
    /preview/,
  );
});

test("preview rejects every normalized production origin and unknown preview host", async () => {
  for (const publicOrigin of [
    "https://savia.app.hefesoft.com/",
    "https://SAVIA.APP.HEFESOFT.COM",
    "https://savia.app.hefesoft.com:443/path",
    "https://savia-preview.hefesoft.com:8443",
    "https://other.example.test",
  ]) {
    await assert.rejects(
      renderProductionConfigs({
        deploymentEnvironment: "preview",
        authD1Id: "preview-auth",
        domainD1Id: "preview-domain",
        documentsBucket: "savia-documents-preview",
        publicOrigin,
        outputRoot: "/tmp/savia-refused",
      }),
      /preview/,
    );
  }
});
