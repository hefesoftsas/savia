import type { FlowCostUsage } from "@savia/flows-types";
import {
  policyStatus,
  type ExecutionPolicyEnvironment,
} from "./execution-policy";

const TABLE = "savia_flows_execution_policy";
const positive = (value: string | undefined): number | null => {
  const number = Number(value);
  return value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(number)
    ? number
    : null;
};

/** Indexed admission metrics. Never exposes another organization's IDs or runs. */
export async function getFlowCostUsage(
  env: ExecutionPolicyEnvironment,
  organizationId: string,
  now = Date.now(),
): Promise<FlowCostUsage> {
  const date = new Date(now);
  const day = date.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const dayStart = Date.parse(day + "T00:00:00Z");
  const monthStart = Date.parse(month + "-01T00:00:00Z");
  const monthEnd = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  const status = await policyStatus(env);
  const result: FlowCostUsage = {
    ...status,
    period: { day, month },
    organization: { dailyRuns: 0, monthlyRuns: 0, monthlySteps: 0 },
    shared: { dailyRuns: 0, monthlyRuns: 0, activeRuns: status.activeRuns },
    limits: {
      dailyRuns: positive(env.SAVIA_FLOWS_MAX_DAILY_RUNS),
      monthlyRuns: positive(env.SAVIA_FLOWS_MAX_MONTHLY_RUNS),
      concurrentRuns: positive(env.SAVIA_FLOWS_MAX_CONCURRENT_RUNS),
    },
    alerts: [],
  };
  const exists = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
  )
    .bind(TABLE)
    .first();
  if (exists) {
    const row = await env.DB.prepare(
      `SELECT
      COUNT(*) AS monthly_runs,
      COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS daily_runs,
      COALESCE(SUM(CASE WHEN organization_id = ? THEN 1 ELSE 0 END), 0) AS org_monthly,
      COALESCE(SUM(CASE WHEN organization_id = ? AND created_at >= ? THEN 1 ELSE 0 END), 0) AS org_daily,
      COALESCE(SUM(CASE WHEN organization_id = ? THEN steps ELSE 0 END), 0) AS org_steps
      FROM ${TABLE} WHERE created_at >= ? AND created_at < ?`,
    )
      .bind(
        dayStart,
        organizationId,
        organizationId,
        dayStart,
        organizationId,
        monthStart,
        monthEnd,
      )
      .first<{
        monthly_runs: number;
        daily_runs: number;
        org_monthly: number;
        org_daily: number;
        org_steps: number;
      }>();
    if (row) {
      result.organization = {
        dailyRuns: row.org_daily,
        monthlyRuns: row.org_monthly,
        monthlySteps: row.org_steps,
      };
      result.shared.dailyRuns = row.daily_runs;
      result.shared.monthlyRuns = row.monthly_runs;
    }
  }
  if (status.quotasEnabled) {
    for (const period of ["day", "month"] as const) {
      const used =
        period === "day" ? result.shared.dailyRuns : result.shared.monthlyRuns;
      const limit =
        period === "day" ? result.limits.dailyRuns : result.limits.monthlyRuns;
      if (!limit) continue;
      const percentage = Math.round((used / limit) * 100);
      if (used / limit >= 0.8)
        result.alerts.push({
          period,
          level: used >= limit ? "exhausted" : "warning",
          percentage,
        });
    }
  }
  return result;
}
