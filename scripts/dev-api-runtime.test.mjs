import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { prepareApiRuntime } from "./dev-api-runtime.mjs";

test("isolates core and connector configs while supplying their scoped secret vars", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "savia-runtime-"));
  for (const [app, name] of [
    ["api", "savia-agencies"],
    ["connector-gateway", "savia-connectors"],
  ]) {
    await mkdir(resolve(root, `apps/${app}`), { recursive: true });
    await writeFile(
      resolve(root, `apps/${app}/wrangler.jsonc`),
      JSON.stringify({
        name,
        main: "src/index.ts",
        d1_databases: [
          {
            binding: "DB",
            database_id: "local",
            migrations_dir: "../../migrations",
          },
        ],
      }),
    );
  }
  await mkdir(resolve(root, "infra/secrets"), { recursive: true });
  await writeFile(
    resolve(root, "apps/api/.dev.vars"),
    'NANGO_API_KEY="core-file-key"',
  );
  await writeFile(
    resolve(root, "infra/secrets/assistant-api.dev.env"),
    'NANGO_API_KEY="environment-key"',
  );
  await writeFile(
    resolve(root, "infra/secrets/connector-gateway.dev.env"),
    'EXTENSION_CONNECTIONS_ENCRYPTION_KEY="connector-key"',
  );
  const configs = await prepareApiRuntime(root, {
    SAVIA_PUBLIC_ORIGIN: "http://127.0.0.1:5174",
    PLUGIN_REGISTRY_TENANTS: '{"tenant:1":{}}',
    COMPANION_ENABLED: "true",
    COMPANION_STT_MODEL: "openai/whisper-large-v3",
  });
  assert.equal(configs.length, 2);
  for (const path of [configs[0]]) {
    const config = JSON.parse(await readFile(path, "utf8"));
    assert.equal(config.d1_databases[0].database_id, "local");
    assert.equal(config.vars, undefined);
    assert.equal(
      config.main,
      resolve(root, "scripts/plugin-development/worker.ts"),
    );
    const file = resolve(path, "../.dev.vars");
    const vars = parseEnv(await readFile(file, "utf8"));
    assert.equal(vars.NANGO_API_KEY, "environment-key");
    assert.equal(vars.SAVIA_PUBLIC_ORIGIN, "http://127.0.0.1:5174");
    assert.equal(vars.PLUGIN_REGISTRY_TENANTS, '{"tenant:1":{}}');
    assert.equal(vars.COMPANION_ENABLED, "true");
    assert.equal(vars.COMPANION_STT_MODEL, "openai/whisper-large-v3");
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  }
  const coreVars = parseEnv(
    await readFile(resolve(configs[0], "../.dev.vars"), "utf8"),
  );
  assert.equal(coreVars.EXTENSION_CONNECTIONS_ENCRYPTION_KEY, "connector-key");
  assert.match(coreVars.STUDIO_INTEGRATION_KEY, /^[a-f0-9]{64}$/);
  assert.match(coreVars.SAVIA_PLUGIN_DEV_KEY, /^[a-f0-9]{64}$/);
  assert.notEqual(
    coreVars.SAVIA_PLUGIN_DEV_KEY,
    coreVars.STUDIO_INTEGRATION_KEY,
  );
  const keyFile = resolve(
    root,
    "apps/api/.wrangler/local-runtime/studio-integration-key",
  );
  assert.equal(
    await readFile(keyFile, "utf8"),
    coreVars.STUDIO_INTEGRATION_KEY,
  );
  assert.equal((await stat(keyFile)).mode & 0o777, 0o600);
  assert.equal(
    (await stat(resolve(root, "apps/api/.wrangler/local-runtime"))).mode &
      0o777,
    0o700,
  );
  const restarted = await prepareApiRuntime(root, {
    SAVIA_PUBLIC_ORIGIN: "http://127.0.0.1:5174",
    PLUGIN_REGISTRY_TENANTS: '{"tenant:1":{}}',
  });
  const restartedVars = parseEnv(
    await readFile(resolve(restarted[0], "../.dev.vars"), "utf8"),
  );
  assert.equal(
    restartedVars.STUDIO_INTEGRATION_KEY,
    coreVars.STUDIO_INTEGRATION_KEY,
  );

  await writeFile(
    resolve(root, "apps/api/.dev.vars"),
    'NANGO_API_KEY="core-file-key"\nCRM_INTEGRATION_KEY="stored-key"',
  );
  const legacyConfigured = await prepareApiRuntime(root, {});
  const legacyVars = parseEnv(
    await readFile(resolve(legacyConfigured[0], "../.dev.vars"), "utf8"),
  );
  assert.equal(legacyVars.CRM_INTEGRATION_KEY, "stored-key");
  assert.equal(legacyVars.STUDIO_INTEGRATION_KEY, undefined);

  await writeFile(
    resolve(root, "apps/api/.dev.vars"),
    'NANGO_API_KEY="core-file-key"\nCRM_INTEGRATION_KEY="stored-key"\nSTUDIO_INTEGRATION_KEY="core-configured-key"',
  );
  const configured = await prepareApiRuntime(root, {});
  const configuredVars = parseEnv(
    await readFile(resolve(configured[0], "../.dev.vars"), "utf8"),
  );
  assert.equal(configuredVars.STUDIO_INTEGRATION_KEY, "core-configured-key");
  const explicitlyConfigured = await prepareApiRuntime(root, {
    STUDIO_INTEGRATION_KEY: "environment-configured-key",
  });
  const explicitVars = parseEnv(
    await readFile(resolve(explicitlyConfigured[0], "../.dev.vars"), "utf8"),
  );
  assert.equal(
    explicitVars.STUDIO_INTEGRATION_KEY,
    "environment-configured-key",
  );
  assert.equal(
    (await readFile(resolve(root, "apps/api/.dev.vars"), "utf8")).includes(
      "core-file-key",
    ),
    true,
  );
  const connectorVars = parseEnv(
    await readFile(resolve(configs[1], "../.dev.vars"), "utf8"),
  );
  assert.deepEqual(connectorVars, {
    EXTENSION_CONNECTIONS_ENCRYPTION_KEY: "connector-key",
  });
});
