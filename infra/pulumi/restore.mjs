// Restore a stack from a backup manifest written by backup.mjs.
// Flow for disaster recovery:
//   1. pulumi up recreates empty D1 databases + R2 bucket (idempotent).
//   2. D1 SQL exports are loaded back with wrangler d1 execute --file.
//   3. R2 objects are restored object-by-object with their captured metadata.
// Afterwards run scripts/apply-d1-migrations.mjs to catch up with any
// migrations newer than the backup, then redeploy workers via CI.
import { execFile } from "node:child_process";
import { readFile, readdir, lstat } from "node:fs/promises";
import { join, relative, sep, dirname, resolve, isAbsolute } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { buildR2ObjectPutCommand } from "./backup.mjs";
import { assertDeploymentAccount } from "./outputs.mjs";
import {
  assertAccountId,
  assertSafeR2Key,
  normalizeEnvironment,
  resolveInfraNames,
} from "./naming.mjs";

const execFileAsync = promisify(execFile);

export function parseRestoreArgs(argv) {
  const manifest = flagValue(argv, "--manifest");
  const dryRun = argv.includes("--dry-run");
  const apply = argv.includes("--apply");
  const skipInfra = argv.includes("--skip-infra");
  const skipMigrations = argv.includes("--skip-migrations");
  if (!dryRun && !apply) {
    throw new Error(
      "Refusing to restore without --apply (or use --dry-run to plan)",
    );
  }
  const confirmIndex = argv.indexOf("--confirm-restore");
  const confirm =
    confirmIndex !== -1 && argv[confirmIndex + 1]
      ? argv[confirmIndex + 1]
      : null;
  if (confirm) normalizeEnvironment(confirm);
  if (!dryRun && !confirm) {
    throw new Error("Restore requires --confirm-restore <preview|production>");
  }
  return { manifest, dryRun, skipInfra, skipMigrations, confirm };
}

// Table dumps carry data but no schema: migrations must create tables,
// triggers, and the FTS5 definition before the dump is loaded (and the
// FTS5 index rebuilds via triggers on INSERT).
export function needsMigrations(manifest) {
  return Object.values(manifest?.d1Methods ?? {}).includes("table-dump");
}

// Reads the R2 metadata sidecar written by every current backup method.
// Older object-get manifests may omit it; main rejects any R2 restore without
// a sidecar so metadata cannot disappear silently.
export async function readSidecar(metadataFile) {
  if (!metadataFile) return {};
  const sidecar = JSON.parse(await readFile(metadataFile, "utf8"));
  if (!sidecar || typeof sidecar !== "object" || Array.isArray(sidecar)) {
    throw new Error("R2 metadata sidecar must contain an object");
  }
  return sidecar;
}

export function resolveManifestPath(manifestFile, path) {
  if (typeof path !== "string" || path.trim() === "") {
    throw new Error("Backup manifest contains an invalid file path");
  }
  if (isAbsolute(path)) return path;
  const base = resolve(dirname(manifestFile));
  const target = resolve(base, path);
  const fromBase = relative(base, target);
  if (
    fromBase === ".." ||
    fromBase.startsWith(`..${sep}`) ||
    isAbsolute(fromBase)
  ) {
    throw new Error("Relative backup path escapes the manifest directory");
  }
  return target;
}

// Lists files under dir as slash-separated keys (R2 object names).
export async function listLocalFiles(dir, base = dir) {
  if (!(await lstat(dir)).isDirectory()) {
    throw new Error(`R2 backup path is not a directory: ${dir}`);
  }
  const entries = [];
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    const info = await lstat(full);
    if (info.isSymbolicLink()) {
      throw new Error(`Refusing to restore through symbolic link ${full}`);
    }
    if (info.isDirectory()) {
      entries.push(...(await listLocalFiles(full, base)));
    } else if (info.isFile()) {
      entries.push(relative(base, full).split(sep).join("/"));
    } else {
      throw new Error(`Refusing unsupported file type in R2 backup: ${full}`);
    }
  }
  return entries.sort();
}

function flagValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1 || index + 1 >= argv.length)
    throw new Error(`Missing required flag: ${flag} <value>`);
  const value = argv[index + 1];
  if (typeof value !== "string" || value.startsWith("--") || value === "")
    throw new Error(`Missing required flag: ${flag} <value>`);
  return value;
}

export function metadataForObject(sidecar, key) {
  if (!Object.hasOwn(sidecar, key)) {
    throw new Error(`R2 metadata sidecar is missing object ${key}`);
  }
  const metadata = sidecar[key];
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error(`R2 metadata for ${key} is invalid`);
  }
  for (const field of ["httpMetadata", "customMetadata"]) {
    const value = metadata[field] ?? {};
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`R2 ${field} for ${key} is invalid`);
    }
  }
  if (metadata.ssec === true) {
    throw new Error(
      `R2 object ${key} uses customer-supplied encryption and cannot be restored without its encryption key`,
    );
  }
  return metadata;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resolveD1DatabaseName(key, databaseNames) {
  if (key === "auth") return databaseNames.auth;
  if (key === "domain") return databaseNames.domain;
  if (key === databaseNames.auth) return databaseNames.auth;
  if (key === databaseNames.domain) return databaseNames.domain;
  throw new Error(
    `D1 manifest key ${key} is not a database name for ${databaseNames.auth} or ${databaseNames.domain}`,
  );
}

