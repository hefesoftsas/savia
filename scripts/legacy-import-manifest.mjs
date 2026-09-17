import { createHash } from "node:crypto";

const sourceTypes = new Set(["surreal", "r2", "kv", "d1"]);
const sha256Pattern = /^[a-f0-9]{64}$/i;

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim())
    throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function nonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`${name} must be a non-negative integer`);
  return value;
}

function normalizedStream(stream, snapshotId) {
  if (!stream || typeof stream !== "object")
    throw new TypeError("stream must be an object");
  const sourceType = requiredString(stream.sourceType, "stream.sourceType");
  if (!sourceTypes.has(sourceType))
    throw new TypeError(`stream.sourceType is not supported: ${sourceType}`);
  const sourceName = requiredString(stream.sourceName, "stream.sourceName");
  const destinationPrefix = requiredString(
    stream.destinationPrefix,
    "stream.destinationPrefix",
  );
  if (!destinationPrefix.startsWith(`legacy-import/${snapshotId}/`)) {
    throw new TypeError(
      "stream.destinationPrefix must use the immutable snapshot prefix",
    );
  }
  const sha256 = requiredString(stream.sha256, "stream.sha256").toLowerCase();
  if (!sha256Pattern.test(sha256))
    throw new TypeError("stream.sha256 must be a SHA-256 digest");
  return {
    sourceType,
    sourceName,
    destinationPrefix,
    records: nonNegativeInteger(stream.records, "stream.records"),
    bytes: nonNegativeInteger(stream.bytes, "stream.bytes"),
    sha256,
  };
}

function sortStreams(streams) {
  return [...streams].sort(
    (left, right) =>
      left.sourceType.localeCompare(right.sourceType) ||
      left.sourceName.localeCompare(right.sourceName),
  );
}

export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object")
    throw new TypeError("manifest must be an object");
  const snapshotId = requiredString(manifest.snapshotId, "snapshotId");
  const createdAt = requiredString(manifest.createdAt, "createdAt");
  if (Number.isNaN(Date.parse(createdAt)))
    throw new TypeError("createdAt must be an ISO timestamp");
  if (!Array.isArray(manifest.streams))
    throw new TypeError("streams must be an array");

  const sources = new Set();
  const streams = manifest.streams.map((stream) => {
    const normalized = normalizedStream(stream, snapshotId);
    const source = `${normalized.sourceType}:${normalized.sourceName}`;
    if (sources.has(source))
      throw new TypeError(`duplicate source stream: ${source}`);
    sources.add(source);
    return normalized;
  });

  return {
    snapshotId,
    createdAt,
    streams: sortStreams(streams),
  };
}

export function manifestSha256(manifest) {
  return createHash("sha256")
    .update(JSON.stringify(validateManifest(manifest)))
    .digest("hex");
}

export function compareManifest(expected, actual) {
  const expectedManifest = validateManifest(expected);
  const actualManifest = validateManifest(actual);
  const mismatches = [];

  for (const field of ["snapshotId", "createdAt"]) {
    if (expectedManifest[field] !== actualManifest[field])
      mismatches.push(`${field} differs`);
  }

  const actualStreams = new Map(
    actualManifest.streams.map((stream) => [
      `${stream.sourceType}:${stream.sourceName}`,
      stream,
    ]),
  );
  for (const expectedStream of expectedManifest.streams) {
    const key = `${expectedStream.sourceType}:${expectedStream.sourceName}`;
    const actualStream = actualStreams.get(key);
    if (!actualStream) {
      mismatches.push(`missing stream ${key}`);
      continue;
    }
    for (const field of ["destinationPrefix", "records", "bytes", "sha256"]) {
      if (expectedStream[field] !== actualStream[field])
        mismatches.push(`stream ${key} ${field} differ`);
    }
    actualStreams.delete(key);
  }
  for (const key of [...actualStreams.keys()].sort())
    mismatches.push(`unexpected stream ${key}`);

  return { matches: mismatches.length === 0, mismatches };
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function manifestSql(manifest) {
  const normalized = validateManifest(manifest);
  const sql = [
    "BEGIN TRANSACTION;",
    "INSERT INTO `legacy_import_snapshots` (`id`, `created_at`, `manifest_sha256`, `stream_count`)",
    `VALUES (${sqlString(normalized.snapshotId)}, ${sqlString(normalized.createdAt)}, ${sqlString(manifestSha256(normalized))}, ${normalized.streams.length})`,
    "ON CONFLICT (`id`) DO NOTHING;",
  ];

  for (const stream of normalized.streams) {
    sql.push(
      "INSERT INTO `legacy_import_streams` (`snapshot_id`, `source_type`, `source_name`, `destination_prefix`, `record_count`, `byte_count`, `sha256`)",
      `VALUES (${sqlString(normalized.snapshotId)}, ${sqlString(stream.sourceType)}, ${sqlString(stream.sourceName)}, ${sqlString(stream.destinationPrefix)}, ${stream.records}, ${stream.bytes}, ${sqlString(stream.sha256)})`,
      "ON CONFLICT (`snapshot_id`, `source_type`, `source_name`) DO NOTHING;",
    );
  }
  sql.push("COMMIT;");
  return `${sql.join("\n")}\n`;
}
