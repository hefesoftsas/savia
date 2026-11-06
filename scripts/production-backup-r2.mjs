import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  chmod,
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, isAbsolute } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
export const PRODUCTION_BACKUP_BUCKET = "savia-production-backups";
export const R2_BACKUP_PREFIX = "production/";
const MAGIC = Buffer.from("SAVIAFB1");
const BACKUP_KINDS = new Set(["daily", "release", "migration"]);

function requiredEnvironment(env) {
  if (env.SAVIA_BACKUP_ENVIRONMENT !== "production")
    throw new Error("An explicit production environment is required");
  if (env.SAVIA_BACKUP_BUCKET !== PRODUCTION_BACKUP_BUCKET)
    throw new Error(
      "The production backup bucket must be savia-production-backups",
    );
  if (!/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID ?? ""))
    throw new Error("A valid Cloudflare account ID is required for R2");
  if (!env.R2_BACKUP_ACCESS_KEY_ID || !env.R2_BACKUP_SECRET_ACCESS_KEY)
    throw new Error("Dedicated R2 backup credentials are required");
  return {
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    accessKeyId: env.R2_BACKUP_ACCESS_KEY_ID,
    secretAccessKey: env.R2_BACKUP_SECRET_ACCESS_KEY,
  };
}

export function createR2Client({
  env = process.env,
  execFileImpl = execFileAsync,
} = {}) {
  const credentials = requiredEnvironment(env);
  const endpoint = `https://${credentials.accountId}.r2.cloudflarestorage.com`;
  const awsEnv = {
    PATH: env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    AWS_ACCESS_KEY_ID: credentials.accessKeyId,
    AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    AWS_DEFAULT_REGION: "auto",
    AWS_EC2_METADATA_DISABLED: "true",
    AWS_CONFIG_FILE: "/dev/null",
    AWS_SHARED_CREDENTIALS_FILE: "/dev/null",
    AWS_CLI_AUTO_PROMPT: "off",
    AWS_PAGER: "",
  };

  return {
    endpoint,
    async call(operation, args, { maxBuffer = 4 * 1024 * 1024 } = {}) {
      try {
        const result = await execFileImpl(
          "aws",
          [
            "s3api",
            operation,
            ...args,
            "--endpoint-url",
            endpoint,
            "--output",
            "json",
          ],
          { env: awsEnv, encoding: "utf8", maxBuffer },
        );
        if (typeof result?.stdout !== "string")
          throw new Error("AWS CLI returned no JSON output");
        return JSON.parse(result.stdout || "{}");
      } catch {
        throw new Error("R2 provider operation failed");
      }
    },
  };
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function validateCiphertext(path) {
  if (!isAbsolute(path))
    throw new Error("Backup artifact must use an absolute path");
  const filePath = resolve(path);
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile() || info.size < 36)
    throw new Error("Backup artifact is not a valid SAVIA encrypted backup");
  const handle = await open(filePath, "r");
  try {
    const magic = Buffer.alloc(MAGIC.length);
    const { bytesRead } = await handle.read(magic, 0, magic.length, 0);
    if (bytesRead !== MAGIC.length || !magic.equals(MAGIC))
      throw new Error("Backup artifact is not a SAVIA encrypted backup");
  } finally {
    await handle.close();
  }
  return {
    path: filePath,
    size: info.size,
    sha256: await sha256File(filePath),
  };
}

function backupIdentity(env, kind) {
  if (!BACKUP_KINDS.has(kind))
    throw new Error("Backup kind must be daily, release, or migration");
  const runId = env.GITHUB_RUN_ID;
  const runAttempt = env.GITHUB_RUN_ATTEMPT;
  const sourceSha = (
    env.GITHUB_SHA ??
    env.SAVIA_SOURCE_SHA ??
    ""
  ).toLowerCase();
  if (
    !/^[1-9]\d{0,19}$/.test(runId ?? "") ||
    !/^[1-9]\d{0,5}$/.test(runAttempt ?? "")
  )
    throw new Error(
      "GitHub run ID and attempt are required to identify a backup",
    );
  if (!/^[a-f0-9]{7,64}$/.test(sourceSha))
    throw new Error("Source commit SHA is required to identify a backup");
  return { kind, runId, runAttempt, sourceSha };
}

function objectMetadata({ sha256, sourceSha, runId, runAttempt, kind }) {
  return {
    sha256,
    "source-sha": sourceSha,
    environment: "production",
    "run-id": runId,
    "run-attempt": runAttempt,
    kind,
    verified: "true",
  };
}

function sameMetadata(actual, expected) {
  if (!actual || typeof actual !== "object") return false;
  const keys = Object.keys(expected);
  return (
    Object.keys(actual).length === keys.length &&
    keys.every((key) => actual[key] === expected[key])
  );
}

async function getObject(client, bucket, key, path) {
  const privateFile = await open(path, "wx", 0o600).catch((error) => {
    if (error.code !== "EEXIST") throw error;
    return null;
  });
  await privateFile?.close();
  await client.call("get-object", ["--bucket", bucket, "--key", key, path]);
  await chmod(path, 0o600);
}

