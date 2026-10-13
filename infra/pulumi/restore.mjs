// Restore a stack from a backup manifest written by backup.mjs.
// Flow for disaster recovery:
//   1. pulumi up recreates empty D1 databases + R2 bucket (idempotent).
//   2. D1 SQL exports are loaded back with wrangler d1 execute --file.
//   3. R2 objects are restored object-by-object with their captured metadata.
// Afterwards run scripts/apply-d1-migrations.mjs to catch up with any
// migrations newer than the backup, then redeploy workers via CI.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, lstat } from "node:fs/promises";
import { join, relative, sep, dirname, resolve, isAbsolute } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { buildR2ObjectPutCommand } from "./backup.mjs";
import { createMaintenanceClient } from "../../scripts/flows-maintenance.mjs";
import {
  validateFlowsSnapshotManifest,
  verifyFlowsSnapshotPages,
} from "./flows-snapshot.mjs";
import { assertDeploymentAccount, parseStackOutputs } from "./outputs.mjs";
import {
  assertAccountId,
  assertSafeR2Key,
  normalizeEnvironment,
  resolveInfraNames,
  validateFlowsResources,
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

function assertVersion2RelativePath(path, label) {
  if (
    typeof path !== "string" ||
    path === "" ||
    isAbsolute(path) ||
    path.includes("\\") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`Backup manifest contains an unsafe ${label} path`);
  }
}

function resolveD1DatabaseName(key, databaseNames, flowsDatabaseName = null) {
  if (key === "auth") return databaseNames.auth;
  if (key === "domain") return databaseNames.domain;
  if (key === "flows" && flowsDatabaseName) return flowsDatabaseName;
  if (key === databaseNames.auth) return databaseNames.auth;
  if (key === databaseNames.domain) return databaseNames.domain;
  if (flowsDatabaseName && key === flowsDatabaseName) return flowsDatabaseName;
  throw new Error(
    `D1 manifest key ${key} is not a database name for the selected stack`,
  );
}

