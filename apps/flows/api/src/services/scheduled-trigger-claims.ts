import { v5 as uuidv5 } from "uuid";

const TABLE = "savia_scheduled_trigger_occurrences";
const EXECUTION_ID_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const DEFAULT_LEASE_MS = 5 * 60 * 1000;
const COMPLETED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface ScheduledTriggerClaimEnvironment {
  DB: D1Database;
}

export interface ScheduledTriggerOccurrenceInput {
  workflowId: string;
  scheduledTime: number;
  workflowFingerprint: string;
  now?: number;
  leaseMs?: number;
}

export type ScheduledTriggerClaimResult =
  | {
      status: "acquired";
      executionId: string;
      leaseToken: string;
      leaseUntil: number;
      attempts: number;
    }
  | {
      status: "leased" | "completed" | "uncertain" | "obsolete";
      executionId: string;
      leaseToken: string;
      leaseUntil: number;
      attempts: number;
    };

interface ClaimRow {
  execution_id: string;
  status: "claimed" | "dispatched" | "completed" | "uncertain" | "obsolete";
  runtime: "worker" | "workflow" | null;
  lease_token: string;
  lease_until: number;
  attempts: number;
  schedule_expression: string;
  trigger_updated_at: number;
  workflow_updated_at: number;
  workflow_fingerprint: string;
}

function executionIdForOccurrence(
  workflowId: string,
  scheduledTime: number,
): string {
  return uuidv5(
    `savia-scheduled-trigger:${workflowId}:${scheduledTime}`,
    EXECUTION_ID_NAMESPACE,
  );
}

async function readClaim(
  env: ScheduledTriggerClaimEnvironment,
  workflowId: string,
  scheduledTime: number,
): Promise<ClaimRow> {
  const row = await env.DB.prepare(
    `SELECT execution_id, status, runtime, lease_token, lease_until, attempts,
            schedule_expression, trigger_updated_at, workflow_updated_at,
            workflow_fingerprint
       FROM ${TABLE}
      WHERE workflow_id = ? AND scheduled_time = ?`,
  )
    .bind(workflowId, scheduledTime)
    .first<ClaimRow>();
  if (!row) throw new Error("Scheduled trigger occurrence claim disappeared");
  return row;
}

async function obsoleteClaimIfConfigurationChanged(
  env: ScheduledTriggerClaimEnvironment,
  input: ScheduledTriggerOccurrenceInput,
  claim: ClaimRow,
  now: number,
): Promise<void> {
  const transitioned = await env.DB.prepare(
    `UPDATE ${TABLE}
        SET status = CASE WHEN status = 'dispatched' AND runtime = 'worker'
                          THEN 'uncertain' ELSE 'obsolete' END,
            lease_until = 0, updated_at = ?
      WHERE workflow_id = ? AND scheduled_time = ? AND lease_token = ?
        AND status IN ('claimed', 'dispatched')
        AND (workflow_fingerprint != ? OR NOT EXISTS (
          SELECT 1 FROM scheduled_triggers AS trigger
          INNER JOIN workflows AS workflow ON workflow.id = trigger.workflow_id
          WHERE trigger.workflow_id = ? AND trigger.active = 1
            AND workflow.enabled = 1
            AND trigger.schedule_expression = ?
            AND trigger.updated_at = ?
            AND workflow.updated_at = ?
        ))
      RETURNING execution_id, status`,
  )
    .bind(
      now,
      input.workflowId,
      input.scheduledTime,
      claim.lease_token,
      input.workflowFingerprint,
      input.workflowId,
      claim.schedule_expression,
      claim.trigger_updated_at,
      claim.workflow_updated_at,
    )
    .all<{ execution_id: string; status: "obsolete" | "uncertain" }>();
  for (const row of transitioned.results ?? []) {
    if (row.status === "uncertain") {
      console.error(
        `[Scheduled trigger requires manual review] workflow=${input.workflowId} ` +
          `occurrence=${input.scheduledTime} execution=${row.execution_id}; ` +
          "runtime=worker workflow data changed while dispatch outcome was ambiguous",
      );
    }
  }
}

