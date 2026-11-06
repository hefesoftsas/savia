import type { Bindings } from "../context";

const DAY_MS = 24 * 60 * 60 * 1000;
const CLAIM_LEASE_MS = 5 * 60 * 1000;
const TERMINAL_STATUSES = [
  "completed",
  "error",
  "cancelled",
  "exhausted",
] as const;

export const EXECUTION_HISTORY_RETENTION_DAYS = 30;
export const EXECUTION_HISTORY_DAILY_DELETE_LIMIT = 500;

type RetentionEnvironment = Pick<
  Bindings,
  "DB" | "SAVIA_FLOWS_LOCAL_ONLY" | "SAVIA_FLOWS_MAINTENANCE"
>;

export interface ExecutionRetentionOptions {
  /** Injectable time and smaller budgets keep the maintenance pass testable. */
  now?: number;
  retentionDays?: number;
  dailyDeleteLimit?: number;
}

export type ExecutionRetentionResult =
  | { skipped: "not-local" | "maintenance" | "already-claimed" }
  | { skipped: false; day: string; cutoff: number; deleted: number };

/**
 * Deletes one bounded, restartable page of terminal local execution history.
 * Cloudflare-backed execution objects live in R2 and are intentionally outside
 * this pass because Analytics Engine has no authoritative D1 object reference
 * ledger for safe per-execution deletion.
 */
export async function maintainLocalExecutionHistory(
  env: RetentionEnvironment,
  options: ExecutionRetentionOptions = {},
): Promise<ExecutionRetentionResult> {
  if (env.SAVIA_FLOWS_LOCAL_ONLY !== "true") return { skipped: "not-local" };
  if (env.SAVIA_FLOWS_MAINTENANCE === "true") return { skipped: "maintenance" };

  const now = options.now ?? Date.now();
  const retentionDays =
    options.retentionDays ?? EXECUTION_HISTORY_RETENTION_DAYS;
  const dailyDeleteLimit =
    options.dailyDeleteLimit ?? EXECUTION_HISTORY_DAILY_DELETE_LIMIT;
  if (!Number.isFinite(now))
    throw new Error("Invalid execution retention time");
  if (
    !Number.isInteger(retentionDays) ||
    retentionDays < 1 ||
    retentionDays > 3650
  ) {
    throw new Error("Invalid execution retention period");
  }
  if (
    !Number.isInteger(dailyDeleteLimit) ||
    dailyDeleteLimit < 1 ||
    dailyDeleteLimit > EXECUTION_HISTORY_DAILY_DELETE_LIMIT
  ) {
    throw new Error("Invalid execution retention daily limit");
  }

  const day = new Date(now).toISOString().slice(0, 10);
  const cutoff = now - retentionDays * DAY_MS;
  const leaseToken = crypto.randomUUID();
  const leaseUntil = now + CLAIM_LEASE_MS;

  // The singleton claim makes minute-level cron invocations cheap and ensures
  // only one bounded page is removed per UTC day. An interrupted pass becomes
  // claimable again after the five-minute lease expires.
  const claim = await env.DB.prepare(
    `INSERT INTO savia_flows_execution_retention
      (id, claimed_day, lease_until, lease_token, last_completed_day)
     VALUES (1, ?, ?, ?, NULL)
     ON CONFLICT (id) DO UPDATE SET
       claimed_day = excluded.claimed_day,
       lease_until = excluded.lease_until,
       lease_token = excluded.lease_token
     WHERE COALESCE(savia_flows_execution_retention.last_completed_day, '') < excluded.claimed_day
       AND savia_flows_execution_retention.lease_until <= ?`,
  )
    .bind(day, leaseUntil, leaseToken, now)
    .run();

  if ((claim.meta?.changes ?? 0) === 0) return { skipped: "already-claimed" };

  const perStatusLimit = Math.floor(
    dailyDeleteLimit / TERMINAL_STATUSES.length,
  );
  let remainder = dailyDeleteLimit % TERMINAL_STATUSES.length;
  const deleteStatements = TERMINAL_STATUSES.map((status) => {
    const statusLimit = perStatusLimit + (remainder-- > 0 ? 1 : 0);
    return env.DB.prepare(
      `DELETE FROM savia_local_executions
       WHERE rowid IN (
         SELECT rowid
         FROM savia_local_executions
         WHERE status = ? AND updated_at < ?
           AND EXISTS (
             SELECT 1 FROM savia_flows_execution_retention
             WHERE id = 1 AND claimed_day = ? AND lease_token = ?
           )
         ORDER BY updated_at ASC, organization_id ASC, id ASC
         LIMIT ?
       )`,
    ).bind(status, cutoff, day, leaseToken, statusLimit);
  });

  // Complete the daily claim in the same D1 batch as the deletes. If any
  // delete fails, D1 rolls the batch back and the lease allows a later retry.
  const results = await env.DB.batch([
    ...deleteStatements,
    env.DB.prepare(
      `UPDATE savia_flows_execution_retention
       SET last_completed_day = ?, lease_until = 0, lease_token = NULL
       WHERE id = 1 AND claimed_day = ? AND lease_token = ?`,
    ).bind(day, day, leaseToken),
  ]);

  if ((results.at(-1)?.meta?.changes ?? 0) === 0) {
    return { skipped: "already-claimed" };
  }

  return {
    skipped: false,
    day,
    cutoff,
    deleted: results
      .slice(0, TERMINAL_STATUSES.length)
      .reduce((total, result) => total + (result.meta?.changes ?? 0), 0),
  };
}
