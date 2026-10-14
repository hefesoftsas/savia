/**
 * Shared execution admission and quota ledger for Savia Flows.
 *
 * Reservations live in the Flows D1 database so all HTTP, queue, and agent
 * runtimes use the same atomic limits. IDs are stable across redelivery and
 * retries; releasing a nonterminal reservation drops only its concurrency
 * slot, while the run remains counted against daily/monthly totals.
 */

export interface ExecutionPolicyEnvironment {
  DB: D1Database;
  CLOUDFLARE_ENV?: string;
  SAVIA_FLOWS_MAINTENANCE?: string;
  SAVIA_FLOWS_LOCAL_ONLY?: string;
  SAVIA_FLOWS_POLICY_GENERATION?: string;
  SAVIA_FLOWS_EXECUTION_ENABLED?: string;
  SAVIA_FLOWS_QUOTAS_ENABLED?: string;
  SAVIA_FLOWS_MAX_DAILY_RUNS?: string;
  SAVIA_FLOWS_MAX_MONTHLY_RUNS?: string;
  SAVIA_FLOWS_MAX_CONCURRENT_RUNS?: string;
  SAVIA_FLOWS_MAX_NODES_PER_RUN?: string;
  SAVIA_FLOWS_MAX_STEPS_PER_RUN?: string;
}

export interface ExecutionAdmission {
  executionId: string;
  organizationId: string;
  workflowId: string;
  nodeCount: number;
}

export interface ExecutionPolicyStatus {
  executionsEnabled: boolean;
  quotasEnabled: boolean;
  activeRuns: number;
}

export interface ExecutionPolicy {
  admit(input: ExecutionAdmission): Promise<{
    allowed: boolean;
    reason?: string;
    alreadyActive?: boolean;
  }>;
  consumeStep(executionId: string): Promise<void>;
  release(executionId: string, terminal: boolean): Promise<void>;
}

interface Limits {
  maxDailyRuns: number;
  maxMonthlyRuns: number;
  maxConcurrentRuns: number;
  maxNodesPerRun: number;
  maxStepsPerRun: number;
}

const TABLE = "savia_flows_execution_policy";
const CONTROL_TABLE = "savia_flows_execution_control";
const EXECUTION_LEASE_MS = 20 * 60 * 1000;
const BOOLEAN_FLAGS = new Set(["true", "false"]);

interface PolicySettings {
  valid: boolean;
  executionsEnabled: boolean;
  quotasEnabled: boolean;
  generation?: number;
}

function configuredQuotaValues(
  env: ExecutionPolicyEnvironment,
): Array<string | undefined> {
  return [
    env.SAVIA_FLOWS_MAX_DAILY_RUNS,
    env.SAVIA_FLOWS_MAX_MONTHLY_RUNS,
    env.SAVIA_FLOWS_MAX_CONCURRENT_RUNS,
    env.SAVIA_FLOWS_MAX_NODES_PER_RUN,
    env.SAVIA_FLOWS_MAX_STEPS_PER_RUN,
  ];
}

function policySettings(env: ExecutionPolicyEnvironment): PolicySettings {
  const local =
    env.CLOUDFLARE_ENV === "development" ||
    (env.CLOUDFLARE_ENV === undefined && env.SAVIA_FLOWS_LOCAL_ONLY === "true");
  const generation =
    env.SAVIA_FLOWS_POLICY_GENERATION === undefined && local
      ? 0
      : parsePolicyGeneration(env.SAVIA_FLOWS_POLICY_GENERATION, local);
  if (generation === undefined) {
    return {
      valid: false,
      executionsEnabled: false,
      quotasEnabled: false,
    };
  }
  const executionFlag = env.SAVIA_FLOWS_EXECUTION_ENABLED;
  const quotaFlag = env.SAVIA_FLOWS_QUOTAS_ENABLED;
  if (local && executionFlag === undefined && quotaFlag === undefined) {
    return {
      valid: true,
      executionsEnabled: env.SAVIA_FLOWS_MAINTENANCE !== "true",
      quotasEnabled: false,
      generation,
    };
  }
  if (
    !BOOLEAN_FLAGS.has(executionFlag ?? "") ||
    !BOOLEAN_FLAGS.has(quotaFlag ?? "")
  ) {
    return {
      valid: false,
      executionsEnabled: false,
      quotasEnabled: false,
      generation,
    };
  }
  const executionsEnabled =
    executionFlag === "true" && env.SAVIA_FLOWS_MAINTENANCE !== "true";
  const quotasEnabled = quotaFlag === "true";
  if (
    executionsEnabled &&
    !(local && !quotasEnabled) &&
    (!quotasEnabled ||
      !configuredQuotaValues(env).every(
        (value) => parsePositiveInteger(value) !== undefined,
      ))
  ) {
    return {
      valid: false,
      executionsEnabled: false,
      quotasEnabled: false,
      generation,
    };
  }
  return { valid: true, executionsEnabled, quotasEnabled, generation };
}

