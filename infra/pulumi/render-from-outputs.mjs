// Closes the deploy loop between Pulumi and Wrangler.
// Reads `pulumi stack output --json` for a stack and renders the
// wrangler.{preview,production}.jsonc configs via the existing
// scripts/render-cloudflare-production-config.mjs, so the deploy flow is:
//   pulumi up --stack <env> -> render-from-outputs -> wrangler deploy (CI)
// IDs never have to be copied by hand from the dashboard again.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { parseStackOutputs, renderEnvFromOutputs } from "./outputs.mjs";
import { normalizeEnvironment } from "./naming.mjs";

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

async function main() {
  const { stack } = parseRenderArgs(process.argv.slice(2));
  const pulumiCwd = fileURLToPath(new URL(".", import.meta.url));
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  const { stdout } = await execFileAsync(
    "pulumi",
    ["stack", "output", "--json", "--stack", stack],
    { cwd: pulumiCwd, maxBuffer: 32 * 1024 * 1024 },
  );
  const env = renderEnvFromOutputs(parseStackOutputs(stdout), repoRoot);
  await execFileAsync("node", ["scripts/render-cloudflare-production-config.mjs"], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
  });
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
