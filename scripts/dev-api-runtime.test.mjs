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
    'NANGO_API_KEY="core-file-key"\nCRM_INTEGRATION_KEY="stored-key"',
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
  });
  assert.equal(configs.length, 2);
  for (const path of [configs[0]]) {
    const config = JSON.parse(await readFile(path, "utf8"));
    assert.equal(config.d1_databases[0].database_id, "local");
    assert.equal(config.vars, undefined);
    const file = resolve(path, "../.dev.vars");
    const vars = parseEnv(await readFile(file, "utf8"));
    assert.equal(vars.NANGO_API_KEY, "environment-key");
    assert.equal(vars.CRM_INTEGRATION_KEY, "stored-key");
    assert.equal(vars.SAVIA_PUBLIC_ORIGIN, "http://127.0.0.1:5174");
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  }
  const coreVars = parseEnv(
    await readFile(resolve(configs[0], "../.dev.vars"), "utf8"),
  );
  assert.equal(coreVars.EXTENSION_CONNECTIONS_ENCRYPTION_KEY, "connector-key");
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
