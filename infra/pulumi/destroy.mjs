// Guarded destroy for Pulumi-managed stacks (D1 + R2).
// Style follows scripts/preview-destroy.mjs: --dry-run plans, execution
// requires an explicit flag, and production additionally requires an
// acknowledgement flag. R2 buckets must be empty before Cloudflare lets
// Pulumi delete them, so destroy empties the bucket first (same approach
// as the preview destroy script).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { normalizeEnvironment, stackProtection } from "./naming.mjs";
import { parseStackOutputs } from "./outputs.mjs";

const execFileAsync = promisify(execFile);

export function parseDestroyArgs(argv) {
  const stack = flagValue(argv, "--stack");
  const environment = normalizeEnvironment(stack);
  const dryRun = argv.includes("--dry-run");
  const apply = argv.includes("--apply");
  const understood = argv.includes("--i-understand-destroy-production");
  const skipEmptyBucket = argv.includes("--skip-empty-bucket");
  if (!dryRun && !apply) {
    throw new Error(
      "Refusing to destroy without --apply (or use --dry-run to plan)",
    );
  }
  const protection = stackProtection(environment);
  if (protection.protect && !understood) {
    throw new Error(
      `Refusing to destroy production without ${protection.destroyRequires}`,
    );
  }
  return { stack, environment, dryRun, skipEmptyBucket };
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

function isAlreadyGone(error) {
  return /not found|does not exist|no such|404/i.test(
    String(error.stderr ?? error.stdout ?? error.message),
  );
}

async function runWrangler(args, cwd) {
  const { stdout } = await execFileAsync(
    "pnpm",
    ["--filter", "@savia/api", "exec", "wrangler", ...args],
    { cwd, maxBuffer: 32 * 1024 * 1024 },
  );
  return stdout;
}

// R2 buckets cannot be deleted while they hold objects. Pulumi's destroy
// would fail on a non-empty bucket, so empty it first like preview-destroy.
export async function emptyBucketForDestroy(bucket, repoRoot) {
  const listed = await runWrangler(
    ["r2", "object", "list", bucket, "--remote", "--json"],
    repoRoot,
  );
  let parsed;
  try {
    parsed = listed.trim() === "" ? [] : JSON.parse(listed);
  } catch {
    throw new Error(`Could not list objects in ${bucket}`);
  }
  const rows = Array.isArray(parsed) ? parsed : (parsed?.objects ?? []);
  const keys = rows
    .map((row) => row?.key)
    .filter(Boolean)
    .slice(0, 5000);
  for (const key of keys) {
    await runWrangler(
      ["r2", "object", "delete", `${bucket}/${key}`, "--remote", "-y"],
      repoRoot,
    );
  }
  return keys.length;
}

async function stackOutputs(pulumiCwd, stack) {
  const { stdout } = await execFileAsync(
    "pulumi",
    ["stack", "output", "--json", "--stack", stack],
    { cwd: pulumiCwd, maxBuffer: 32 * 1024 * 1024 },
  );
  return parseStackOutputs(stdout);
}

async function main() {
  const plan = parseDestroyArgs(process.argv.slice(2));
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  const pulumiCwd = fileURLToPath(new URL(".", import.meta.url));
  if (plan.dryRun) {
    console.log(
      `Would empty the R2 bucket and run: pulumi destroy --stack ${plan.stack} --yes`,
    );
    console.log(
      "Worker code, D1 data, and R2 objects are deleted by this operation. Restore from a backup first if needed.",
    );
    return;
  }
  if (!plan.skipEmptyBucket) {
    const outputs = await stackOutputs(pulumiCwd, plan.stack);
    const bucket = outputs.documentsBucketName;
    try {
      const removed = await emptyBucketForDestroy(bucket, repoRoot);
      console.log(`Emptied ${removed} object(s) from ${bucket}`);
    } catch (error) {
      if (isAlreadyGone(error)) {
        console.log(`Bucket already gone: ${bucket}`);
      } else {
        console.log(
          `WARNING: could not empty ${bucket} (${error.message.split("\n")[0]}). ` +
            "Destroy may fail; empty it in the dashboard or with wrangler r2 commands.",
        );
      }
    }
  }
  await execFileAsync(
    "pulumi",
    ["destroy", "--stack", plan.stack, "--yes"],
    { cwd: pulumiCwd, stdio: "inherit" },
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
