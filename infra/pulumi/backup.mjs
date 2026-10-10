// Backup for Pulumi-managed stacks: D1 SQL exports + R2 object sync.
// Pulumi recreates empty containers on disaster; this script captures the
// data. Backups default under infra/pulumi/backups/ (gitignored) together
// with a manifest.json consumed by restore.mjs.
// R2 sync uses the S3-compatible API via AWS CLI; D1 uses wrangler export.
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { normalizeEnvironment } from "./naming.mjs";
import { parseStackOutputs } from "./outputs.mjs";
import {
  isVirtualTableExportError,
  dumpDatabase,
} from "./d1-table-dump.mjs";

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

export function hasS3Credentials(env = process.env) {
  return Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY);
}

// Fallback when no S3 credentials exist: download object by object with
// wrangler (needs only CLOUDFLARE_API_TOKEN). Slower than `aws s3 sync`
// but requires nothing else.
export function buildR2ObjectGetCommand({ bucket, key, destFile }) {
  if (!bucket || !key || !destFile)
    throw new Error("bucket, key and destFile are required");
  return [
    "pnpm",
    [
      "--filter",
      "@savia/api",
      "exec",
      "wrangler",
      "r2",
      "object",
      "get",
      `${bucket}/${key}`,
      "--remote",
      "--file",
      destFile,
    ],
  ];
}

export function buildR2ObjectPutCommand({ bucket, key, sourceFile }) {
  if (!bucket || !key || !sourceFile)
    throw new Error("bucket, key and sourceFile are required");
  return [
    "pnpm",
    [
      "--filter",
      "@savia/api",
      "exec",
      "wrangler",
      "r2",
      "object",
      "put",
      `${bucket}/${key}`,
      "--remote",
      "--file",
      sourceFile,
    ],
  ];
}

// Native R2 listing API (paginated). Used by the object-get fallback and
// to size buckets without extra tooling.
export async function listR2Objects({ bucket, accountId, token }) {
  if (!bucket || !accountId || !token)
    throw new Error("bucket, accountId and token are required");
  const objects = [];
  let cursor = null;
  for (let pages = 0; pages < 50; pages++) {
    const url =
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects?per_page=1000` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
    });
    const payload = await response.json();
    if (response.ok === false || payload.success === false) {
      throw new Error(
        `R2 list failed (${response.status}): ${JSON.stringify(payload.errors ?? payload).slice(0, 200)}`,
      );
    }
    for (const object of payload.result ?? []) {
      objects.push({ key: object.key, size: object.size ?? 0 });
    }
    cursor = payload.result_info?.cursor ?? null;
    if (!cursor) break;
  }
  return objects;
}

export function manifestFor({ stack, outputs, files, methods = {}, skipped = [], r2 }) {
  return Object.freeze({
    version: 1,
    stack,
    createdAt: new Date().toISOString(),
    pulumiOutputs: outputs,
    d1: files,
    d1Methods: methods,
    skippedTables: [...new Set(skipped)],
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
    throw new Error("CLOUDFLARE_ACCOUNT_ID is required for R2 backup");

  await mkdir(join(outDir, "d1"), { recursive: true });
  const files = {};
  const methods = {};
  const skipped = [];
  const uuidByName = {
    [outputs.databaseNames.auth]: outputs.authD1Id,
    [outputs.databaseNames.domain]: outputs.domainD1Id,
  };
  for (const dbName of Object.values(outputs.databaseNames)) {
    const outputFile = join(outDir, "d1", `${dbName}.sql`);
    try {
      const [command, args] = buildD1ExportCommand(dbName, outputFile);
      await execFileAsync(command, args, { cwd: repoRoot });
      methods[dbName] = "export";
      console.log(`Exported D1 ${dbName}`);
    } catch (error) {
      if (!isVirtualTableExportError(error)) throw error;
      const token = process.env.CLOUDFLARE_API_TOKEN;
      if (!token || !accountId)
        throw new Error(
          "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required for table dumps",
        );
      const summary = await dumpDatabase({
        accountId,
        uuid: uuidByName[dbName],
        token,
        outputFile,
      });
      methods[dbName] = summary.method;
      skipped.push(...summary.skipped);
      console.log(
        `Dumped D1 ${dbName} table-by-table (${summary.tables} tables, ${summary.rows} rows; FTS5 rebuilt from triggers on restore)`,
      );
    }
    files[dbName] = outputFile;
  }
  let r2 = null;
  if (!plan.skipR2) {
    const destDir = join(outDir, "r2", outputs.documentsBucketName);
    await mkdir(destDir, { recursive: true });
    if (hasS3Credentials()) {
      const [command, args] = buildR2SyncCommand({
        bucket: outputs.documentsBucketName,
        destDir,
        accountId,
      });
      await execFileAsync(command, args, { cwd: repoRoot });
      r2 = {
        bucket: outputs.documentsBucketName,
        path: destDir,
        method: "s3-sync",
      };
      console.log(`Synced R2 ${outputs.documentsBucketName}`);
    } else {
      const token = process.env.CLOUDFLARE_API_TOKEN;
      if (!token)
        throw new Error(
          "R2 backup needs AWS S3 credentials or CLOUDFLARE_API_TOKEN",
        );
      const objects = await listR2Objects({
        bucket: outputs.documentsBucketName,
        accountId,
        token,
      });
      for (const { key } of objects) {
        const destFile = join(destDir, key);
        await mkdir(dirname(destFile), { recursive: true });
        const [command, args] = buildR2ObjectGetCommand({
          bucket: outputs.documentsBucketName,
          key,
          destFile,
        });
        await execFileAsync(command, args, { cwd: repoRoot });
      }
      r2 = {
        bucket: outputs.documentsBucketName,
        path: destDir,
        method: "object-get",
        objects: objects.length,
      };
      console.log(
        `Downloaded ${objects.length} R2 object(s) from ${outputs.documentsBucketName}`,
      );
    }
  }
  const manifest = manifestFor({ stack: plan.stack, outputs, files, methods, skipped, r2 });
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
