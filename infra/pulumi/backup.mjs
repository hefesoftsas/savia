// Backup for Pulumi-managed stacks: D1 SQL exports + R2 object sync.
// Pulumi recreates empty containers on disaster; this script captures the
// data. Backups default under infra/pulumi/backups/ (gitignored) together
// with a manifest.json consumed by restore.mjs.
// R2 sync uses the S3-compatible API via AWS CLI; D1 uses wrangler export.
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname, relative, isAbsolute, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  normalizeEnvironment,
  assertAccountId,
  assertSafeR2Key,
} from "./naming.mjs";
import { parseStackOutputs } from "./outputs.mjs";
import { isVirtualTableExportError, dumpDatabase } from "./d1-table-dump.mjs";

const execFileAsync = promisify(execFile);

export function parseBackupArgs(argv) {
  const stack = flagValue(argv, "--stack");
  normalizeEnvironment(stack);
  const dryRun = argv.includes("--dry-run");
  const apply = argv.includes("--apply");
  const skipR2 = argv.includes("--skip-r2");
  const quietIndex = argv.indexOf("--confirm-quiescent");
  const confirmQuiescent =
    quietIndex !== -1 && argv[quietIndex + 1] ? argv[quietIndex + 1] : null;
  if (!dryRun && !apply) {
    throw new Error(
      "Refusing to write backups without --apply (or use --dry-run to plan)",
    );
  }
  const outDirFlag = argv.indexOf("--out-dir");
  const outDir =
    outDirFlag !== -1 &&
    argv[outDirFlag + 1] &&
    !argv[outDirFlag + 1].startsWith("--")
      ? argv[outDirFlag + 1]
      : null;
  return { stack, dryRun, skipR2, outDir, confirmQuiescent };
}

export function assertSafeTableDumpFallback(stack, confirmation) {
  if (stack === "production") {
    throw new Error(
      "Production table-dump fallback is disabled because it cannot provide a consistent snapshot; use a verified export during a controlled recovery window",
    );
  }
  if (confirmation !== stack) {
    throw new Error(
      `Table-dump fallback requires --confirm-quiescent ${stack} after writes are paused`,
    );
  }
}

export function backupRelativePath(root, path) {
  const relativePath = relative(root, path);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("Backup files must be inside the backup directory");
  }
  return relativePath.split(sep).join("/");
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
  if (!bucket || !destDir) throw new Error("bucket and destDir are required");
  assertAccountId(accountId);
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
  if (!bucket || !destFile) throw new Error("bucket and destFile required");
  assertSafeR2Key(key);
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

export function buildR2ObjectPutCommand({
  bucket,
  key,
  sourceFile,
  httpMetadata = {},
  contentType,
  contentEncoding,
  customMetadata = {},
  accountId,
  storageClass,
  s3Credentials = hasS3Credentials(),
}) {
  if (!bucket || !sourceFile) throw new Error("bucket and sourceFile required");
  assertSafeR2Key(key);
  const normalizedHttpMetadata = {
    ...httpMetadata,
    ...(contentType ? { contentType } : {}),
    ...(contentEncoding ? { contentEncoding } : {}),
  };
  if (Object.keys(customMetadata).length > 0) {
    if (!accountId || !s3Credentials) {
      throw new Error(
        "Restoring custom R2 metadata requires AWS S3 credentials and CLOUDFLARE_ACCOUNT_ID",
      );
    }
    assertAccountId(accountId);
    const args = [
      "s3api",
      "put-object",
      "--bucket",
      bucket,
      "--key",
      key,
      "--body",
      sourceFile,
      "--endpoint-url",
      `https://${accountId}.r2.cloudflarestorage.com`,
      "--metadata",
      JSON.stringify(customMetadata),
    ];
    appendS3HttpMetadata(args, normalizedHttpMetadata);
    if (storageClass) {
      const s3StorageClass =
        storageClass === "InfrequentAccess" ? "STANDARD_IA" : "STANDARD";
      args.push("--storage-class", s3StorageClass);
    }
    return ["aws", args];
  }
  const args = [
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
  ];
  appendWranglerHttpMetadata(args, normalizedHttpMetadata);
  if (storageClass) args.push("--storage-class", storageClass);
  return ["pnpm", args];
}

function appendS3HttpMetadata(args, metadata) {
  for (const [key, flag] of [
    ["contentType", "--content-type"],
    ["contentDisposition", "--content-disposition"],
    ["contentEncoding", "--content-encoding"],
    ["contentLanguage", "--content-language"],
    ["cacheControl", "--cache-control"],
    ["cacheExpiry", "--expires"],
  ]) {
    if (metadata?.[key]) args.push(flag, metadata[key]);
  }
}

function appendWranglerHttpMetadata(args, metadata) {
  for (const [key, flag] of [
    ["contentType", "--content-type"],
    ["contentDisposition", "--content-disposition"],
    ["contentEncoding", "--content-encoding"],
    ["contentLanguage", "--content-language"],
    ["cacheControl", "--cache-control"],
    ["cacheExpiry", "--expires"],
  ]) {
    if (metadata?.[key]) args.push(flag, metadata[key]);
  }
}

