import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getFlowCostUsage } from "./cost-usage";
const db = (env as typeof env & { DB: D1Database }).DB;
const now = Date.parse("2026-10-13T12:00:00Z");
const config = {
  DB: db,
  CLOUDFLARE_ENV: "preview",
  SAVIA_FLOWS_POLICY_GENERATION: "1",
  SAVIA_FLOWS_EXECUTION_ENABLED: "true",
  SAVIA_FLOWS_QUOTAS_ENABLED: "true",
  SAVIA_FLOWS_MAX_DAILY_RUNS: "5",
  SAVIA_FLOWS_MAX_MONTHLY_RUNS: "10",
  SAVIA_FLOWS_MAX_CONCURRENT_RUNS: "2",
  SAVIA_FLOWS_MAX_NODES_PER_RUN: "50",
  SAVIA_FLOWS_MAX_STEPS_PER_RUN: "200",
};
beforeEach(async () => {
  await db.prepare("DROP TABLE IF EXISTS savia_flows_execution_policy").run();
  await db.prepare("DROP TABLE IF EXISTS savia_flows_execution_control").run();
});
async function insert(
  id: string,
  organization: string,
  time: number,
  steps = 2,
) {
  await db
    .prepare(
      `INSERT INTO savia_flows_execution_policy VALUES (?, ?, 'wf', ?, 'completed', 0, ?, 200, 0)`,
    )
    .bind(id, organization, time, steps)
    .run();
}
describe("cost usage", () => {
  it("reports zero before first admission and never invents CPU or invoice costs", async () => {
    const data = await getFlowCostUsage(config, "one", now);
    expect(data.organization.monthlyRuns).toBe(0);
    expect(data.alerts).toEqual([]);
    expect(data.limits.monthlyRuns).toBe(10);
  });
  it("counts UTC windows, shared capacity, and only the current organization's steps", async () => {
    await db
      .prepare(
        `CREATE TABLE savia_flows_execution_policy (id TEXT PRIMARY KEY, organization_id TEXT, workflow_id TEXT, created_at INTEGER, state TEXT, active INTEGER, steps INTEGER, max_steps INTEGER, lease_until INTEGER)`,
      )
      .run();
    await insert("old", "one", Date.parse("2026-09-30T23:59:59Z"));
    await insert("future", "one", Date.parse("2026-11-01T00:00:00Z"));
    await insert("yesterday", "one", Date.parse("2026-10-12T23:59:59Z"), 3);
    for (let i = 0; i < 4; i++)
      await insert(String(i), i === 0 ? "one" : "other", now, 5);
    const data = await getFlowCostUsage(config, "one", now);
    expect(data.organization).toEqual({
      dailyRuns: 1,
      monthlyRuns: 2,
      monthlySteps: 8,
    });
    expect(data.shared.dailyRuns).toBe(4);
    expect(data.shared.monthlyRuns).toBe(5);
    expect(data.alerts).toEqual([
      { period: "day", level: "warning", percentage: 80 },
    ]);
    await insert("exhaust", "other", now);
    expect((await getFlowCostUsage(config, "one", now)).alerts[0].level).toBe(
      "exhausted",
    );
  });
});
