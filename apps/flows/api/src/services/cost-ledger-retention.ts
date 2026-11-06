import type { Bindings } from "../context";
import { purgeSaviaCollectionEventBatchReceipts } from "./collection-event-batches";

/** Keep receipts long enough to outlive source-event retention and quota windows. */
export async function purgeFinishedCostReceipts(
  db: D1Database,
  now = Date.now(),
): Promise<number> {
  const cutoff = now - 90 * 24 * 60 * 60_000;
  const exists = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('savia_collection_admissions', 'savia_flows_execution_policy')",
    )
    .all<{ name: string }>();
  const names = new Set(exists.results.map((row) => row.name));
  const statements: D1PreparedStatement[] = [];
  if (names.has("savia_collection_admissions"))
    statements.push(
      db
        .prepare(
          `DELETE FROM savia_collection_admissions WHERE rowid IN (
    SELECT rowid FROM savia_collection_admissions WHERE status IN ('accepted', 'skipped') AND updated_at < ? ORDER BY updated_at LIMIT 250
  )`,
        )
        .bind(cutoff),
    );
  if (names.has("savia_flows_execution_policy"))
    statements.push(
      db
        .prepare(
          `DELETE FROM savia_flows_execution_policy WHERE id IN (
    SELECT id FROM savia_flows_execution_policy WHERE state = 'completed' AND active = 0 AND created_at < ? ORDER BY created_at LIMIT 250
  )`,
        )
        .bind(cutoff),
    );
  if (!statements.length) return 0;
  return (await db.batch(statements)).reduce(
    (sum, row) => sum + (row.meta.changes ?? 0),
    0,
  );
}

/** Daily shared cleanup also runs when the execution/history backend changes. */
export async function maintainFinishedCostReceipts(
  env: Pick<Bindings, "DB" | "SAVIA_FLOWS_MAINTENANCE">,
  now = Date.now(),
): Promise<void> {
  if (env.SAVIA_FLOWS_MAINTENANCE === "true") return;
  const day = new Date(now).toISOString().slice(0, 10);
  const token = crypto.randomUUID();
  const claimed = await env.DB.prepare(
    `INSERT INTO savia_flows_cost_maintenance
    (id, lease_until, lease_token, completed_day) VALUES (1, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET lease_until=excluded.lease_until, lease_token=excluded.lease_token
    WHERE COALESCE(completed_day, '') < ? AND lease_until <= ?`,
  )
    .bind(now + 5 * 60_000, token, day, now)
    .run();
  if (!claimed.meta.changes) return;
  await purgeSaviaCollectionEventBatchReceipts(env, { now, limit: 250 });
  await purgeFinishedCostReceipts(env.DB, now);
  await env.DB.prepare(
    `UPDATE savia_flows_cost_maintenance SET completed_day=?, lease_until=0, lease_token=NULL WHERE id=1 AND lease_token=?`,
  )
    .bind(day, token)
    .run();
}
