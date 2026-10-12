import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertBackendConfigured } from "../deploy-stack.mjs";
import { pluginRegistryWorkerConfig } from "../auxiliary-worker-config.mjs";
import { validateSharedRegistryOutputs } from "../shared-registry-resources.mjs";
import { assertDeploymentAccount } from "../outputs.mjs";

const execFileAsync = promisify(execFile);
const projectDir = fileURLToPath(new URL(".", import.meta.url));
const defaultOutputRoot = resolve(projectDir, "../../..");

function parseOutputs(stdout) {
  let outputs;
  try {
    outputs = JSON.parse(stdout);
  } catch {
    throw new Error("Pulumi returned invalid shared registry stack outputs");
  }
  return validateSharedRegistryOutputs(outputs);
}

export async function readSharedRegistryOutputs({
  env = process.env,
  run = execFileAsync,
} = {}) {
  assertBackendConfigured(env);
  const options = { cwd: projectDir, env, maxBuffer: 32 * 1024 * 1024 };
  await run(
    "pulumi",
    ["login", env.PULUMI_BACKEND_URL, "--non-interactive"],
    options,
  );
  // Selecting a missing stack fails. Deployment never initializes replacement state.
  await run(
    "pulumi",
    ["stack", "select", "shared", "--non-interactive"],
    options,
  );
  const { stdout } = await run(
    "pulumi",
    ["stack", "output", "--json", "--stack", "shared"],
    options,
  );
  const outputs = parseOutputs(stdout);
  assertDeploymentAccount(outputs, env.CLOUDFLARE_ACCOUNT_ID);
  return outputs;
}

export async function renderSharedRegistry({
  run = execFileAsync,
  env = process.env,
  outputRoot = defaultOutputRoot,
} = {}) {
  const resources = await readSharedRegistryOutputs({ run, env });
  const config = pluginRegistryWorkerConfig(resources);
  const file = join(
    outputRoot,
    "apps",
    "plugin-registry",
    "wrangler.production.jsonc",
  );
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  renderSharedRegistry().then(
    () =>
      process.stdout.write(
        "Rendered shared plugin registry Worker configuration.\n",
      ),
    (error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    },
  );
}