async function ensureControlTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ${CONTROL_TABLE} (
    id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
    paused INTEGER NOT NULL CHECK (paused IN (0, 1)),
    updated_at INTEGER NOT NULL,
    generation INTEGER NOT NULL DEFAULT 0
  )`,
    )
    .run();
}

/** Persist the newest worker's pause decision for already-running older instances. */
export async function syncExecutionPolicyPause(
  env: ExecutionPolicyEnvironment,
): Promise<void> {
  await ensureControlTable(env.DB);
  const settings = policySettings(env);
  const paused = !settings.valid || !settings.executionsEnabled;
  let generation = settings.generation;
  if (generation === undefined) {
    const row = await env.DB.prepare(
      `SELECT generation FROM ${CONTROL_TABLE} WHERE id = 1`,
    ).first<{ generation: number }>();
    generation = row?.generation ?? 0;
  }
  await env.DB.prepare(
    `INSERT INTO ${CONTROL_TABLE} (id, paused, updated_at, generation) VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET paused=excluded.paused, updated_at=excluded.updated_at, generation=excluded.generation
     WHERE excluded.generation > ${CONTROL_TABLE}.generation
       OR (excluded.generation = ${CONTROL_TABLE}.generation AND excluded.paused >= ${CONTROL_TABLE}.paused)`,
  )
    .bind(paused ? 1 : 0, Date.now(), generation)
    .run();
}

async function persistedPause(
  env: ExecutionPolicyEnvironment,
  settings: PolicySettings,
): Promise<boolean> {
  await ensureControlTable(env.DB);
  const row = await env.DB.prepare(
    `SELECT paused FROM ${CONTROL_TABLE} WHERE id = 1`,
  ).first<{ paused: number }>();
  // A new deployment can begin before the first entrypoint sync. In that case,
  // use its validated flags until the current worker writes the singleton.
  return row
    ? row.paused === 1
    : !settings.valid || !settings.executionsEnabled;
}

export function createExecutionPolicy(
  env: ExecutionPolicyEnvironment,
  options: { now?: () => number } = {},
): ExecutionPolicy {
  const now = options.now ?? Date.now;
  let schemaReady: Promise<void> | undefined;

  const ensureSchema = () => {
    schemaReady ??= (async () => {
      await env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS ${TABLE} (
        id TEXT PRIMARY KEY NOT NULL,
        organization_id TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('active', 'completed')),
        active INTEGER NOT NULL CHECK (active IN (0, 1)),
        steps INTEGER NOT NULL DEFAULT 0,
        max_steps INTEGER NOT NULL,
        lease_until INTEGER NOT NULL DEFAULT 0
      )`,
      ).run();
      await env.DB.prepare(
        `CREATE INDEX IF NOT EXISTS savia_flows_execution_policy_window_idx ON ${TABLE} (created_at)`,
      ).run();
      await env.DB.prepare(
        `CREATE INDEX IF NOT EXISTS savia_flows_execution_policy_active_idx ON ${TABLE} (active, state)`,
      ).run();
      await ensureControlTable(env.DB);
    })();
    return schemaReady;
  };

  const enabled = () => {
    const current = policySettings(env);
    return current.valid && current.executionsEnabled;
  };
  const quotasEnabled = () => {
    const current = policySettings(env);
    return current.valid && current.quotasEnabled;
  };

  function limits(): Limits {
    const values = {
      maxDailyRuns: env.SAVIA_FLOWS_MAX_DAILY_RUNS,
      maxMonthlyRuns: env.SAVIA_FLOWS_MAX_MONTHLY_RUNS,
      maxConcurrentRuns: env.SAVIA_FLOWS_MAX_CONCURRENT_RUNS,
      maxNodesPerRun: env.SAVIA_FLOWS_MAX_NODES_PER_RUN,
      maxStepsPerRun: env.SAVIA_FLOWS_MAX_STEPS_PER_RUN,
    };
    const parsed = Object.fromEntries(
      Object.entries(values).map(([name], index) => [
        name,
        parsePositiveInteger(configuredQuotaValues(env)[index]),
      ]),
    ) as unknown as Limits;
    if (Object.values(parsed).some((value) => value === undefined)) {
      throw new Error(
        "Execution quota configuration is invalid; all SAVIA_FLOWS_MAX_* values must be positive integers",
      );
    }
    return parsed;
  }

  return {
    async admit(input) {
      const currentSettings = policySettings(env);
      if (!currentSettings.valid) {
        return {
          allowed: false,
          reason: "Execution policy configuration is invalid",
        };
      }
      if (!currentSettings.executionsEnabled) {
        return { allowed: false, reason: "Workflow executions are paused" };
      }
      if (await persistedPause(env, currentSettings)) {
        return { allowed: false, reason: "Workflow executions are paused" };
      }
      if (!quotasEnabled()) return { allowed: true };
      const quota = limits();
      if (!Number.isInteger(input.nodeCount) || input.nodeCount < 0) {
        throw new Error("Execution node count is invalid");
      }
      if (input.nodeCount > quota.maxNodesPerRun) {
        return { allowed: false, reason: "Workflow exceeds the node limit" };
      }
      await ensureSchema();

      const timestamp = now();
      const existing = await env.DB.prepare(
        `SELECT state, active, lease_until FROM ${TABLE} WHERE id = ?`,
      )
        .bind(input.executionId)
        .first<{ state: string; active: number; lease_until: number }>();
      if (existing) {
        if (existing.state !== "active") {
          return { allowed: false, reason: "Execution has already finished" };
        }
        if (existing.active === 1 && existing.lease_until > timestamp) {
          return { allowed: true, alreadyActive: true };
        }
        const result = await env.DB.prepare(
          `UPDATE ${TABLE} SET active = 1, lease_until = ?
           WHERE id = ? AND state = 'active' AND active = 0
           AND COALESCE((SELECT paused FROM ${CONTROL_TABLE} WHERE id = 1), 0) = 0
             AND (SELECT COUNT(*) FROM ${TABLE} WHERE active = 1 AND state = 'active' AND lease_until > ?) < ?`,
        )
          .bind(
            timestamp + EXECUTION_LEASE_MS,
            input.executionId,
            timestamp,
            quota.maxConcurrentRuns,
          )
          .run();
        if ((result.meta.changes ?? 0) > 0) return { allowed: true };
        if (existing.active === 1) {
          const reclaimed = await env.DB.prepare(
            `UPDATE ${TABLE} SET lease_until = ?
             WHERE id = ? AND state = 'active' AND active = 1 AND lease_until <= ?
               AND COALESCE((SELECT paused FROM ${CONTROL_TABLE} WHERE id = 1), 0) = 0
               AND (SELECT COUNT(*) FROM ${TABLE} WHERE active = 1 AND state = 'active' AND lease_until > ?) < ?`,
          )
            .bind(
              timestamp + EXECUTION_LEASE_MS,
              input.executionId,
              timestamp,
              timestamp,
              quota.maxConcurrentRuns,
            )
            .run();
          if ((reclaimed.meta.changes ?? 0) > 0) return { allowed: true };
        }
        return { allowed: false, reason: "Concurrent execution limit reached" };
      }

      const date = new Date(timestamp);
      const startOfDay = Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
      );
      const startOfMonth = Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        1,
      );
      const result = await env.DB.prepare(
        `INSERT OR IGNORE INTO ${TABLE}
           (id, organization_id, workflow_id, created_at, state, active, steps, max_steps, lease_until)
         SELECT ?, ?, ?, ?, 'active', 1, 0, ?, ?
         WHERE COALESCE((SELECT paused FROM ${CONTROL_TABLE} WHERE id = 1), 0) = 0
           AND (SELECT COUNT(*) FROM ${TABLE} WHERE created_at >= ?) < ?
           AND (SELECT COUNT(*) FROM ${TABLE} WHERE created_at >= ?) < ?
           AND (SELECT COUNT(*) FROM ${TABLE} WHERE active = 1 AND state = 'active' AND lease_until > ?) < ?`,
      )
        .bind(
          input.executionId,
          input.organizationId,
          input.workflowId,
          timestamp,
          quota.maxStepsPerRun,
          timestamp + EXECUTION_LEASE_MS,
          startOfDay,
          quota.maxDailyRuns,
          startOfMonth,
          quota.maxMonthlyRuns,
          timestamp,
          quota.maxConcurrentRuns,
        )
        .run();
      if ((result.meta.changes ?? 0) > 0) return { allowed: true };

      // A concurrent duplicate may have won the insert. Treat it as the same
      // admission; a different run was rejected by one of the quota predicates.
      const raced = await env.DB.prepare(
        `SELECT state, active, lease_until FROM ${TABLE} WHERE id = ?`,
      )
        .bind(input.executionId)
        .first<{ state: string; active: number; lease_until: number }>();
      if (raced?.state === "active" && raced.active === 1) {
        return { allowed: true, alreadyActive: true };
      }
      const counts = await env.DB.prepare(
        `SELECT
           (SELECT COUNT(*) FROM ${TABLE} WHERE created_at >= ?) AS daily,
           (SELECT COUNT(*) FROM ${TABLE} WHERE created_at >= ?) AS monthly,
           (SELECT COUNT(*) FROM ${TABLE} WHERE active = 1 AND state = 'active' AND lease_until > ?) AS concurrent`,
      )
        .bind(startOfDay, startOfMonth, timestamp)
        .first<{ daily: number; monthly: number; concurrent: number }>();
      if ((counts?.concurrent ?? 0) >= quota.maxConcurrentRuns) {
        return { allowed: false, reason: "Concurrent execution limit reached" };
      }
      if ((counts?.daily ?? 0) >= quota.maxDailyRuns) {
        return { allowed: false, reason: "Daily execution limit reached" };
      }
      return { allowed: false, reason: "Monthly execution limit reached" };
    },

    async consumeStep(executionId) {
      const currentSettings = policySettings(env);
      if (!currentSettings.valid) {
        throw new Error("Execution policy configuration is invalid");
      }
      if (!enabled()) throw new Error("Workflow executions are paused");
      if (await persistedPause(env, currentSettings)) {
        throw new Error("Workflow executions are paused");
      }
      if (!quotasEnabled()) return;
      const quota = limits();
      await ensureSchema();
      const timestamp = now();
      const result = await env.DB.prepare(
        `UPDATE ${TABLE} SET steps = steps + 1, active = 1, lease_until = ?
         WHERE id = ? AND state = 'active' AND steps < ?
           AND COALESCE((SELECT paused FROM ${CONTROL_TABLE} WHERE id = 1), 0) = 0
           AND (
             (active = 1 AND lease_until > ?)
             OR (
               (active = 0 OR lease_until <= ?)
               AND (SELECT COUNT(*) FROM ${TABLE}
                    WHERE active = 1 AND state = 'active' AND lease_until > ?) < ?
             )
           )`,
      )
        .bind(
          timestamp + EXECUTION_LEASE_MS,
          executionId,
          quota.maxStepsPerRun,
          timestamp,
          timestamp,
          timestamp,
          quota.maxConcurrentRuns,
        )
        .run();
      if ((result.meta.changes ?? 0) === 0) {
        if (await persistedPause(env, currentSettings)) {
          throw new Error("Workflow executions are paused");
        }
        const row = await env.DB.prepare(
          `SELECT state, steps FROM ${TABLE} WHERE id = ?`,
        )
          .bind(executionId)
          .first<{ state: string; steps: number }>();
        if (row?.state === "active" && row.steps >= quota.maxStepsPerRun) {
          throw new Error("Workflow execution step limit reached");
        }
        if (row?.state === "active") {
          throw new Error("Concurrent execution limit reached");
        }
        throw new Error("Workflow execution reservation is not active");
      }
    },

    async release(executionId, terminal) {
      if (env.SAVIA_FLOWS_QUOTAS_ENABLED !== "true") return;
      await ensureSchema();
      await env.DB.prepare(
        `UPDATE ${TABLE} SET active = 0, state = ?, lease_until = 0 WHERE id = ?`,
      )
        .bind(terminal ? "completed" : "active", executionId)
        .run();
    },
  };
}

