import { createHmac } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ephemeralSecret,
  previewNames,
} from "../../scripts/preview-environment.mjs";
import { resolveEnvironment } from "./environments.mjs";
import { workerDeploymentOrder } from "./runtime-publisher-branch.mjs";
import { verifyRuntimeArtifact } from "./runtime-publisher.mjs";

const required = {
  auth: ["BETTER_AUTH_SECRET", "SAVIA_INTERNAL_BRIDGE_KEY"],
  hookExecutor: [],
  connectorGateway: ["EXTENSION_CONNECTIONS_ENCRYPTION_KEY"],
  request: ["ENCRYPTION_KEY"],
  mcp: ["SAVIA_MCP_SHARED_SECRET"],
  api: [
    "ASSISTANT_SETTINGS_ENCRYPTION_KEY",
    "EXTENSION_CONNECTIONS_ENCRYPTION_KEY",
    "STUDIO_INTEGRATION_KEY",
    "SAVIA_MCP_SHARED_SECRET",
    "SAVIA_INTERNAL_BRIDGE_KEY",
  ],
  gateway: [],
};

// The prepared path never provisions infrastructure or calls a delegating CLI.
// Opaque keys are reused as a complete set; a partial set cannot be reconstructed.
export async function createBranchPublisher(
  inputs,
  {
    env = process.env,
    client,
    run,
    runWrangler,
    bootstrappedWorkers = [],
    root = fileURLToPath(new URL("../../", import.meta.url)),
  },
) {
  if (
    resolveEnvironment(inputs.environment).kind !== "branch" ||
    env.CLOUDFLARE_ACCOUNT_ID !== inputs.accountId
  )
    throw new Error("Branch release identity mismatch");
  const artifact = await verifyRuntimeArtifact(inputs);
  const names = previewNames(inputs.environment.slice(7));
  const configs = new Map();
  for (const file of artifact.configs) {
    const config = JSON.parse(
      await readFile(join(inputs.artifactDirectory, file), "utf8"),
    );
    const role = Object.keys(names.workers).find(
      (key) => names.workers[key] === config.name,
    );
    if (
      !role ||
      configs.has(role) ||
      !inputs.workers.some((worker) => worker.name === config.name)
    )
      throw new Error("Unexpected prepared branch Worker");
    configs.set(role, { config, path: join(inputs.artifactDirectory, file) });
  }
  if (
    configs.size !== inputs.workers.length ||
    !configs.has("api") ||
    !configs.has("auth")
  )
    throw new Error("Incomplete prepared branch Workers");
  let complete = true,
    any = false;
  for (const [role, { config }] of configs) {
    const settings = await client.api(
      `/workers/scripts/${config.name}/settings`,
    );
    const present = new Set(
      (settings.bindings ?? [])
        .filter((binding) => binding.type === "secret_text")
        .map((binding) => binding.name),
    );
    any ||= present.size > 0;
    complete &&= required[role].every((key) => present.has(key));
  }
  const fresh =
    !any &&
    inputs.workers.every((worker) => bootstrappedWorkers.includes(worker.name));
  if (!complete && !fresh)
    throw new Error(
      "Partial branch secret custody; existing encryption keys must be recovered before publication",
    );
  const databaseId = configs
    .get("api")
    .config.d1_databases?.find(
      (binding) => binding.binding === "DB",
    )?.database_id;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(databaseId ?? ""))
    throw new Error("Prepared branch domain database is missing");
  const migrations = join(inputs.artifactDirectory, "migrations");
  if (!(await stat(migrations)).isDirectory())
    throw new Error("Frozen branch migrations are missing");
  return {
    publish: async () => {
      await run(
        "node",
        [
          join(root, "scripts/apply-d1-migrations.mjs"),
          "--migrations-dir",
          migrations,
        ],
        { cwd: root, env: { ...env, CLOUDFLARE_DATABASE_ID: databaseId } },
      );
      if (fresh) {
        const secrets = Object.fromEntries(
          [...new Set(Object.values(required).flat())].map((key) => [
            key,
            ephemeralSecret(),
          ]),
        );
        secrets.SAVIA_INTERNAL_BRIDGE_KEY = createHmac(
          "sha256",
          secrets.SAVIA_MCP_SHARED_SECRET,
        )
          .update("savia:auth-tenant-user-administration:v1")
          .digest("hex");
        if (env.BETTER_AUTH_BOOTSTRAP_PASSWORD?.trim())
          secrets.BETTER_AUTH_BOOTSTRAP_PASSWORD =
            env.BETTER_AUTH_BOOTSTRAP_PASSWORD;
        for (const [role, { path }] of configs)
          if (required[role].length)
            await runWrangler(["secret", "bulk", "--config", path], {
              cwd: inputs.artifactDirectory,
              env,
              input: JSON.stringify(
                Object.fromEntries(
                  [
                    ...required[role],
                    ...(role === "auth" &&
                    secrets.BETTER_AUTH_BOOTSTRAP_PASSWORD
                      ? ["BETTER_AUTH_BOOTSTRAP_PASSWORD"]
                      : []),
                  ].map((key) => [key, secrets[key]]),
                ),
              ),
            });
      }
      for (const role of workerDeploymentOrder([...configs.keys()]))
        await runWrangler(["deploy", "--config", configs.get(role).path], {
          cwd: inputs.artifactDirectory,
          env,
        });
    },
  };
}
