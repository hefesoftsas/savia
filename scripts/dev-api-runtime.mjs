import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { spawn } from "node:child_process";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function environmentFile(path) {
  try {
    return parseEnv(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}
const permitted = (name) =>
  /^(NANGO_|SAVIA_MCP_|ASSISTANT_)/.test(name) ||
  [
    "OPENROUTER_API_KEY",
    "OPENROUTER_MODEL",
    "CRM_INTEGRATION_KEY",
    "EXTENSION_CONNECTIONS_ENCRYPTION_KEY",
    "SAVIA_PUBLIC_ORIGIN",
    "SQL_BRIDGE_URL",
    "SQL_BRIDGE_SECRET",
  ].includes(name);

export async function prepareApiRuntime(
  root = repository,
  environment = process.env,
) {
  const secrets = resolve(
    root,
    environment.SAVIA_SECRETS_DIR ?? "infra/secrets",
  );
  const supplied = {
    ...(await environmentFile(resolve(secrets, "assistant-api.dev.env"))),
    ...(await environmentFile(resolve(secrets, "mcp.dev.env"))),
    ...(await environmentFile(resolve(secrets, "connector-gateway.dev.env"))),
    ...Object.fromEntries(
      Object.entries(environment).filter(
        ([name, value]) => permitted(name) && value,
      ),
    ),
  };
  const overrides = Object.fromEntries(
    Object.entries(supplied).filter(([name]) => permitted(name)),
  );
  const coreSecrets = await environmentFile(
    resolve(root, "apps/api/.dev.vars"),
  );
  const runtime = resolve(root, "apps/api/.wrangler/local-runtime");
  const configs = [];
  for (const [name, directory, vars] of [
    ["core", "apps/api", { ...coreSecrets, ...overrides }],
    [
      "connectors",
      "apps/connector-gateway",
      Object.fromEntries(
        Object.entries(overrides).filter(([name]) =>
          ["EXTENSION_CONNECTIONS_ENCRYPTION_KEY"].includes(name),
        ),
      ),
    ],
  ]) {
    const source = resolve(root, directory);
    // Checked-in local configurations use JSON with optional trailing commas.
    const config = JSON.parse(
      (await readFile(resolve(source, "wrangler.jsonc"), "utf8")).replace(
        /,\s*([}\]])/g,
        "$1",
      ),
    );
    delete config.$schema;
    config.main = resolve(source, config.main);
    for (const database of config.d1_databases ?? [])
      if (database.migrations_dir)
        database.migrations_dir = resolve(source, database.migrations_dir);
    const target = resolve(runtime, name);
    await mkdir(target, { recursive: true, mode: 0o700 });
    const configFile = resolve(target, "wrangler.json");
    const variablesFile = resolve(target, ".dev.vars");
    await writeFile(configFile, JSON.stringify(config, null, 2), {
      mode: 0o600,
    });
    await writeFile(
      variablesFile,
      Object.entries(vars)
        .map(([key, value]) => `${key}=${JSON.stringify(String(value))}`)
        .join("\n"),
      { mode: 0o600 },
    );
    await chmod(variablesFile, 0o600);
    configs.push(configFile);
  }
  return configs;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const configs = await prepareApiRuntime();
  const child = spawn(
    "pnpm",
    [
      "--filter",
      "@savia/api",
      "exec",
      "wrangler",
      "dev",
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      "8787",
      "--inspector-port",
      "9234",
      "--persist-to",
      ".wrangler/state",
      ...configs.flatMap((config) => ["--config", config]),
    ],
    { cwd: repository, stdio: "inherit", detached: true },
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      try {
        process.kill(-child.pid, signal);
      } catch {}
    });
  child.on("error", () => {
    console.error("Could not start the local API runtime.");
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 0;
  });
}