function validateD1Manifest(manifest, flowsDatabaseName = null) {
  if (!isRecord(manifest.d1) || Object.keys(manifest.d1).length === 0) {
    throw new Error("Backup manifest is missing D1 files");
  }
  const databaseNames = manifest.pulumiOutputs.databaseNames;
  const resolvedNames = new Set();
  for (const [key, path] of Object.entries(manifest.d1)) {
    if (typeof path !== "string" || path.trim() === "") {
      throw new Error(`D1 backup path for ${key} is invalid`);
    }
    const name = resolveD1DatabaseName(key, databaseNames, flowsDatabaseName);
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
    const databaseName = resolveD1DatabaseName(
      key,
      databaseNames,
      flowsDatabaseName,
    );
    if (method !== "export" && method !== "table-dump") {
      throw new Error(`Unsupported D1 method for ${key}: ${method}`);
    }
    if (method === "table-dump" && databaseName === databaseNames.auth) {
      throw new Error(
        "Auth D1 table-dump restore is unsupported because its schema migrations cannot be reconstructed safely",
      );
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
  if (!manifest || ![1, 2].includes(manifest.version))
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
  if (manifest.r2 && manifest.r2.bucket !== outputs.documentsBucketName) {
    throw new Error(
      "Backup manifest documents R2 bucket does not match its Pulumi output",
    );
  }
  let flowsDatabaseName = null;
  if (manifest.version === 2) {
    if (!isRecord(manifest.integrity)) {
      throw new Error("Backup integrity hashes must be an object");
    }
    if (manifest.r2Buckets !== undefined && !isRecord(manifest.r2Buckets)) {
      throw new Error("R2 bucket backups must be an object");
    }
    const paths = [
      ...Object.values(manifest.d1 ?? {}),
      ...(manifest.r2 ? [manifest.r2.path, manifest.r2.metadataFile] : []),
      ...Object.values(manifest.r2Buckets ?? {}).flatMap((entry) => {
        if (!isRecord(entry))
          throw new Error("R2 bucket backup entry must be an object");
        return [entry.path, entry.metadataFile];
      }),
      ...(manifest.flowsSnapshot ? [manifest.flowsSnapshot.path] : []),
      ...Object.keys(manifest.integrity),
    ];
    for (const path of paths) assertVersion2RelativePath(path, "backup file");
    if (typeof outputs.flowsEnabled !== "boolean") {
      throw new Error("Backup manifest is missing flowsEnabled");
    }
    if (!outputs.flowsEnabled) {
      if (outputs.flowsResources !== null) {
        throw new Error(
          "Disabled Flows manifest contains provisioned resources",
        );
      }
      if (manifest.r2Buckets && Object.keys(manifest.r2Buckets).length > 0) {
        throw new Error("Disabled Flows manifest contains Flow R2 backups");
      }
    } else {
      const flows = validateFlowsResources(
        outputs.flowsResources,
        manifest.stack,
      );
      const expectedNames = resolveInfraNames({
        environment: manifest.stack,
        documentsBucket: outputs.documentsBucketName,
        publicOrigin: outputs.resolvedPublicOrigin,
      }).flows;
      const planned = outputs.plannedFlowsResourceNames;
      if (
        !planned ||
        planned.database !== expectedNames.database ||
        planned.kvNamespace !== expectedNames.kvNamespace ||
        planned.worker !== expectedNames.worker ||
        planned.queue !== expectedNames.queue ||
        planned.workflow !== expectedNames.workflow ||
        JSON.stringify(planned.buckets) !==
          JSON.stringify(expectedNames.buckets)
      ) {
        throw new Error(
          "Backup manifest Flows resource names do not match its resolved environment",
        );
      }
      if (flows.buckets.resources !== expectedNames.buckets.resources) {
        throw new Error(
          "Backup manifest Flow bucket names do not match its resolved environment",
        );
      }
      flowsDatabaseName = expectedNames.database;
      if (!manifest.r2) {
        throw new Error(
          "Enabled Flows manifest is missing the documents R2 backup",
        );
      }
      if (!manifest.d1 || !Object.hasOwn(manifest.d1, expectedNames.database)) {
        throw new Error("Enabled Flows manifest is missing its D1 backup");
      }
      if (manifest.r2) {
        const buckets = manifest.r2Buckets;
        const bucketKinds = Object.keys(buckets ?? {}).sort();
        if (
          JSON.stringify(bucketKinds) !==
          JSON.stringify(["datasets", "inboxes", "resources"])
        ) {
          throw new Error(
            "Enabled Flows manifest must contain exactly the resources, datasets, and inboxes R2 backups",
          );
        }
        for (const kind of ["resources", "datasets", "inboxes"]) {
          if (
            !buckets?.[kind] ||
            buckets[kind].bucket !== flows.buckets[kind]
          ) {
            throw new Error(
              `Enabled Flows manifest is missing the ${kind} R2 backup`,
            );
          }
        }
      }
    }
    if (outputs.flowsEnabled && !manifest.flowsSnapshot) {
      throw new Error(
        "Enabled Flows manifest is missing its runtime snapshot evidence",
      );
    }
    if (
      manifest.flowsSnapshot &&
      manifest.flowsSnapshot.method !== "flows-maintenance-export"
    ) {
      throw new Error("Unsupported Flows runtime snapshot method");
    }
  }
  validateD1Manifest(manifest, flowsDatabaseName);
  return manifest;
}

export async function verifyManifestIntegrity(manifest, manifestFile) {
  if (manifest.version === 1) return;
  const hashes = manifest.integrity;
  if (!isRecord(hashes))
    throw new Error("Backup manifest is missing integrity hashes");
  const referenced = [
    ...Object.values(manifest.d1 ?? {}),
    ...(manifest.r2 ? [manifest.r2.metadataFile] : []),
    ...Object.values(manifest.r2Buckets ?? {}).map(
      (bucket) => bucket.metadataFile,
    ),
    ...(manifest.flowsSnapshot ? [manifest.flowsSnapshot.path] : []),
  ].filter(Boolean);
  for (const path of referenced) {
    if (!Object.hasOwn(hashes, path)) {
      throw new Error(`Backup integrity hash is missing for ${path}`);
    }
  }
  const backupRoot = dirname(resolve(manifestFile));
  const manifestRelativePath = relative(backupRoot, resolve(manifestFile))
    .split(sep)
    .join("/");
  const capturedFiles = (await listLocalFiles(backupRoot)).filter(
    (path) => path !== manifestRelativePath,
  );
  const hashedFiles = new Set(Object.keys(hashes));
  if (
    hashedFiles.size !== capturedFiles.length ||
    capturedFiles.some((path) => !hashedFiles.has(path))
  ) {
    throw new Error(
      "Backup integrity hash inventory does not cover every backup file",
    );
  }
  for (const [path, expected] of Object.entries(hashes)) {
    if (!/^[a-f0-9]{64}$/.test(expected)) {
      throw new Error(`Backup integrity hash for ${path} is invalid`);
    }
    const fullPath = resolveManifestPath(manifestFile, path);
    const info = await lstat(fullPath);
    if (!info.isFile())
      throw new Error(`Backup integrity target is not a regular file: ${path}`);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(fullPath)) hash.update(chunk);
    if (hash.digest("hex") !== expected) {
      throw new Error(`Backup integrity check failed for ${path}`);
    }
  }
}

export async function assertFlowsRestoreMaintenance(
  manifest,
  { env = process.env, fetchImpl = fetch } = {},
) {
  const outputs = manifest?.pulumiOutputs;
  if (outputs?.flowsEnabled !== true) return;
  const secret = env?.SAVIA_FLOWS_BRIDGE_SECRET;
  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error(
      "SAVIA_FLOWS_BRIDGE_SECRET is required to verify Flows restore maintenance",
    );
  }
  const stack = normalizeEnvironment(manifest.stack);
  const expectedOrigin = resolveInfraNames({
    environment: stack,
    documentsBucket: outputs.documentsBucketName,
    publicOrigin: outputs.resolvedPublicOrigin,
  }).publicOrigin;
  if (outputs.resolvedPublicOrigin !== expectedOrigin) {
    throw new Error(
      "Flows restore maintenance origin does not match the selected stack",
    );
  }
  const request = createMaintenanceClient({
    origin: expectedOrigin,
    bridgeSecret: secret,
    fetchImpl,
  });
  const status = await request({ action: "status" });
  if (
    status.executionEnabled !== false ||
    status.maintenance !== true ||
    !Number.isInteger(status.activeRuns) ||
    status.activeRuns !== 0
  ) {
    throw new Error(
      "Flows restore requires execution paused, maintenance enabled, and zero active runs",
    );
  }
}