async function putMarker(
  client,
  bucket,
  markerKey,
  markerBytes,
  metadata,
  markerPath,
  markerCheckPath,
) {
  await writeFile(markerPath, markerBytes, { mode: 0o600, flag: "wx" });
  try {
    await client.call("put-object", [
      "--bucket",
      bucket,
      "--key",
      markerKey,
      "--body",
      markerPath,
      "--content-type",
      "application/json",
      "--if-none-match",
      "*",
      "--metadata",
      JSON.stringify(metadata),
    ]);
  } catch {
    // A retry is accepted only if the remote marker also passes exact readback.
  }
  try {
    const head = await client.call("head-object", [
      "--bucket",
      bucket,
      "--key",
      markerKey,
    ]);
    await getObject(client, bucket, markerKey, markerCheckPath);
    const remote = await readFile(markerCheckPath);
    if (
      head.ContentLength !== markerBytes.length ||
      !remote.equals(markerBytes) ||
      !sameMetadata(head.Metadata, metadata)
    )
      throw new Error("R2 backup commit marker verification failed");
  } catch {
    throw new Error("R2 backup commit marker could not be verified");
  }
}

export async function uploadProductionBackup({
  artifactPath,
  kind = "daily",
  env = process.env,
  execFileImpl = execFileAsync,
} = {}) {
  const client = createR2Client({ env, execFileImpl });
  const identity = backupIdentity(env, kind);
  const artifact = await validateCiphertext(artifactPath);
  const key = `${R2_BACKUP_PREFIX}${identity.kind}-${identity.runId}-${identity.runAttempt}.enc`;
  const markerKey = `${key}.commit.json`;
  const metadata = objectMetadata({ ...identity, sha256: artifact.sha256 });
  const tempRoot = await mkdtemp(join(tmpdir(), "savia-r2-backup-"));
  const readbackPath = join(tempRoot, "readback.enc");
  const markerPath = join(tempRoot, "commit.json");
  const markerCheckPath = join(tempRoot, "existing-commit.json");

  try {
    await chmod(tempRoot, 0o700);
    try {
      await client.call("put-object", [
        "--bucket",
        PRODUCTION_BACKUP_BUCKET,
        "--key",
        key,
        "--body",
        artifact.path,
        "--content-type",
        "application/octet-stream",
        "--if-none-match",
        "*",
        "--metadata",
        JSON.stringify(metadata),
      ]);
    } catch {
      // A retry may find the exact immutable object already committed. Readback below
      // decides whether it is safe to continue; no provider error text is exposed.
    }

    await writeFile(readbackPath, Buffer.alloc(0), { mode: 0o600, flag: "wx" });
    const head = await client.call("head-object", [
      "--bucket",
      PRODUCTION_BACKUP_BUCKET,
      "--key",
      key,
    ]);
    await getObject(client, PRODUCTION_BACKUP_BUCKET, key, readbackPath);
    const readbackInfo = await stat(readbackPath);
    const readbackHash = await sha256File(readbackPath);
    if (
      head.ContentLength !== artifact.size ||
      readbackInfo.size !== artifact.size ||
      readbackHash !== artifact.sha256 ||
      !sameMetadata(head.Metadata, metadata)
    )
      throw new Error("R2 readback verification failed");

    const objectCreatedAt = new Date(head.LastModified);
    if (!Number.isFinite(objectCreatedAt.getTime()))
      throw new Error("R2 readback verification failed");

    const marker = {
      version: 1,
      objectKey: key,
      kind: identity.kind,
      environment: "production",
      runId: identity.runId,
      runAttempt: identity.runAttempt,
      sourceSha: identity.sourceSha,
      sha256: artifact.sha256,
      sizeBytes: artifact.size,
      createdAt: objectCreatedAt.toISOString(),
    };
    const markerBytes = Buffer.from(`${JSON.stringify(marker)}\n`);
    const markerMetadata = {
      environment: "production",
      kind: identity.kind,
      "run-id": identity.runId,
      "run-attempt": identity.runAttempt,
      "marker-sha256": createHash("sha256").update(markerBytes).digest("hex"),
      verified: "true",
    };
    await putMarker(
      client,
      PRODUCTION_BACKUP_BUCKET,
      markerKey,
      markerBytes,
      markerMetadata,
      markerPath,
      markerCheckPath,
    );

    return {
      verified: true,
      bucket: PRODUCTION_BACKUP_BUCKET,
      key,
      markerKey,
      sha256: artifact.sha256,
      sizeBytes: artifact.size,
      kind: identity.kind,
      runId: identity.runId,
      runAttempt: identity.runAttempt,
      sourceSha: identity.sourceSha,
      environment: "production",
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function parseArguments(args) {
  let artifactPath;
  let kind = "daily";
  let kindProvided = false;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--artifact" && !artifactPath && args[index + 1])
      artifactPath = args[++index];
    else if (flag === "--kind" && !kindProvided && args[index + 1]) {
      kind = args[++index];
      kindProvided = true;
    } else
      throw new Error(
        "Use --artifact <absolute path> [--kind daily|release|migration]",
      );
  }
  if (!artifactPath)
    throw new Error(
      "Use --artifact <absolute path> [--kind daily|release|migration]",
    );
  return { artifactPath, kind };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await uploadProductionBackup({
      ...parseArguments(process.argv.slice(2)),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const safeMessage =
      error instanceof Error &&
      /^(?:Backup artifact|Backup kind|An explicit|The production|A valid|Dedicated|GitHub run|Source commit|Backup verification time)/.test(
        error.message,
      )
        ? error.message
        : "Production backup upload or verification failed";
    process.stderr.write(`${safeMessage}\n`);
    process.exitCode = 1;
  }
}
