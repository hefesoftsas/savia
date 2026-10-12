import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeEnvironment } from "./naming.mjs";
import { parseStackOutputs, assertDeploymentAccount } from "./outputs.mjs";

const run = promisify(execFile);

export function parseDeployArgs(argv) {
  const index = argv.indexOf("--stack");
  const stack = normalizeEnvironment(index >= 0 ? argv[index + 1] : undefined);
  const apply = argv.includes("--apply");
  if (apply === argv.includes("--preview"))
    throw new Error("Choose exactly one of --apply or --preview");
  return { stack, apply };
}

export function assertBackendConfigured(env) {
  if (!env.PULUMI_BACKEND_URL) throw new Error("Pulumi backend is required");
  const url = new URL(env.PULUMI_BACKEND_URL);
  if (url.protocol !== "s3:" || url.username || url.password)
    throw new Error(
      "A remote S3-compatible state backend without URL credentials is required",
    );
  if (!env.PULUMI_CONFIG_PASSPHRASE)
    throw new Error("Encrypted-state passphrase is required");
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY)
    throw new Error("R2 state backend credentials are required");
}

export function assertSafePlan(plan) {
  const changes = plan?.changeSummary;
  if (!changes || typeof changes !== "object")
    throw new Error("Invalid Pulumi plan summary");
  for (const [operation, count] of Object.entries(changes)) {
    if (typeof count !== "number" || count < 0)
      throw new Error("Invalid Pulumi plan count");
    if (
      count > 0 &&
      ![
        "same",
        "create",
        "update",
        "read",
        "refresh",
        "read-discard",
        "import",
      ].includes(operation)
    )
      throw new Error(`Refusing destructive infrastructure plan: ${operation}`);
  }
}

async function main() {
  const { stack, apply } = parseDeployArgs(process.argv.slice(2));
  assertBackendConfigured(process.env);
  const cwd = fileURLToPath(new URL(".", import.meta.url));
  const options = { cwd, env: process.env, maxBuffer: 32 * 1024 * 1024 };
  await run(
    "pulumi",
    ["login", process.env.PULUMI_BACKEND_URL, "--non-interactive"],
    options,
  );
  // Never init a new stack against existing resources or fall back to manual IDs.
  await run("pulumi", ["stack", "select", stack, "--non-interactive"], options);
  const { stdout: current } = await run(
    "pulumi",
    ["stack", "output", "--stack", stack, "--json"],
    options,
  );
  const outputs = parseStackOutputs(current);
  if (outputs.resolvedEnvironment !== stack)
    throw new Error("Stack and resolved environment disagree");
  assertDeploymentAccount(outputs, process.env.CLOUDFLARE_ACCOUNT_ID);

  const temporary = await mkdtemp(join(tmpdir(), "savia-infra-plan-"));
  try {
    const planFile = join(temporary, "plan.json");
    const { stdout } = await run(
      "pulumi",
      [
        "preview",
        "--stack",
        stack,
        "--refresh",
        "--non-interactive",
        "--save-plan",
        planFile,
        "--json",
      ],
      options,
    );
    const plan = JSON.parse(stdout);
    assertSafePlan(plan);
    console.log(
      `Infrastructure ${stack} plan: ${JSON.stringify(plan.changeSummary)}`,
    );
    if (apply) {
      await run(
        "pulumi",
        [
          "up",
          "--stack",
          stack,
          "--plan",
          planFile,
          "--skip-preview",
          "--yes",
          "--non-interactive",
          "--json",
        ],
        options,
      );
      console.log(`Applied the saved ${stack} infrastructure plan.`);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
