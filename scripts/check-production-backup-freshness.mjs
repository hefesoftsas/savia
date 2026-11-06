import { createHash } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdtemp,
  open,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createR2Client, R2_BACKUP_PREFIX } from "./production-backup-r2.mjs";

const DEFAULT_MAX_AGE_MS = 36 * 60 * 60 * 1000;
const MAX_LIST_PAGES = 10_000;
const MAX_MARKER_SIZE = 16 * 1024;
const DAILY_MARKER_KEY =
  /^production\/daily-([1-9]\d{0,19})-([1-9]\d{0,5})\.enc\.commit\.json$/;

function timestamp(value) {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new Error("invalid R2 object timestamp");
  return result;
}

function matchesMetadata(actual, expected) {
  if (!actual || typeof actual !== "object") return false;
  const expectedKeys = Object.keys(expected);
  return (
    Object.keys(actual).length === expectedKeys.length &&
    expectedKeys.every((key) => actual[key] === expected[key])
  );
}

async function listDailyMarkers(client, bucket) {
  const found = [];
  const visited = new Set();
  let token;
  for (let pageNumber = 0; pageNumber < MAX_LIST_PAGES; pageNumber += 1) {
    const args = [
      "--bucket",
      bucket,
      "--prefix",
      `${R2_BACKUP_PREFIX}daily-`,
      "--max-keys",
      "1000",
      "--no-paginate",
    ];
    if (token) args.push("--continuation-token", token);
    const page = await client.call("list-objects-v2", args);
    if (
      !Array.isArray(page.Contents ?? []) ||
      (page.IsTruncated !== undefined && typeof page.IsTruncated !== "boolean")
    )
      throw new Error("invalid R2 object listing");
    for (const item of page.Contents ?? []) {
      if (
        typeof item?.Key !== "string" ||
        !item.Key.startsWith(`${R2_BACKUP_PREFIX}daily-`)
      )
        throw new Error("invalid R2 object listing");
      if (!item.Key.endsWith(".enc.commit.json")) continue;
      const match = DAILY_MARKER_KEY.exec(item.Key);
      if (
        !match ||
        !Number.isSafeInteger(item.Size) ||
        item.Size <= 0 ||
        item.Size > MAX_MARKER_SIZE
      )
        throw new Error("invalid R2 backup commit marker listing");
      const modifiedAt = timestamp(item.LastModified);
      found.push({
        markerKey: item.Key,
        runId: match[1],
        runAttempt: match[2],
        listedSize: item.Size,
        listedAt: modifiedAt,
      });
    }
    if (page.IsTruncated !== true) return found;
    const nextToken = page.NextContinuationToken;
    if (typeof nextToken !== "string" || !nextToken || visited.has(nextToken))
      throw new Error("invalid R2 pagination token");
    visited.add(nextToken);
    token = nextToken;
  }
  throw new Error("R2 object listing exceeded the pagination limit");
}

async function inspectCommit(client, bucket, candidate, tempRoot, nowMs) {
  const markerPath = join(tempRoot, "latest-commit.json");
  const markerFile = await open(markerPath, "wx", 0o600);
  await markerFile.close();
  await client.call("get-object", [
    "--bucket",
    bucket,
    "--key",
    candidate.markerKey,
    markerPath,
  ]);
  await chmod(markerPath, 0o600);
  const markerBytes = await readFile(markerPath);
  if (
    !markerBytes.length ||
    markerBytes.length > MAX_MARKER_SIZE ||
    markerBytes.length !== candidate.listedSize
  )
    throw new Error("R2 backup commit marker size is invalid");

  let marker;
  try {
    marker = JSON.parse(markerBytes.toString("utf8"));
  } catch {
    throw new Error("R2 backup commit marker is invalid");
  }
  const expectedKey = `${R2_BACKUP_PREFIX}daily-${candidate.runId}-${candidate.runAttempt}.enc`;
  if (
    marker?.version !== 1 ||
    marker.objectKey !== expectedKey ||
    marker.kind !== "daily" ||
    marker.environment !== "production" ||
    marker.runId !== candidate.runId ||
    marker.runAttempt !== candidate.runAttempt ||
    !/^[a-f0-9]{7,64}$/.test(marker.sourceSha ?? "") ||
    !/^[a-f0-9]{64}$/.test(marker.sha256 ?? "") ||
    !Number.isSafeInteger(marker.sizeBytes) ||
    marker.sizeBytes < 36 ||
    typeof marker.createdAt !== "string" ||
    !Number.isFinite(Date.parse(marker.createdAt))
  )
    throw new Error("R2 backup marker does not match its key");

  const markerHead = await client.call("head-object", [
    "--bucket",
    bucket,
    "--key",
    candidate.markerKey,
  ]);
  const expectedMarkerMetadata = {
    environment: "production",
    kind: "daily",
    "run-id": candidate.runId,
    "run-attempt": candidate.runAttempt,
    "marker-sha256": createHash("sha256").update(markerBytes).digest("hex"),
    verified: "true",
  };
  if (
    markerHead.ContentLength !== markerBytes.length ||
    !matchesMetadata(markerHead.Metadata, expectedMarkerMetadata)
  )
    throw new Error("R2 backup commit marker metadata is invalid");

  const objectHead = await client.call("head-object", [
    "--bucket",
    bucket,
    "--key",
    marker.objectKey,
  ]);
  const expectedObjectMetadata = {
    sha256: marker.sha256,
    "source-sha": marker.sourceSha,
    environment: "production",
    "run-id": candidate.runId,
    "run-attempt": candidate.runAttempt,
    kind: "daily",
    verified: "true",
  };
  if (
    objectHead.ContentLength !== marker.sizeBytes ||
    !matchesMetadata(objectHead.Metadata, expectedObjectMetadata)
  )
    throw new Error("R2 backup metadata does not match its commit marker");

  const markerModifiedAt = timestamp(markerHead.LastModified);
  const objectModifiedAt = timestamp(objectHead.LastModified);
  if (markerModifiedAt > nowMs || objectModifiedAt > nowMs)
    throw new Error("invalid R2 object timestamp");
  if (Date.parse(marker.createdAt) !== objectModifiedAt)
    throw new Error(
      "R2 commit marker timestamp does not match its encrypted object",
    );
  const ageMs = nowMs - markerModifiedAt;
  const objectAgeMs = nowMs - objectModifiedAt;
  return {
    key: marker.objectKey,
    markerKey: candidate.markerKey,
    runId: candidate.runId,
    runAttempt: candidate.runAttempt,
    sourceSha: marker.sourceSha,
    sha256: marker.sha256,
    sizeBytes: marker.sizeBytes,
    createdAt: marker.createdAt,
    lastModified: new Date(markerModifiedAt).toISOString(),
    ageMs,
    objectAgeMs,
  };
}