/** Atomically acquire or observe the durable claim for one cron occurrence. */
export async function claimScheduledTriggerOccurrence(
  env: ScheduledTriggerClaimEnvironment,
  input: ScheduledTriggerOccurrenceInput,
): Promise<ScheduledTriggerClaimResult> {
  const now = input.now ?? Date.now();
  const leaseMs = input.leaseMs ?? DEFAULT_LEASE_MS;
  if (!Number.isSafeInteger(input.scheduledTime) || input.scheduledTime < 0) {
    throw new Error("Scheduled trigger time must be a non-negative integer");
  }
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1) {
    throw new Error("Scheduled trigger claim lease must be positive");
  }

  const executionId = executionIdForOccurrence(
    input.workflowId,
    input.scheduledTime,
  );
  const leaseToken = crypto.randomUUID();
  const leaseUntil = now + leaseMs;
  const insert = await env.DB.prepare(
    `INSERT OR IGNORE INTO ${TABLE}
       (workflow_id, scheduled_time, execution_id, status, lease_token,
        lease_until, attempts, created_at, updated_at, schedule_expression,
        trigger_updated_at, workflow_updated_at, workflow_fingerprint)
     SELECT ?, ?, ?, 'claimed', ?, ?, 1, ?, ?, trigger.schedule_expression,
            trigger.updated_at, workflow.updated_at, ?
       FROM scheduled_triggers AS trigger
       INNER JOIN workflows AS workflow ON workflow.id = trigger.workflow_id
      WHERE trigger.workflow_id = ? AND trigger.active = 1
        AND workflow.enabled = 1`,
  )
    .bind(
      input.workflowId,
      input.scheduledTime,
      executionId,
      leaseToken,
      leaseUntil,
      now,
      now,
      input.workflowFingerprint,
      input.workflowId,
    )
    .run();
  if ((insert.meta.changes ?? 0) > 0) {
    return {
      status: "acquired",
      executionId,
      leaseToken,
      leaseUntil,
      attempts: 1,
    };
  }

  const existingRow = await env.DB.prepare(
    `SELECT execution_id, status, runtime, lease_token, lease_until, attempts,
            schedule_expression, trigger_updated_at, workflow_updated_at,
            workflow_fingerprint
       FROM ${TABLE}
      WHERE workflow_id = ? AND scheduled_time = ?`,
  )
    .bind(input.workflowId, input.scheduledTime)
    .first<ClaimRow>();
  if (!existingRow) {
    return {
      status: "obsolete",
      executionId,
      leaseToken: "",
      leaseUntil: 0,
      attempts: 0,
    };
  }
  const existing = existingRow;
  if (existing.status === "completed") {
    return {
      status: "completed",
      executionId: existing.execution_id,
      leaseToken: existing.lease_token,
      leaseUntil: existing.lease_until,
      attempts: existing.attempts,
    };
  }
  if (existing.status === "uncertain") {
    return {
      status: "uncertain",
      executionId: existing.execution_id,
      leaseToken: existing.lease_token,
      leaseUntil: existing.lease_until,
      attempts: existing.attempts,
    };
  }
  if (existing.status === "obsolete") {
    return {
      status: "obsolete",
      executionId: existing.execution_id,
      leaseToken: existing.lease_token,
      leaseUntil: existing.lease_until,
      attempts: existing.attempts,
    };
  }
  await obsoleteClaimIfConfigurationChanged(env, input, existing, now);
  const afterConfigurationCheck = await readClaim(
    env,
    input.workflowId,
    input.scheduledTime,
  );
  if (afterConfigurationCheck.status === "obsolete") {
    return {
      status: "obsolete",
      executionId: afterConfigurationCheck.execution_id,
      leaseToken: afterConfigurationCheck.lease_token,
      leaseUntil: afterConfigurationCheck.lease_until,
      attempts: afterConfigurationCheck.attempts,
    };
  }
  if (afterConfigurationCheck.status === "uncertain") {
    return {
      status: "uncertain",
      executionId: afterConfigurationCheck.execution_id,
      leaseToken: afterConfigurationCheck.lease_token,
      leaseUntil: afterConfigurationCheck.lease_until,
      attempts: afterConfigurationCheck.attempts,
    };
  }
  if (afterConfigurationCheck.lease_until > now) {
    return {
      status: "leased",
      executionId: afterConfigurationCheck.execution_id,
      leaseToken: afterConfigurationCheck.lease_token,
      leaseUntil: afterConfigurationCheck.lease_until,
      attempts: afterConfigurationCheck.attempts,
    };
  }
  if (
    afterConfigurationCheck.status === "dispatched" &&
    afterConfigurationCheck.runtime === "worker"
  ) {
    await env.DB.prepare(
      `UPDATE ${TABLE}
        SET status = 'uncertain', lease_until = 0, updated_at = ?
        WHERE workflow_id = ? AND scheduled_time = ? AND status = 'dispatched'
          AND runtime = 'worker' AND lease_until <= ?`,
    )
      .bind(now, input.workflowId, input.scheduledTime, now)
      .run();
    const row = await readClaim(env, input.workflowId, input.scheduledTime);
    return {
      status: "uncertain",
      executionId: row.execution_id,
      leaseToken: row.lease_token,
      leaseUntil: row.lease_until,
      attempts: row.attempts,
    };
  }

  const retryToken = crypto.randomUUID();
  const retryLeaseUntil = now + leaseMs;
  const reclaimed = await env.DB.prepare(
    `UPDATE ${TABLE}
        SET status = 'claimed', runtime = NULL,
            lease_token = ?, lease_until = ?, attempts = attempts + 1,
            updated_at = ?
      WHERE workflow_id = ? AND scheduled_time = ? AND lease_until <= ?
        AND (status = 'claimed' OR (status = 'dispatched' AND runtime = 'workflow'))
        AND schedule_expression = ? AND trigger_updated_at = ?
        AND workflow_updated_at = ? AND workflow_fingerprint = ?
        AND EXISTS (
          SELECT 1 FROM scheduled_triggers AS trigger
          INNER JOIN workflows AS workflow ON workflow.id = trigger.workflow_id
          WHERE trigger.workflow_id = ? AND trigger.active = 1
            AND workflow.enabled = 1
            AND trigger.schedule_expression = ${TABLE}.schedule_expression
            AND trigger.updated_at = ${TABLE}.trigger_updated_at
            AND workflow.updated_at = ${TABLE}.workflow_updated_at
        )`,
  )
    .bind(
      retryToken,
      retryLeaseUntil,
      now,
      input.workflowId,
      input.scheduledTime,
      now,
      afterConfigurationCheck.schedule_expression,
      afterConfigurationCheck.trigger_updated_at,
      afterConfigurationCheck.workflow_updated_at,
      input.workflowFingerprint,
      input.workflowId,
    )
    .run();

  if ((reclaimed.meta.changes ?? 0) > 0) {
    const row = await readClaim(env, input.workflowId, input.scheduledTime);
    return {
      status: "acquired",
      executionId: row.execution_id,
      leaseToken: row.lease_token,
      leaseUntil: row.lease_until,
      attempts: row.attempts,
    };
  }

  const raced = await readClaim(env, input.workflowId, input.scheduledTime);
  return {
    status:
      raced.status === "completed"
        ? "completed"
        : raced.status === "uncertain"
          ? "uncertain"
          : raced.status === "obsolete"
            ? "obsolete"
            : "leased",
    executionId: raced.execution_id,
    leaseToken: raced.lease_token,
    leaseUntil: raced.lease_until,
    attempts: raced.attempts,
  };
}

