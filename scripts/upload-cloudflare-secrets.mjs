import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function buildSecretUploads(environment, values) {
  if (!["production", "preview"].includes(environment))
    throw new Error("Unsupported deployment environment");
  if (values.SQL_BRIDGE_URL || values.SQL_BRIDGE_SECRET) {
    if (!values.SQL_BRIDGE_URL || !values.SQL_BRIDGE_SECRET)
      throw new Error(
        "SQL_BRIDGE_URL and SQL_BRIDGE_SECRET must be configured together",
      );
    const url = new URL(values.SQL_BRIDGE_URL);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        "SQL_BRIDGE_URL must be an HTTPS URL without credentials, query, or fragment",
      );
  }
  const definitions = [
    ["auth", "savia-auth", { BETTER_AUTH_SECRET: "BETTER_AUTH_SECRET" }],
    [
      "mcp",
      "savia-mcp",
      { SAVIA_MCP_SHARED_SECRET: "SAVIA_MCP_SHARED_SECRET" },
    ],
    [
      "savia-request",
      "savia-request",
      { ENCRYPTION_KEY: "SAVIA_REQUEST_ENCRYPTION_KEY" },
    ],
    [
      "connector-gateway",
      "savia-connectors",
      {
        EXTENSION_CONNECTIONS_ENCRYPTION_KEY:
          "EXTENSION_CONNECTIONS_ENCRYPTION_KEY",
      },
    ],
    [
      "api",
      "savia-agencies",
      {
        ASSISTANT_SETTINGS_ENCRYPTION_KEY: "ASSISTANT_SETTINGS_ENCRYPTION_KEY",
        CRM_INTEGRATION_KEY: "CRM_INTEGRATION_KEY",
        EXTENSION_CONNECTIONS_ENCRYPTION_KEY:
          "EXTENSION_CONNECTIONS_ENCRYPTION_KEY",
        NANGO_API_KEY: "NANGO_API_KEY",
        SAVIA_MCP_SHARED_SECRET: "SAVIA_MCP_SHARED_SECRET",
      },
    ],
  ];
  return definitions.map(([app, name, keys]) => {
    const secrets = Object.fromEntries(
      Object.entries(keys).map(([key, source]) => {
        if (!values[source]) throw new Error(`${source} is required`);
        return [key, values[source]];
      }),
    );
    if (app === "api" && values.OPENROUTER_API_KEY)
      secrets.OPENROUTER_API_KEY = values.OPENROUTER_API_KEY;
    if (app === "api" && values.SQL_BRIDGE_URL) {
      secrets.SQL_BRIDGE_URL = values.SQL_BRIDGE_URL;
      secrets.SQL_BRIDGE_SECRET = values.SQL_BRIDGE_SECRET;
    }
    return {
      app,
      worker: name + (environment === "preview" ? "-preview" : ""),
      config: `wrangler.${environment}.jsonc`,
      secrets,
    };
  });
}

async function main() {
  const plans = buildSecretUploads(
    process.env.SAVIA_DEPLOY_ENVIRONMENT,
    process.env,
  );
  const root = process.cwd();
  // Validate every target before the first secret write.
  for (const plan of plans) {
    const config = JSON.parse(
      await readFile(join(root, "apps", plan.app, plan.config), "utf8"),
    );
    if (config.name !== plan.worker)
      throw new Error(`Unexpected Worker target for ${plan.app}`);
  }
  for (const plan of plans) {
    try {
      execFileSync(
        "pnpm",
        ["exec", "wrangler", "secret", "bulk", "--config", plan.config],
        {
          cwd: join(root, "apps", plan.app),
          input: JSON.stringify(plan.secrets),
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
    } catch {
      throw new Error(`Secret upload failed for ${plan.worker}`);
    }
    console.log(`Uploaded secrets to ${plan.worker} using ${plan.config}`);
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
