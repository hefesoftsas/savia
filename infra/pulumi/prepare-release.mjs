import { appendFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveEnvironment } from "./environments.mjs";
import { readDeploymentOutputs } from "./render-from-outputs.mjs";
import { renderEnvFromOutputs } from "./outputs.mjs";
import { renderCloudflareConfigFromEnv } from "./worker-config.mjs";
import {
  readSharedRegistryOutputs,
  renderSharedRegistry,
} from "./shared-registry/render.mjs";
import { freezeRuntimeRelease } from "./runtime-artifact.mjs";
import { createRuntimeCloudClient } from "./runtime-cloud.mjs";
import { execFileWithInput } from "./runtime-publisher-branch.mjs";
const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
export async function prepareEnvironmentRelease(
  { environment, destination },
  {
    env = process.env,
    run = execFileWithInput,
    freeze = freezeRuntimeRelease,
    readOutputs = readDeploymentOutputs,
    render = renderCloudflareConfigFromEnv,
    sharedOutputs = readSharedRegistryOutputs,
    renderShared = renderSharedRegistry,
    client,
  } = {},
) {
  const descriptor = resolveEnvironment(environment);
  if (!["application", "shared"].includes(descriptor.kind))
    throw new Error("Use the branch deployment delegate for branch releases");
  if (
    environment === "production" &&
    (env.PRODUCTION_OPERATIONS_ENABLED !== "true" ||
      env.GITHUB_REF !== "refs/heads/main")
  )
    throw new Error("Production operations are disabled or not reviewed main");
  const revision = (
    await run("git", ["rev-parse", "HEAD"], { cwd: root, env })
  ).stdout.trim();
  if (!/^[a-f\d]{40}$/.test(revision))
    throw new Error("Exact checked-out source revision required");
  let configs,
    operationEnv = { ...env };
  if (descriptor.kind === "application") {
    const outputs = await readOutputs(environment, { env, run });
    operationEnv = { ...env, ...renderEnvFromOutputs(outputs, root) };
    await render(operationEnv);
    const apps = [
      "api",
      "auth",
      "admin",
      "mcp",
      "savia-request",
      "connector-gateway",
      "hook-executor",
      "backup-coordinator",
      ...(outputs.flowsEnabled ? ["flows/api"] : []),
      ...(environment === "preview" ? ["plugin-editor-runtime"] : []),
    ];
    if (environment === "preview") {
      client ??= createRuntimeCloudClient(
        { accountId: env.CLOUDFLARE_ACCOUNT_ID, workers: [] },
        { env },
      );
      const { subdomain } = await client.api("/workers/subdomain");
      if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain ?? ""))
        throw new Error("Existing account Workers subdomain is required");
      operationEnv.SAVIA_PLUGIN_EDITOR_DEPLOYMENT_URL = `https://savia-plugin-editor-preview.${subdomain}.workers.dev`;
      operationEnv.VITE_PLUGIN_EDITOR_RUNTIME_URL = `${operationEnv.SAVIA_PLUGIN_EDITOR_DEPLOYMENT_URL}/plugin-editor`;
      await run(
        "pnpm",
        ["--filter", "@savia/admin", "run", "build:plugin-editor"],
        { cwd: root, env: operationEnv },
      );
    }
    await run("pnpm", ["--filter", "@savia/admin", "run", "build:assets"], {
      cwd: root,
      env: operationEnv,
    });
    configs = apps.map((app) =>
      join(root, "apps", app, `wrangler.${environment}.jsonc`),
    );
  } else {
    await sharedOutputs({ env, run });
    await renderShared({ env, run });
    configs = [join(root, "apps/plugin-registry/wrangler.production.jsonc")];
  }
  const artifact = await freeze({
    environment,
    configs,
    destination: resolve(destination),
    sourceRevision: revision,
    ...(descriptor.kind === "application"
      ? { domainMigrations: join(root, "packages/db/migrations") }
      : {}),
  });
  if (env.GITHUB_ENV && operationEnv.SAVIA_PLUGIN_EDITOR_DEPLOYMENT_URL)
    await appendFile(
      env.GITHUB_ENV,
      `SAVIA_PLUGIN_EDITOR_DEPLOYMENT_URL=${operationEnv.SAVIA_PLUGIN_EDITOR_DEPLOYMENT_URL}\n`,
    );
  return { ...artifact, sourceRevision: revision };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const value = (flag) => {
    const index = argv.indexOf(flag);
    if (index < 0 || !argv[index + 1] || argv[index + 1].startsWith("--"))
      throw new Error(`Missing ${flag}`);
    return argv[index + 1];
  };
  Promise.resolve()
    .then(() => {
      if (argv.length !== 4)
        throw new Error("Use --environment <id> --out <directory>");
      return prepareEnvironmentRelease({
        environment: value("--environment"),
        destination: value("--out"),
      });
    })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