// Native R2 listing API (paginated until the cursor is exhausted — never
// silently truncate). Captures HTTP + custom metadata for the sidecar.
export async function listR2Objects({
  bucket,
  accountId,
  token,
  fetchImpl = fetch,
}) {
  if (!bucket || !accountId || !token)
    throw new Error("bucket, accountId and token are required");
  assertAccountId(accountId);
  const objects = [];
  let cursor = null;
  const seenCursors = new Set();
  for (let pages = 0; ; pages++) {
    if (pages >= 10000)
      throw new Error("R2 listing exceeded 10M objects, refusing to continue");
    const url =
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucket)}/objects?per_page=1000` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    const response = await fetchImpl(url, {
      headers: { authorization: `Bearer ${token}` },
    });
    const payload = await response.json();
    if (response.ok !== true || payload.success !== true) {
      throw new Error(
        `R2 list failed (${response.status}): ${JSON.stringify(payload.errors ?? payload).slice(0, 200)}`,
      );
    }
    if (!Array.isArray(payload.result)) {
      throw new Error("R2 list response is missing its result array");
    }
    for (const object of payload.result) {
      if (typeof object?.key !== "string" || object.key === "") {
        throw new Error("R2 list response contains an object without a key");
      }
      objects.push({
        key: object.key,
        size: object.size ?? 0,
        etag: object.etag ?? null,
        lastModified: object.last_modified ?? null,
        ssec: object.ssec ?? false,
        storageClass: object.storage_class ?? null,
        httpMetadata: object.http_metadata ?? {},
        customMetadata: object.custom_metadata ?? {},
      });
    }
    const pagination = payload.result_info ?? {};
    cursor = pagination.cursor ?? null;
    if (pagination.is_truncated === true && !cursor) {
      throw new Error("R2 list response is truncated but missing cursor");
    }
    if (!cursor) break;
    if (seenCursors.has(cursor)) {
      throw new Error("R2 list response repeated a pagination cursor");
    }
    seenCursors.add(cursor);
  }
  return objects;
}

export function manifestFor({
  stack,
  outputs,
  files,
  methods = {},
  skipped = [],
  r2,
}) {
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
      assertSafeTableDumpFallback(plan.stack, plan.confirmQuiescent);
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
        stack: plan.stack,
        quiescent:
          plan.stack !== "production" && plan.confirmQuiescent === plan.stack,
      });
      methods[dbName] = summary.method;
      skipped.push(...summary.skipped);
      console.log(
        `Dumped D1 ${dbName} table-by-table (${summary.tables} tables, ${summary.rows} rows; FTS5 rebuilt from triggers on restore)`,
      );
    }
    files[dbName] = backupRelativePath(outDir, outputFile);
  }
  let r2 = null;
  if (!plan.skipR2) {
    const destDir = join(outDir, "r2", outputs.documentsBucketName);
    await mkdir(destDir, { recursive: true });
    const token = process.env.CLOUDFLARE_API_TOKEN;
    if (!token) {
      throw new Error(
        "CLOUDFLARE_API_TOKEN is required to preserve complete R2 metadata",
      );
    }
    const objects = await listR2Objects({
      bucket: outputs.documentsBucketName,
      accountId,
      token,
    });
    const metadata = Object.fromEntries(
      objects.map((object) => [object.key, object]),
    );
    const metadataFile = join(outDir, "r2-metadata.json");
    await writeFile(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`);
    if (hasS3Credentials()) {
      const [command, args] = buildR2SyncCommand({
        bucket: outputs.documentsBucketName,
        destDir,
        accountId,
      });
      await execFileAsync(command, args, { cwd: repoRoot });
      r2 = {
        bucket: outputs.documentsBucketName,
        path: backupRelativePath(outDir, destDir),
        method: "s3-sync",
        objects: objects.length,
        metadataFile: backupRelativePath(outDir, metadataFile),
      };
      console.log(`Synced R2 ${outputs.documentsBucketName}`);
    } else {
      for (const object of objects) {
        // Validate before joining: a malicious key must never escape destDir.
        assertSafeR2Key(object.key);
        const destFile = join(destDir, object.key);
        await mkdir(dirname(destFile), { recursive: true });
        const [command, args] = buildR2ObjectGetCommand({
          bucket: outputs.documentsBucketName,
          key: object.key,
          destFile,
        });
        await execFileAsync(command, args, { cwd: repoRoot });
      }
      r2 = {
        bucket: outputs.documentsBucketName,
        path: backupRelativePath(outDir, destDir),
        method: "object-get",
        objects: objects.length,
        metadataFile: backupRelativePath(outDir, metadataFile),
      };
      console.log(
        `Downloaded ${objects.length} R2 object(s) from ${outputs.documentsBucketName}`,
      );
    }
  }
  const manifest = manifestFor({
    stack: plan.stack,
    outputs,
    files,
    methods,
    skipped,
    r2,
  });
  await writeFile(
    join(outDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
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