export function buildFlowsD1MigrationsCommand(workerName, stack) {
  normalizeEnvironment(stack);
  if (typeof workerName !== "string" || workerName.trim() === "") {
    throw new Error("Flows worker name is required to apply D1 migrations");
  }
  return [
    "pnpm",
    [
      "--filter",
      "@savia/flows-api",
      "exec",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      workerName,
      "--remote",
      "--config",
      `wrangler.${stack}.jsonc`,
    ],
  ];
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
  expectedOutputs,
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
  const { stdout: outputJson } = await execFileImpl(
    "pulumi",
    ["stack", "output", "--stack", stack, "--json"],
    { cwd },
  );
  const liveOutputs = parseStackOutputs(outputJson);
  assertDeploymentAccount(liveOutputs, expectedAccountId);
  if (
    liveOutputs.resolvedEnvironment !== expectedOutputs.resolvedEnvironment ||
    liveOutputs.documentsBucketName !== expectedOutputs.documentsBucketName ||
    liveOutputs.resolvedPublicOrigin !== expectedOutputs.resolvedPublicOrigin ||
    liveOutputs.databaseNames?.auth !== expectedOutputs.databaseNames?.auth ||
    liveOutputs.databaseNames?.domain !==
      expectedOutputs.databaseNames?.domain ||
    (typeof expectedOutputs.flowsEnabled === "boolean" &&
      liveOutputs.flowsEnabled !== expectedOutputs.flowsEnabled) ||
    (expectedOutputs.flowsEnabled === true &&
      (liveOutputs.plannedFlowsResourceNames?.database !==
        expectedOutputs.plannedFlowsResourceNames?.database ||
        JSON.stringify(liveOutputs.flowsResources?.buckets) !==
          JSON.stringify(expectedOutputs.flowsResources?.buckets) ||
        liveOutputs.flowsResources?.workerName !==
          expectedOutputs.flowsResources?.workerName ||
        liveOutputs.flowsResources?.queueName !==
          expectedOutputs.flowsResources?.queueName ||
        liveOutputs.flowsResources?.workflowName !==
          expectedOutputs.flowsResources?.workflowName))
  ) {
    throw new Error(
      "Live Pulumi environment, bucket, or database names do not match the restore manifest",
    );
  }
  return liveOutputs;
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
  const flowsDatabaseName =
    manifest.version === 2 && manifest.pulumiOutputs.flowsEnabled
      ? manifest.pulumiOutputs.plannedFlowsResourceNames.database
      : null;
  const bucket = manifest.pulumiOutputs.documentsBucketName;
  const manifestFile = resolve(plan.manifest);
  const resolvedD1Files = Object.fromEntries(
    Object.entries(manifest.d1).map(([name, path]) => [
      name,
      resolveManifestPath(manifestFile, path),
    ]),
  );
  await verifyManifestIntegrity(manifest, resolve(plan.manifest));

  if (plan.dryRun) {
    console.log(`Would restore stack ${manifest.stack} from ${plan.manifest}`);
    if (!plan.skipInfra)
      console.log(`Would run: pulumi up --stack ${manifest.stack} --yes`);
    console.log(`Would load D1: ${Object.keys(resolvedD1Files).join(", ")}`);
    if (manifest.r2) console.log(`Would restore R2 bucket: ${bucket}`);
    for (const backup of Object.values(manifest.r2Buckets ?? {})) {
      console.log(`Would restore R2 bucket: ${backup.bucket}`);
    }
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
  const r2RestorePlans = [];
  const r2Sidecars = new Map();
  const r2Backups = [
    ...(manifest.r2 ? [{ ...manifest.r2, slot: "documents" }] : []),
    ...Object.entries(manifest.r2Buckets ?? {}).map(([slot, backup]) => ({
      ...backup,
      slot,
    })),
  ];
  for (const backup of r2Backups) {
    if (!backup.metadataFile) {
      throw new Error(
        "This R2 backup has no metadata sidecar; refusing a restore that would silently lose object metadata",
      );
    }
    if (!["object-get", "s3-sync"].includes(backup.method)) {
      throw new Error(`Unsupported R2 backup method: ${backup.method}`);
    }
    const metadataFile = resolveManifestPath(manifestFile, backup.metadataFile);
    const sidecar = await readSidecar(metadataFile);
    r2Sidecars.set(backup.slot, sidecar);
    const sourceDir = resolveManifestPath(manifestFile, backup.path);
    r2RestorePlans.push(
      await buildR2ObjectRestorePlan({
        bucket: backup.bucket,
        sourceDir,
        sidecar,
        accountId,
        expectedObjects: backup.objects,
      }),
    );
  }

  const d1Names = manifest.pulumiOutputs.databaseNames;
  const tableDumpDatabases = Object.entries(manifest.d1Methods ?? {})
    .filter(([, method]) => method === "table-dump")
    .map(([key]) => resolveD1DatabaseName(key, d1Names, flowsDatabaseName));
  const restoreDomainSchema = tableDumpDatabases.includes(d1Names.domain);
  const restoreFlowsSchema =
    flowsDatabaseName !== null &&
    tableDumpDatabases.includes(flowsDatabaseName);

  if (manifest.flowsSnapshot) {
    const snapshotPath = resolveManifestPath(
      manifestFile,
      manifest.flowsSnapshot.path,
    );
    const snapshot = validateFlowsSnapshotManifest(
      JSON.parse(await readFile(snapshotPath, "utf8")),
    );
    const expectedPages = snapshot.objects.reduce(
      (sum, object) => sum + object.pages.length,
      0,
    );
    if (
      snapshot.id !== manifest.flowsSnapshot.id ||
      expectedPages !== manifest.flowsSnapshot.pages
    ) {
      throw new Error(
        "Flows runtime snapshot evidence does not match its backup manifest",
      );
    }
    const resourcesBackup = manifest.r2Buckets?.resources;
    if (!resourcesBackup)
      throw new Error("Flows runtime snapshot has no resources bucket backup");
    await verifyFlowsSnapshotPages(snapshot, {
      bucket: resourcesBackup.bucket,
      sidecar: r2Sidecars.get("resources"),
      sourceDir: resolveManifestPath(manifestFile, resourcesBackup.path),
    });
  }

  // Do not overwrite a live Flows installation: status must prove the remote
  // worker is paused, in maintenance mode, and has drained all active runs.
  await assertFlowsRestoreMaintenance(manifest);

  let restoreDomainD1Id = manifest.pulumiOutputs.domainD1Id;
  if (!plan.skipInfra) {
    const liveOutputs = await runPulumiUpForRestore({
      stack: manifest.stack,
      accountId: manifest.pulumiOutputs.cloudflareAccountId,
      expectedOutputs: manifest.pulumiOutputs,
      cwd: pulumiCwd,
    });
    restoreDomainD1Id = liveOutputs.domainD1Id;
  }
  if (!plan.skipMigrations && restoreDomainSchema) {
    await execFileAsync("node", ["scripts/apply-d1-migrations.mjs"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CLOUDFLARE_DATABASE_ID: restoreDomainD1Id,
      },
    });
    console.log("Applied domain D1 migrations before loading table dumps");
  }
  if (!plan.skipMigrations && restoreFlowsSchema) {
    const [command, args] = buildFlowsD1MigrationsCommand(
      manifest.pulumiOutputs.flowsResources.workerName,
      manifest.stack,
    );
    await execFileAsync(command, args, { cwd: repoRoot });
    console.log("Applied Flows D1 migrations before loading table dumps");
  }
  for (const [dbName, sqlFile] of Object.entries(resolvedD1Files)) {
    const [command, args] = buildD1ExecuteCommand(
      resolveD1DatabaseName(dbName, dbNames, flowsDatabaseName),
      sqlFile,
    );
    await execFileAsync(command, args, { cwd: repoRoot });
    console.log(`Restored D1 ${dbName}`);
  }
  for (let index = 0; index < r2Backups.length; index++) {
    const backup = r2Backups[index];
    for (const { command, args } of r2RestorePlans[index]) {
      await execFileAsync(command, args, { cwd: repoRoot });
    }
    console.log(`Restored R2 ${backup.bucket} object by object`);
  }
  if (manifest.flowsSnapshot) {
    console.log(
      "D1 and R2 restore finished. Flows recovery remains incomplete until the Durable Object snapshot is imported through scripts/flows-maintenance.mjs --action restore; keep execution paused.",
    );
  } else {
    console.log("D1 and R2 restore finished.");
  }
  console.log(
    "Next: verify recovered persistence, apply any outstanding migrations, then redeploy the paused workers via CI.",
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