function validateD1Manifest(manifest) {
  if (!isRecord(manifest.d1) || Object.keys(manifest.d1).length === 0) {
    throw new Error("Backup manifest is missing D1 files");
  }
  const databaseNames = manifest.pulumiOutputs.databaseNames;
  const resolvedNames = new Set();
  for (const [key, path] of Object.entries(manifest.d1)) {
    if (typeof path !== "string" || path.trim() === "") {
      throw new Error(`D1 backup path for ${key} is invalid`);
    }
    const name = resolveD1DatabaseName(key, databaseNames);
    if (resolvedNames.has(name)) {
      throw new Error(`D1 manifest contains multiple entries for ${name}`);
    }
    resolvedNames.add(name);
  }

  const methods = manifest.d1Methods;
  if (methods === undefined) return;
  if (!isRecord(methods)) {
    throw new Error("D1 backup methods must be an object");
  }
  for (const [key, method] of Object.entries(methods)) {
    if (!Object.hasOwn(manifest.d1, key)) {
      throw new Error(`D1 backup method has no matching file: ${key}`);
    }
    resolveD1DatabaseName(key, databaseNames);
    if (method !== "export" && method !== "table-dump") {
      throw new Error(`Unsupported D1 method for ${key}: ${method}`);
    }
  }
}

export async function buildR2ObjectRestorePlan({
  bucket,
  sourceDir,
  sidecar,
  accountId,
  expectedObjects,
}) {
  const keys = await listLocalFiles(sourceDir);
  if (Number.isInteger(expectedObjects) && keys.length !== expectedObjects) {
    throw new Error(
      `R2 backup expected ${expectedObjects} objects but contains ${keys.length}`,
    );
  }
  const metadataKeys = Object.keys(sidecar).sort();
  if (JSON.stringify(metadataKeys) !== JSON.stringify(keys)) {
    throw new Error(
      "R2 backup files and metadata sidecar do not contain the same keys",
    );
  }
  return keys.map((key) => {
    assertSafeR2Key(key);
    const metadata = metadataForObject(sidecar, key);
    const [command, args] = buildR2ObjectPutCommand({
      bucket,
      key,
      sourceFile: join(sourceDir, ...key.split("/")),
      httpMetadata: metadata.httpMetadata,
      customMetadata: metadata.customMetadata,
      accountId,
      storageClass: metadata.storageClass,
    });
    return { command, args, key };
  });
}

export function validateManifest(manifest, confirm, runtimeAccountId) {
  if (!manifest || manifest.version !== 1)
    throw new Error("Unsupported backup manifest version");
  if (typeof manifest.stack !== "string" || !manifest.stack)
    throw new Error("Backup manifest is missing its stack");
  normalizeEnvironment(manifest.stack);
  const outputs = manifest.pulumiOutputs;
  if (!outputs || typeof outputs !== "object") {
    throw new Error("Backup manifest is missing Pulumi outputs");
  }
  if (manifest.pulumiOutputs?.resolvedEnvironment !== manifest.stack) {
    throw new Error(
      `Backup stack ${manifest.stack} disagrees with its Pulumi resolved environment; refusing restore`,
    );
  }
  for (const field of [
    "cloudflareAccountId",
    "authD1Id",
    "domainD1Id",
    "documentsBucketName",
    "resolvedPublicOrigin",
  ]) {
    if (typeof outputs[field] !== "string" || outputs[field].trim() === "") {
      throw new Error(`Backup manifest is missing Pulumi output ${field}`);
    }
  }
  const manifestAccountId = assertAccountId(outputs.cloudflareAccountId);
  if (runtimeAccountId) {
    const targetAccountId = assertAccountId(runtimeAccountId);
    if (manifestAccountId !== targetAccountId) {
      throw new Error(
        "Backup manifest Cloudflare account does not match the restore target account",
      );
    }
  }
  const expectedNames = resolveInfraNames({
    environment: manifest.stack,
    documentsBucket: outputs.documentsBucketName,
    publicOrigin: outputs.resolvedPublicOrigin,
  });
  if (
    outputs.databaseNames?.auth !== expectedNames.databases.auth ||
    outputs.databaseNames?.domain !== expectedNames.databases.domain
  ) {
    throw new Error(
      "Backup manifest database names do not match its resolved environment",
    );
  }
  if (confirm && manifest.stack !== confirm) {
    throw new Error(
      `Manifest is for stack ${manifest.stack}, not ${confirm}. Refusing.`,
    );
  }
  validateD1Manifest(manifest);
  return manifest;
}