export async function policyStatus(
  env: ExecutionPolicyEnvironment,
): Promise<ExecutionPolicyStatus> {
  const currentSettings = policySettings(env);
  const controlTable = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
  )
    .bind(CONTROL_TABLE)
    .first<{ name: string }>();
  const control = controlTable
    ? await env.DB.prepare(
        `SELECT paused FROM ${CONTROL_TABLE} WHERE id = 1`,
      ).first<{ paused: number }>()
    : null;
  const globallyPaused = control
    ? control.paused === 1
    : !currentSettings.valid || !currentSettings.executionsEnabled;
  const executionsEnabled =
    currentSettings.valid &&
    currentSettings.executionsEnabled &&
    !globallyPaused;
  const quotasEnabled = currentSettings.valid && currentSettings.quotasEnabled;
  const table = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
  )
    .bind(TABLE)
    .first<{ name: string }>();
  if (!table) {
    return {
      executionsEnabled,
      quotasEnabled,
      activeRuns: 0,
    };
  }
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS activeRuns FROM ${TABLE} WHERE active = 1 AND state = 'active' AND lease_until > ?`,
  )
    .bind(Date.now())
    .first<{ activeRuns: number }>();
  return {
    executionsEnabled,
    quotasEnabled,
    activeRuns: row?.activeRuns ?? 0,
  };
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value || !/^[1-9]\d*$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parsePolicyGeneration(
  value: string | undefined,
  local: boolean,
): number | undefined {
  if (local && value === "0") return 0;
  return parsePositiveInteger(value);
}