async function appendSummary(summaryPath, lines) {
  if (!summaryPath) return;
  await appendFile(summaryPath, `${lines.join("\n")}\n`, { mode: 0o600 });
}

export async function checkProductionBackupFreshness({
  env = process.env,
  now = new Date(),
  maxAgeMs = DEFAULT_MAX_AGE_MS,
  execFileImpl,
  summaryPath = env.GITHUB_STEP_SUMMARY,
} = {}) {
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0)
    throw new Error("Backup freshness threshold must be positive");
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw new Error("Backup freshness check time is invalid");
  const client = createR2Client({ env, execFileImpl });
  const candidates = await listDailyMarkers(client, "savia-production-backups");
  const nowMs = now.getTime();
  for (const candidate of candidates) {
    if (candidate.listedAt > nowMs)
      throw new Error("invalid R2 object timestamp");
  }
  candidates.sort((a, b) => b.listedAt - a.listedAt);
  const candidate = candidates[0];
  if (!candidate) {
    const lines = [
      "## Production backup freshness check failed",
      "No committed encrypted production daily backup was found in R2.",
    ];
    await appendSummary(summaryPath, lines);
    return { fresh: false, newest: null, ageMs: null };
  }

  const tempRoot = await mkdtemp(join(tmpdir(), "savia-r2-freshness-"));
  try {
    await chmod(tempRoot, 0o700);
    const newest = await inspectCommit(
      client,
      "savia-production-backups",
      candidate,
      tempRoot,
      nowMs,
    );
    const fresh = newest.ageMs <= maxAgeMs && newest.objectAgeMs <= maxAgeMs;
    const hours = Math.max(0, newest.ageMs / (60 * 60 * 1000));
    const lines = fresh
      ? [
          "## Production backup freshness",
          `Latest verified R2 production backup is ${hours.toFixed(1)} hours old (run ${newest.runId}).`,
        ]
      : [
          "## Production backup freshness check failed",
          `Latest verified R2 production backup is ${hours.toFixed(1)} hours old; the limit is 36 hours.`,
        ];
    await appendSummary(summaryPath, lines);
    return { fresh, newest, ageMs: newest.ageMs };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export async function runFreshnessCheck(options = {}) {
  try {
    return await checkProductionBackupFreshness(options);
  } catch {
    await appendSummary(
      options.summaryPath ??
        options.env?.GITHUB_STEP_SUMMARY ??
        process.env.GITHUB_STEP_SUMMARY,
      [
        "## Production backup freshness check failed",
        "Could not verify retained R2 backup status.",
      ],
    ).catch(() => {});
    throw new Error("Production backup freshness could not be verified");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runFreshnessCheck()
    .then(({ fresh }) => {
      if (!fresh) process.exitCode = 1;
    })
    .catch(() => {
      process.stderr.write(
        "Production backup freshness could not be verified.\n",
      );
      process.exitCode = 1;
    });
}
