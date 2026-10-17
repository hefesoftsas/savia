import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  assertDestroyTarget,
  flagValue,
  hasFlag,
  previewNames,
  slugifyBranch,
} from "./preview-environment.mjs";
import { selectBranchInfrastructure } from "../infra/pulumi/branch-preview-resources.mjs";
import { emptyBucketForDestroy } from "../infra/pulumi/destroy.mjs";

const execFileAsync = promisify(execFile);
const branchProjectRoot = fileURLToPath(
  new URL("../infra/pulumi/branch-preview/", import.meta.url),
);

async function runBranchCommand(executable, args, options = {}) {
  const { stdout, stderr } = await execFileAsync(executable, args, {
    cwd: options.cwd,
    env: options.env,
    maxBuffer: 32 * 1024 * 1024,
  });
  return { stdout, stderr };
}

async function runWrangler(args) {
  const { stdout } = await execFileAsync(
    "pnpm",
    ["--filter", "@savia/api", "exec", "wrangler", ...args],
    { cwd: branchProjectRoot, env: process.env, maxBuffer: 32 * 1024 * 1024 },
  );
  return stdout;
}

export function workerOrder(names) {
  return [
    names.workers.gateway,
    names.workers.api,
    names.workers.connectorGateway,
    names.workers.mcp,
    names.workers.request,
    names.workers.hookExecutor,
    names.workers.auth,
  ];
}

export function isAlreadyGone(error) {
  return /not found|does not exist|no such|404/i.test(
    String(error.stderr ?? error.stdout ?? error.message),
  );
}

async function main() {
  const argv = process.argv.slice(2);
  const slug = slugifyBranch(flagValue(argv, "--branch"));
  const dryRun = hasFlag(argv, "--dry-run");
  const force = hasFlag(argv, "--force");
  if (!dryRun && !force)
    throw new Error("Refusing to destroy without --force (or use --dry-run)");
  const names = previewNames(slug);

  const workers = workerOrder(names).map((name) =>
    assertDestroyTarget(name, slug),
  );
  const databases = [names.databases.domain, names.databases.auth].map((name) =>
    assertDestroyTarget(name, slug),
  );
  const bucket = assertDestroyTarget(names.bucket, slug);

  if (dryRun) {
    console.log(`Would delete workers: ${workers.join(", ")}`);
    console.log(
      `Would empty and destroy Pulumi-managed branch stack: branch-${slug}`,
    );
    console.log(`  D1 databases: ${databases.join(", ")}`);
    console.log(`  R2 bucket: ${bucket}`);
    return;
  }

  const infrastructure = await selectBranchInfrastructure({
    slug,
    env: process.env,
    run: runBranchCommand,
  });
  if (infrastructure.stack !== `branch-${slug}`)
    throw new Error("Selected Pulumi stack does not match branch");

  const failures = [];
  for (const worker of workers) {
    try {
      await runWrangler(["delete", worker, "--force"]);
      console.log(`deleted worker ${worker}`);
    } catch (error) {
      if (isAlreadyGone(error)) console.log(`worker already gone ${worker}`);
      else failures.push(`worker ${worker}: ${error.message.split("\n")[0]}`);
    }
  }
  try {
    const removed = await emptyBucketForDestroy({
      bucket: infrastructure.outputs.documentsBucketName,
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      token: process.env.CLOUDFLARE_API_TOKEN,
    });
    console.log(`emptied ${removed} object(s) from ${bucket}`);
  } catch (error) {
    failures.push(`R2 bucket ${bucket}: ${error.message.split("\n")[0]}`);
  }

  if (failures.length === 0) {
    try {
      await execFileAsync(
        "pulumi",
        [
          "destroy",
          "--stack",
          infrastructure.stack,
          "--yes",
          "--non-interactive",
        ],
        { cwd: branchProjectRoot, env: process.env, stdio: "inherit" },
      );
      await execFileAsync(
        "pulumi",
        ["stack", "rm", infrastructure.stack, "--yes", "--non-interactive"],
        { cwd: branchProjectRoot, env: process.env, stdio: "inherit" },
      );
      console.log(`destroyed Pulumi branch stack ${infrastructure.stack}`);
    } catch (error) {
      failures.push(
        `Pulumi stack ${infrastructure.stack}: ${error.message.split("\n")[0]}`,
      );
    }
  }

  if (failures.length > 0) {
    console.log(`\nFailures:\n  ${failures.join("\n  ")}`);
    process.exitCode = 1;
  } else {
    console.log(`\nPreview ${names.suffix} destroyed.`);
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
