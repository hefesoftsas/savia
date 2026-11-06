import { env } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import {
  maintainFinishedCostReceipts,
  purgeFinishedCostReceipts,
} from "./cost-ledger-retention";
const db = (env as typeof env & { DB: D1Database }).DB;
const now = Date.parse("2026-10-13T00:00:00Z");
beforeEach(async () => {
  await db.prepare("DROP TABLE IF EXISTS savia_flows_execution_policy").run();
  await db
    .prepare(
      "CREATE TABLE savia_flows_execution_policy (id TEXT PRIMARY KEY, state TEXT, active INTEGER, created_at INTEGER)",
    )
    .run();
});
it("bounds receipt cleanup and preserves waiting/active runs and current quota windows", async () => {
  for (const [id, state, active, time] of [
    ["old", "completed", 0, 0],
    ["waiting", "active", 0, 0],
    ["running", "active", 1, 0],
    ["recent", "completed", 0, now],
  ]) {
    await db
      .prepare("INSERT INTO savia_flows_execution_policy VALUES (?,?,?,?)")
      .bind(id, state, active, time)
      .run();
  }
  expect(await purgeFinishedCostReceipts(db, now)).toBe(1);
  const rows = await db
    .prepare("SELECT id FROM savia_flows_execution_policy ORDER BY id")
    .all<{ id: string }>();
  expect(rows.results.map((row) => row.id)).toEqual([
    "recent",
    "running",
    "waiting",
  ]);
});

it("runs receipt maintenance only once per UTC day, including when execution is paused", async () => {
  await db
    .prepare(
      "CREATE TABLE savia_flows_cost_maintenance (id INTEGER PRIMARY KEY, lease_until INTEGER, lease_token TEXT, completed_day TEXT)",
    )
    .run();
  await db
    .prepare(
      "CREATE TABLE savia_collection_event_batch_groups (group_key TEXT PRIMARY KEY, finished_at INTEGER)",
    )
    .run();
  await db
    .prepare(
      "CREATE TABLE savia_collection_event_batch_items (event_id TEXT, group_key TEXT, finished_at INTEGER)",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO savia_flows_execution_policy VALUES ('old', 'completed', 0, 0)",
    )
    .run();
  const bindings = { DB: db, SAVIA_FLOWS_MAINTENANCE: "false" };
  await maintainFinishedCostReceipts(bindings, now);
  expect(
    await db
      .prepare("SELECT id FROM savia_flows_execution_policy WHERE id='old'")
      .first(),
  ).toBeNull();
  await db
    .prepare(
      "INSERT INTO savia_flows_execution_policy VALUES ('later', 'completed', 0, 0)",
    )
    .run();
  await maintainFinishedCostReceipts(bindings, now);
  expect(
    await db
      .prepare("SELECT id FROM savia_flows_execution_policy WHERE id='later'")
      .first(),
  ).not.toBeNull();
  await maintainFinishedCostReceipts(
    { ...bindings, SAVIA_FLOWS_MAINTENANCE: "true" },
    now + 86400000,
  );
  expect(
    await db
      .prepare("SELECT id FROM savia_flows_execution_policy WHERE id='later'")
      .first(),
  ).not.toBeNull();
  await maintainFinishedCostReceipts(bindings, now + 86400000);
  expect(
    await db
      .prepare("SELECT id FROM savia_flows_execution_policy WHERE id='later'")
      .first(),
  ).toBeNull();
});
