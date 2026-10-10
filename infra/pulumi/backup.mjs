// Backup for Pulumi-managed stacks: D1 SQL exports + R2 object sync.
// Pulumi recreates empty containers on disaster; this script captures the
// data. Backups default under infra/pulumi/backups/ (gitignored) together
// with a manifest.json consumed by restore.mjs.
// R2 sync uses the S3-compatible API via AWS CLI; D1 uses wrangler export.
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { normalizeEnvironment } from "./naming.mjs";
import { parseStackOutputs } from "./outputs.mjs";

const execFileAsync = promisify(execFile);

export function parseBackupArgs(argv) {
  const stack = flagValue(argv, "--stack");
  normalizeEnvironment(stack);
  const dryRun = argv.includes("--dry-run");
  const apply = argv.includes("--apply");
  const skipR2 = argv.includes("--skip-r2");
  if (!dryRun && !apply) {
    throw new Error(
      "Refusing to write backups without --apply (or use --dry-run to plan)",
    );
  }
  const outDirFlag = argv.indexOf("--out-dir");
  const outDir =
    outDirFlag !== -1 && argv[outDirFlag + 1] && !argv[outDirFlag + 1].startsWith("--")
      ? argv[outDirFlag + 1]
      : null;
  return { stack, dryRun, skipR2, outDir };
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

// wrangler d1 export <name> --remote --output <file>
export function buildD1ExportCommand(dbName, outputFile) {
  if (!dbName || !outputFile) throw new Error("dbName and outputFile required");
  return [
    "pnpm",
    [
      "--filter",
      "@savia/api",
      "exec",
      "wrangler",
      "d1",
      "export",
      dbName,
      "--remote",
      "--output",
      outputFile,
    ],
  ];
}

// aws s3 sync s3://<bucket> <dest> --endpoint-url https://<account>.r2.cloudflarestorage.com
export function buildR2SyncCommand({ bucket, destDir, accountId }) {
  if (!bucket || !destDir || !accountId)
    throw new Error("bucket, destDir and accountId are required");
  return [
    "aws",
    [
      "s3",
      "sync",
      `s3://${bucket}`,
      destDir,
      "--endpoint-url",
      `https://${accountId}.r2.cloudflarestorage.com`,
    ],
  ];
}

export function manifestFor({ stack, outputs, files, r2 }) {
  return Object.freeze({
    version: 1,
    stack,
    createdAt: new Date().toISOString(),
    pulumiOutputs: outputs,
    d1: files,
    r2,
  });
}

async function main() {
  const plan = parseBackupArgs(process.argv.slice(2));
  const pulumiCwd = fileURLToPath(new URL(".", import.meta.url));
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const defaultOutDir = join(pulumiCwd, "backups", plan.stack, stamp);

  if (plan.dryRun) {
    console.log(
      `Would back up stack ${plan.stack} to ${plan.outDir ?? defaultOutDir}`,
    );
    console.log("Would export D1 databases and sync the R2 bucket.");
    return;
  }
  const { stdout } = await execFileAsync(
    "pulumi",
    ["stack", "output", "--json", "--stack", plan.stack],
    { cwd: pulumiCwd, maxBuffer: 32 * 1024 * 1024 },
  );
  const outputs = parseStackOutputs(stdout);
  const outDir = plan.outDir ?? defaultOutDir;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!plan.skipR2 && !accountId)
    throw new Error("CLOUDFLARE_ACCOUNT_ID is required for R2 sync");

  await mkdir(join(outDir, "d1"), { recursive: true });
  const files = {};
  for (const dbName of Object.values(outputs.databaseNames)) {
    const outputFile = join(outDir, "d1", `${dbName}.sql`);
    const [command, args] = buildD1ExportCommand(dbName, outputFile);
    await execFileAsync(command, args, { cwd: repoRoot });
    files[dbName] = outputFile;
    console.log(`Exported D1 ${dbName}`);
  }
  let r2 = null;
  if (!plan.skipR2) {
    const destDir = join(outDir, "r2", outputs.documentsBucketName);
    await mkdir(destDir, { recursive: true });
    const [command, args] = buildR2SyncCommand({
      bucket: outputs.documentsBucketName,
      destDir,
      accountId,
    });
    await execFileAsync(command, args, { cwd: repoRoot });
    r2 = { bucket: outputs.documentsBucketName, path: destDir };
    console.log(`Synced R2 ${outputs.documentsBucketName}`);
  }
  const manifest = manifestFor({ stack: plan.stack, outputs, files, r2 });
  await writeFile(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Backup complete: ${outDir}/manifest.json`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