/** Release only a claim that failed before runtime dispatch. */
export async function releaseScheduledTriggerOccurrence(
  env: ScheduledTriggerClaimEnvironment,
  input: {
    workflowId: string;
    scheduledTime: number;
    leaseToken: string;
    now?: number;
  },
): Promise<void> {
  await env.DB.prepare(
    `UPDATE ${TABLE}
        SET lease_until = ?, updated_at = ?
      WHERE workflow_id = ? AND scheduled_time = ? AND status = 'claimed'
        AND lease_token = ?`,
  )
    .bind(
      input.now ?? Date.now(),
      input.now ?? Date.now(),
      input.workflowId,
      input.scheduledTime,
      input.leaseToken,
    )
    .run();
}

/** Mark the runtime boundary before a dispatch whose result may be ambiguous. */
export async function markScheduledTriggerOccurrenceDispatched(
  env: ScheduledTriggerClaimEnvironment,
  input: {
    workflowId: string;
    scheduledTime: number;
    leaseToken: string;
    workflowFingerprint: string;
    runtime: "worker" | "workflow";
    now?: number;
    leaseMs?: number;
  },
): Promise<boolean> {
  const now = input.now ?? Date.now();
  const result = await env.DB.prepare(
    `UPDATE ${TABLE}
        SET status = 'dispatched', runtime = ?, lease_until = ?, updated_at = ?
      WHERE workflow_id = ? AND scheduled_time = ? AND status = 'claimed'
        AND lease_token = ? AND lease_until > ?
        AND workflow_fingerprint = ?
        AND EXISTS (
          SELECT 1 FROM scheduled_triggers AS trigger
          INNER JOIN workflows AS workflow ON workflow.id = trigger.workflow_id
          WHERE trigger.workflow_id = ${TABLE}.workflow_id
            AND trigger.active = 1 AND workflow.enabled = 1
            AND trigger.schedule_expression = ${TABLE}.schedule_expression
            AND trigger.updated_at = ${TABLE}.trigger_updated_at
            AND workflow.updated_at = ${TABLE}.workflow_updated_at
        )`,
  )
    .bind(
      input.runtime,
      now + (input.leaseMs ?? DEFAULT_LEASE_MS),
      now,
      input.workflowId,
      input.scheduledTime,
      input.leaseToken,
      now,
      input.workflowFingerprint,
    )
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** Keep a live handler's claim fenced while synchronous Worker nodes run. */
export async function renewScheduledTriggerOccurrenceLease(
  env: ScheduledTriggerClaimEnvironment,
  input: {
    workflowId: string;
    scheduledTime: number;
    leaseToken: string;
    now?: number;
    leaseMs?: number;
  },
): Promise<boolean> {
  const now = input.now ?? Date.now();
  const result = await env.DB.prepare(
    `UPDATE ${TABLE}
        SET lease_until = ?, updated_at = ?
      WHERE workflow_id = ? AND scheduled_time = ? AND status = 'dispatched'
        AND lease_token = ?`,
  )
    .bind(
      now + (input.leaseMs ?? DEFAULT_LEASE_MS),
      now,
      input.workflowId,
      input.scheduledTime,
      input.leaseToken,
    )
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** Mark runtime acceptance/completion; stale lease owners cannot close a claim. */
export async function completeScheduledTriggerOccurrence(
  env: ScheduledTriggerClaimEnvironment,
  input: {
    workflowId: string;
    scheduledTime: number;
    leaseToken: string;
    now?: number;
  },
): Promise<boolean> {
  const now = input.now ?? Date.now();
  const result = await env.DB.prepare(
    `UPDATE ${TABLE}
        SET status = 'completed', lease_until = 0, updated_at = ?
      WHERE workflow_id = ? AND scheduled_time = ? AND status IN ('claimed', 'dispatched')
        AND lease_token = ?`,
  )
    .bind(now, input.workflowId, input.scheduledTime, input.leaseToken)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function listExpiredScheduledTriggerOccurrences(
  env: ScheduledTriggerClaimEnvironment,
  input: { now?: number; limit?: number } = {},
): Promise<Array<{ workflowId: string; scheduledTime: number }>> {
  const now = input.now ?? Date.now();
  const obsoleted = await env.DB.prepare(
    `UPDATE ${TABLE}
        SET status = CASE WHEN status = 'dispatched' AND runtime = 'worker'
                          THEN 'uncertain' ELSE 'obsolete' END,
            lease_until = 0, updated_at = ?
      WHERE rowid IN (
        SELECT stale.rowid FROM ${TABLE} AS stale
         WHERE stale.status IN ('claimed', 'dispatched')
           AND stale.lease_until <= ?
           AND NOT EXISTS (
             SELECT 1 FROM scheduled_triggers AS trigger
             INNER JOIN workflows AS workflow ON workflow.id = trigger.workflow_id
             WHERE trigger.workflow_id = stale.workflow_id
               AND trigger.active = 1 AND workflow.enabled = 1
               AND trigger.schedule_expression = stale.schedule_expression
               AND trigger.updated_at = stale.trigger_updated_at
               AND workflow.updated_at = stale.workflow_updated_at
           )
         ORDER BY stale.scheduled_time ASC
         LIMIT ?
      )
      RETURNING workflow_id, scheduled_time, execution_id, status`,
  )
    .bind(now, now, input.limit ?? 100)
    .all<{
      workflow_id: string;
      scheduled_time: number;
      execution_id: string;
      status: "obsolete" | "uncertain";
    }>();
  for (const occurrence of obsoleted.results ?? []) {
    if (occurrence.status === "uncertain") {
      console.error(
        `[Scheduled trigger requires manual review] workflow=${occurrence.workflow_id} ` +
          `occurrence=${occurrence.scheduled_time} execution=${occurrence.execution_id}; ` +
          "runtime=worker configuration changed while dispatch outcome was ambiguous",
      );
    }
  }
  const rows = await env.DB.prepare(
    `SELECT occurrence.workflow_id, occurrence.scheduled_time
       FROM ${TABLE} AS occurrence
       INNER JOIN scheduled_triggers AS trigger
         ON trigger.workflow_id = occurrence.workflow_id AND trigger.active = 1
       INNER JOIN workflows AS workflow
         ON workflow.id = occurrence.workflow_id AND workflow.enabled = 1
      WHERE occurrence.status IN ('claimed', 'dispatched')
        AND occurrence.lease_until <= ?
        AND trigger.schedule_expression = occurrence.schedule_expression
        AND trigger.updated_at = occurrence.trigger_updated_at
        AND workflow.updated_at = occurrence.workflow_updated_at
      ORDER BY occurrence.scheduled_time ASC
      LIMIT ?`,
  )
    .bind(now, input.limit ?? 100)
    .all<{ workflow_id: string; scheduled_time: number }>();
  return (rows.results ?? []).map((row) => ({
    workflowId: row.workflow_id,
    scheduledTime: row.scheduled_time,
  }));
}

/** Prune a bounded number of old completed claims; live and ambiguous claims are retained. */
export async function pruneCompletedScheduledTriggerOccurrences(
  env: ScheduledTriggerClaimEnvironment,
  input: { now?: number; retentionMs?: number; limit?: number } = {},
): Promise<number> {
  const now = input.now ?? Date.now();
  const cutoff = now - (input.retentionMs ?? COMPLETED_RETENTION_MS);
  const result = await env.DB.prepare(
    `DELETE FROM ${TABLE}
      WHERE rowid IN (
        SELECT rowid FROM ${TABLE}
         WHERE status IN ('completed', 'obsolete') AND updated_at < ?
         ORDER BY updated_at ASC
         LIMIT ?
      )`,
  )
    .bind(cutoff, input.limit ?? 100)
    .run();
  return result.meta.changes ?? 0;
}
