import { dialectFor } from "@savia/db/dialect";

export interface RecordCountSnapshot {
  activeCount: number;
  trashCount: number;
  revision: number;
}

/** A count query suitable for batching beside the matching page query. */
export function getRecordCountStatement(
  db: D1Database,
  tenant: string,
  objectName: string,
  trash = false,
): D1PreparedStatement {
  if (dialectFor(db).name === "postgres") {
    return db
      .prepare(
        `SELECT COALESCE((SELECT ${trash ? "trash_count" : "active_count"}
                          FROM studio_record_counts
                          WHERE tenant_id=? AND object_name=?), 0) AS count`,
      )
      .bind(tenant, objectName);
  }
  return db
    .prepare(
      `SELECT ${trash ? "trash_count" : "active_count"} AS count
       FROM studio_record_counts WHERE tenant_id=? AND object_name=?`,
    )
    .bind(tenant, objectName);
}

/**
 * Reads exact whole-object counts. Callers must only use these counts when the
 * request has no row filters/search and its read policy grants the whole
 * collection; row-level ACL predicates require a filtered query instead.
 */
export async function getRecordCounts(
  db: D1Database,
  tenant: string,
  objectName: string,
): Promise<RecordCountSnapshot> {
  if (dialectFor(db).name === "postgres") {
    const row = await db
      .prepare(
        `SELECT COALESCE(state.active_count, 0) AS active_count,
                COALESCE(state.trash_count, 0) AS trash_count,
                COALESCE(state.revision, 0) AS revision
         FROM (SELECT 1) AS singleton
         LEFT JOIN studio_record_counts state ON state.tenant_id=? AND state.object_name=?`,
      )
      .bind(tenant, objectName)
      .first<{
        active_count: number;
        trash_count: number;
        revision: number;
      }>();
    return {
      activeCount: Number(row?.active_count ?? 0),
      trashCount: Number(row?.trash_count ?? 0),
      revision: Number(row?.revision ?? 0),
    };
  }

  const row = await db
    .prepare(
      `SELECT active_count, trash_count, revision
       FROM studio_record_counts WHERE tenant_id=? AND object_name=?`,
    )
    .bind(tenant, objectName)
    .first<{
      active_count: number;
      trash_count: number;
      revision: number;
    }>();
  return {
    activeCount: Number(row?.active_count ?? 0),
    trashCount: Number(row?.trash_count ?? 0),
    revision: Number(row?.revision ?? 0),
  };
}

/**
 * Caches an expensive tenant/object read under the current record revision.
 * The caller-provided fingerprint must cover all query semantics, including
 * SQL, bound values, and any row-visibility policy. PostgreSQL currently
 * bypasses this cache. SQLite writes are admitted only if the captured
 * revision is still current, so a concurrent mutation cannot make an old
 * result reusable under the new revision.
 */
export async function getRevisionedRead<T>(
  db: D1Database,
  tenant: string,
  objectName: string,
  fingerprint: string,
  compute: () => Promise<T>,
  options: { ttlMs?: number } = {},
): Promise<T> {
  if (dialectFor(db).name === "postgres") return compute();

  const now = new Date().toISOString();
  const cached = await db
    .prepare(
      `SELECT cache.payload FROM studio_record_read_cache AS cache
       WHERE cache.tenant_id=? AND cache.object_name=?
         AND cache.revision=COALESCE(
           (SELECT revision FROM studio_record_counts
            WHERE tenant_id=? AND object_name=?), 0)
         AND cache.query_fingerprint=? AND cache.expires_at>?`,
    )
    .bind(tenant, objectName, tenant, objectName, fingerprint, now)
    .first<{ payload: string }>();
  if (cached) {
    try {
      return JSON.parse(cached.payload) as T;
    } catch {
      // Ignore a corrupt cache entry and replace it below.
    }
  }

  const state = await db
    .prepare(
      `SELECT revision FROM studio_record_counts
       WHERE tenant_id=? AND object_name=?`,
    )
    .bind(tenant, objectName)
    .first<{ revision: number }>();
  const revision = Number(state?.revision ?? 0);
  const value = await compute();
  let payload: string | undefined;
  try {
    payload = JSON.stringify(value);
  } catch {
    return value;
  }
  // Undefined and non-JSON values are valid compute results but cannot be
  // represented in this cache; return them without attempting a write.
  if (
    payload === undefined ||
    new TextEncoder().encode(payload).byteLength > 512 * 1024
  )
    return value;

  const ttlMs = Math.max(1, options.ttlMs ?? 60_000);
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO studio_record_read_cache
           (tenant_id, object_name, revision, query_fingerprint, payload, created_at, expires_at)
         SELECT ?, ?, ?, ?, ?, ?, ?
         WHERE COALESCE((SELECT revision FROM studio_record_counts
                         WHERE tenant_id=? AND object_name=?), 0)=?
         ON CONFLICT(tenant_id, object_name, revision, query_fingerprint)
         DO UPDATE SET payload=excluded.payload, expires_at=excluded.expires_at`,
      )
      .bind(
        tenant,
        objectName,
        revision,
        fingerprint,
        payload,
        now,
        expiresAt,
        tenant,
        objectName,
        revision,
      ),
    db
      .prepare(
        `DELETE FROM studio_record_read_cache
         WHERE tenant_id=? AND object_name=?
           AND (revision<>COALESCE((SELECT revision FROM studio_record_counts
                                    WHERE tenant_id=? AND object_name=?), 0)
                OR expires_at<=?)`,
      )
      .bind(tenant, objectName, tenant, objectName, now),
    db
      .prepare(
        `DELETE FROM studio_record_read_cache
         WHERE rowid IN (
           SELECT rowid FROM studio_record_read_cache
           WHERE tenant_id=? AND object_name=?
           ORDER BY created_at DESC, query_fingerprint ASC
           LIMIT -1 OFFSET 64
         )`,
      )
      .bind(tenant, objectName),
  ]);
  return value;
}