// wrangler d1 execute <name> --remote --file <sql>
export function buildD1ExecuteCommand(dbName, sqlFile) {
  if (!dbName || !sqlFile) throw new Error("dbName and sqlFile required");
  return [
    "pnpm",
    [
      "--filter",
      "@savia/api",
      "exec",
      "wrangler",
      "d1",
      "execute",
      dbName,
      "--remote",
      "--file",
      sqlFile,
    ],
  ];
}

// aws s3 sync <dir> s3://<bucket> --endpoint-url https://<account>.r2.cloudflarestorage.com
export function buildR2RestoreCommand({ bucket, sourceDir, accountId }) {
  if (!bucket || !sourceDir) throw new Error("bucket and sourceDir required");
  assertAccountId(accountId);
  return [
    "aws",
    [
      "s3",
      "sync",
      sourceDir,
      `s3://${bucket}`,
      "--endpoint-url",
      `https://${accountId}.r2.cloudflarestorage.com`,
    ],
  ];
}

export async function runPulumiUpForRestore({
  stack,
  accountId,
  cwd,
  execFileImpl = execFileAsync,
}) {
  normalizeEnvironment(stack);
  const expectedAccountId = assertAccountId(accountId);
  const { stdout } = await execFileImpl(
    "pulumi",
    ["config", "get", "accountId", "--stack", stack],
    { cwd },
  );
  const configuredAccountId = String(stdout ?? "").trim();
  assertDeploymentAccount(
    { cloudflareAccountId: configuredAccountId },
    expectedAccountId,
  );
  await execFileImpl("pulumi", ["up", "--stack", stack, "--yes"], {
    cwd,
    stdio: "inherit",
  });
}

async function main() {
  const plan = parseRestoreArgs(process.argv.slice(2));
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const manifest = validateManifest(
    JSON.parse(await readFile(plan.manifest, "utf8")),
    plan.confirm,
    accountId,
  );
  const pulumiCwd = fileURLToPath(new URL(".", import.meta.url));
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  const dbNames = manifest.pulumiOutputs.databaseNames;
  const bucket = manifest.pulumiOutputs.documentsBucketName;
  const manifestFile = resolve(plan.manifest);
  const resolvedD1Files = Object.fromEntries(
    Object.entries(manifest.d1).map(([name, path]) => [
      name,
      resolveManifestPath(manifestFile, path),
    ]),
  );
  const r2Path = manifest.r2
    ? resolveManifestPath(manifestFile, manifest.r2.path)
    : null;

  if (plan.dryRun) {
    console.log(`Would restore stack ${manifest.stack} from ${plan.manifest}`);
    if (!plan.skipInfra)
      console.log(`Would run: pulumi up --stack ${manifest.stack} --yes`);
    console.log(`Would load D1: ${Object.keys(resolvedD1Files).join(", ")}`);
    if (manifest.r2) console.log(`Would sync R2 bucket back: ${bucket}`);
    return;
  }
  if (!accountId) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID is required for D1 restore");
  }

  for (const [dbName, sqlFile] of Object.entries(resolvedD1Files)) {
    const info = await lstat(sqlFile);
    if (!info.isFile()) {
      throw new Error(`D1 backup for ${dbName} is not a regular file`);
    }
  }
  let r2RestorePlan = null;
  if (manifest.r2) {
    if (!manifest.r2.metadataFile) {
      throw new Error(
        "This R2 backup has no metadata sidecar; refusing a restore that would silently lose object metadata",
      );
    }
    if (!["object-get", "s3-sync"].includes(manifest.r2.method)) {
      throw new Error(`Unsupported R2 backup method: ${manifest.r2.method}`);
    }
    const metadataFile = resolveManifestPath(
      manifestFile,
      manifest.r2.metadataFile,
    );
    const sidecar = await readSidecar(metadataFile);
    r2RestorePlan = await buildR2ObjectRestorePlan({
      bucket,
      sourceDir: r2Path,
      sidecar,
      accountId,
      expectedObjects: manifest.r2.objects,
    });
  }

  if (!plan.skipInfra) {
    await runPulumiUpForRestore({
      stack: manifest.stack,
      accountId: manifest.pulumiOutputs.cloudflareAccountId,
      cwd: pulumiCwd,
    });
  }
  if (needsMigrations(manifest) && !plan.skipMigrations) {
    await execFileAsync("node", ["scripts/apply-d1-migrations.mjs"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CLOUDFLARE_DATABASE_ID: manifest.pulumiOutputs.domainD1Id,
      },
    });
    console.log("Applied D1 migrations before loading table dumps");
  }
  for (const [dbName, sqlFile] of Object.entries(resolvedD1Files)) {
    const [command, args] = buildD1ExecuteCommand(
      resolveD1DatabaseName(dbName, dbNames),
      sqlFile,
    );
    await execFileAsync(command, args, { cwd: repoRoot });
    console.log(`Restored D1 ${dbName}`);
  }
  if (manifest.r2) {
    for (const { command, args } of r2RestorePlan) {
      await execFileAsync(command, args, { cwd: repoRoot });
    }
    console.log(`Restored R2 ${bucket} object by object`);
  }
  console.log(
    "Restore complete. Next: node scripts/apply-d1-migrations.mjs, then redeploy workers via CI.",
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
