// Closes the deploy loop between Pulumi and Wrangler.
// Reads `pulumi stack output --json` for a stack and renders the
// wrangler.{preview,production}.jsonc configs via the existing
// scripts/render-cloudflare-production-config.mjs, so the deploy flow is:
//   pulumi up --stack <env> -> render-from-outputs -> wrangler deploy (CI)
// IDs never have to be copied by hand from the dashboard again.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { appendFile } from "node:fs/promises";
import {
  parseStackOutputs,
  renderEnvFromOutputs,
  assertDeploymentAccount,
} from "./outputs.mjs";
import { normalizeEnvironment } from "./naming.mjs";
import { assertBackendConfigured } from "./deploy-stack.mjs";

const execFileAsync = promisify(execFile);

export function parseRenderArgs(argv) {
  const stack = flagValue(argv, "--stack");
  normalizeEnvironment(stack);
  return { stack };
}

function flagValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1 || index + 1 >= argv.length)
    throw new Error(`Missing required flag: ${flag} <preview|production>`);
  const value = argv[index + 1];
  if (typeof value !== "string" || value.startsWith("--") || value === "")
    throw new Error(`Missing required flag: ${flag} <preview|production>`);
  return value;
}

export async function readDeploymentOutputs(
  stack,
  { env = process.env, run = execFileAsync } = {},
) {
  normalizeEnvironment(stack);
  assertBackendConfigured(env);
  const pulumiCwd = fileURLToPath(new URL(".", import.meta.url));
  const options = { cwd: pulumiCwd, env, maxBuffer: 32 * 1024 * 1024 };
  await run(
    "pulumi",
    ["login", env.PULUMI_BACKEND_URL, "--non-interactive"],
    options,
  );
  // CI must select an adopted stack and must never create empty replacement state.
  await run("pulumi", ["stack", "select", stack, "--non-interactive"], options);
  const { stdout } = await run(
    "pulumi",
    ["stack", "output", "--json", "--stack", stack],
    options,
  );
  const outputs = parseStackOutputs(stdout);
  if (outputs.resolvedEnvironment !== stack)
    throw new Error("Stack and resolved environment disagree");
  assertDeploymentAccount(outputs, env.CLOUDFLARE_ACCOUNT_ID);
  return outputs;
}

async function main() {
  const { stack } = parseRenderArgs(process.argv.slice(2));
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  const outputs = await readDeploymentOutputs(stack);
  const env = {
    ...renderEnvFromOutputs(outputs, repoRoot),
    // An inherited process variable must never override a disabled stack flag.
    SAVIA_FLOWS_RESOURCES: outputs.flowsEnabled
      ? JSON.stringify(outputs.flowsResources)
      : "",
  };
  await execFileAsync(
    "node",
    ["scripts/render-cloudflare-production-config.mjs"],
    {
      cwd: repoRoot,
      env: { ...process.env, ...env },
    },
  );
  if (process.env.GITHUB_ENV || process.env.GITHUB_OUTPUT) {
    const lines = Object.entries(env)
      .map(([key, value]) => {
        if (/[\r\n]/.test(String(value)))
          throw new Error(`Invalid environment output ${key}`);
        return `${key}=${value}\n`;
      })
      .join("");
    if (process.env.GITHUB_ENV) await appendFile(process.env.GITHUB_ENV, lines);
    if (process.env.GITHUB_OUTPUT)
      await appendFile(process.env.GITHUB_OUTPUT, lines);
  }
  console.log(
    `Rendered wrangler.${env.SAVIA_DEPLOY_ENVIRONMENT}.jsonc from Pulumi stack ${stack}.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
