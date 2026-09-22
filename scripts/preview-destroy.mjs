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

const execFileAsync = promisify(execFile);

async function runWrangler(args) {
  const { stdout } = await execFileAsync(
    "pnpm",
    ["--filter", "@savia/api", "exec", "wrangler", ...args],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  return stdout;
}

function workerOrder(names) {
  return [
    names.workers.gateway,
    names.workers.api,
    names.workers.mcp,
    names.workers.request,
    names.workers.auth,
  ];
}

function isAlreadyGone(error) {
  return /not found|does not exist|no such|404/i.test(
    String(error.stderr ?? error.stdout ?? error.message),
  );
}

async function emptyBucket(bucket) {
  const listed = await runWrangler([
    "r2",
    "object",
    "list",
    bucket,
    "--remote",
    "--json",
  ]);
  let parsed;
  try {
    parsed = JSON.parse(listed);
  } catch {
    throw new Error(`Could not list objects in ${bucket}`);
  }
  const rows = Array.isArray(parsed) ? parsed : (parsed?.objects ?? []);
  const keys = rows
    .map((row) => row?.key)
    .filter(Boolean)
    .slice(0, 5000);
  for (const key of keys) {
    await runWrangler([
      "r2",
      "object",
      "delete",
      `${bucket}/${key}`,
      "--remote",
      "-y",
    ]);
  }
  return keys.length;
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
    console.log(`Would delete D1 databases: ${databases.join(", ")}`);
    console.log(`Would empty and delete R2 bucket: ${bucket}`);
    return;
  }

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
  for (const database of databases) {
    try {
      await runWrangler(["d1", "delete", database, "-y"]);
      console.log(`deleted D1 database ${database}`);
    } catch (error) {
      if (isAlreadyGone(error))
        console.log(`database already gone ${database}`);
      else
        failures.push(`database ${database}: ${error.message.split("\n")[0]}`);
    }
  }
  try {
    await emptyBucket(bucket);
    await runWrangler(["r2", "bucket", "delete", bucket]);
    console.log(`deleted R2 bucket ${bucket}`);
  } catch (error) {
    console.log(
      `WARNING: R2 bucket ${bucket} left behind (${error.message.split("\n")[0]}). ` +
        `Empty it in the dashboard or with wrangler r2 commands.`,
    );
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
