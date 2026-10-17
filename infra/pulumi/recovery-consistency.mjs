// Read-only consistency boundaries. A paginated copy is usable only when
// database bookmarks and complete object inventories stay unchanged while
// copying. This detects writes; it does not pause applications or retry them.
import { createHash } from "node:crypto";
import { assertAccountId, assertSafeR2Key } from "./naming.mjs";

export class RecoveryConsistencyError extends Error {
  constructor(message) {
    super(message);
    this.name = "RecoveryConsistencyError";
    this.code = "RECOVERY_CONSISTENCY_DRIFT";
  }
}

export function isRecoveryConsistencyDrift(error) {
  return error instanceof Error && error.code === "RECOVERY_CONSISTENCY_DRIFT";
}

const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

async function readD1(path, { accountId, token, fetchImpl = fetch }) {
  const response = await fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${path}`,
    {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("D1 recovery verification returned invalid JSON");
  }
  if (response.ok !== true || payload?.success !== true || !payload.result)
    throw new Error(
      `D1 recovery verification failed (HTTP ${response.status})`,
    );
  return payload.result;
}

export async function readD1Bookmark(id, options) {
  assertAccountId(options.accountId);
  if (!UUID.test(id) || !options.token)
    throw new Error(
      "D1 recovery verification requires a database UUID and token",
    );
  const { bookmark } = await readD1(`${id}/time_travel/bookmark`, options);
  if (typeof bookmark !== "string" || !/^[a-zA-Z0-9_-]{1,512}$/.test(bookmark))
    throw new Error("D1 recovery bookmark is missing or invalid");
  return bookmark;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}

export function r2InventoryHash(objects) {
  if (!Array.isArray(objects))
    throw new Error("R2 recovery inventory is invalid");
  const keys = new Set();
  for (const object of objects) {
    assertSafeR2Key(object.key);
    if (
      keys.has(object.key) ||
      typeof object.etag !== "string" ||
      !object.etag ||
      !Number.isSafeInteger(object.size) ||
      object.size < 0
    )
      throw new Error(
        "R2 recovery inventory has duplicate or incomplete object identities",
      );
    keys.add(object.key);
  }
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonical(
          [...objects].sort((a, b) =>
            a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
          ),
        ),
      ),
    )
    .digest("hex");
}

export async function captureRecoveryBoundary(options) {
  const { accountId, token, databases, buckets, listObjects } = options;
  assertAccountId(accountId);
  if (
    !token ||
    !databases ||
    !Object.keys(databases).length ||
    Object.values(databases).some((id) => !UUID.test(id))
  )
    throw new Error(
      "Recovery requires authoritative database UUIDs and a token",
    );
  const d1 = {};
  for (const [name, id] of Object.entries(databases)) {
    const actual = await readD1(id, options);
    if (actual.uuid !== id || actual.name !== name)
      throw new Error(`D1 recovery identity does not match ${name}`);
    d1[name] = { id, bookmark: await readD1Bookmark(id, options) };
  }
  const r2 = {};
  for (const bucket of buckets)
    r2[bucket] = r2InventoryHash(await listObjects(bucket));
  return { version: 1, accountId, d1, r2 };
}

export async function verifyRecoveryBoundary(boundary, options) {
  // Capture again before writing the final manifest. No successful manifest is
  // emitted when any target changed, disappeared, or could not be verified.
  const current = await captureRecoveryBoundary(options);
  for (const [name, expected] of Object.entries(boundary.d1)) {
    if (JSON.stringify(current.d1[name]) !== JSON.stringify(expected))
      throw new RecoveryConsistencyError(
        `D1 ${name} changed during backup; retry in a controlled maintenance window`,
      );
  }
  for (const [bucket, expected] of Object.entries(boundary.r2)) {
    if (current.r2[bucket] !== expected)
      throw new RecoveryConsistencyError(
        `R2 ${bucket} changed during backup; retry in a controlled maintenance window`,
      );
  }
  return current;
}
