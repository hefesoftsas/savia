import { afterAll, beforeAll, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { purgeStudioAudit } from "../src/audit-retention";

let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;

beforeAll(async () => {
  platform = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: false,
  });
  db = platform.env.DB;
  await db
    .prepare(
      `CREATE TABLE studio_audit (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    action TEXT NOT NULL,
    object_name TEXT NOT NULL,
    record_id TEXT,
    detail TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
    )
    .run();

  const rows = [
    ...Array.from({ length: 199 }, (_, i) => [
      `new-${String(i).padStart(3, "0")}`,
      "domain:platform",
      "2026-09-24T02:00:00.000Z",
    ]),
    ["tie-a", "domain:platform", "2026-09-24T01:00:00.000Z"],
    ["tie-b", "domain:platform", "2026-09-24T01:00:00.000Z"],
    ["old", "domain:platform", "2026-09-24T00:00:00.000Z"],
    ...Array.from({ length: 201 }, (_, i) => [
      `inventory-${String(i).padStart(3, "0")}`,
      "domain:inventory",
      "2026-09-24T01:00:00.000Z",
    ]),
    ...Array.from({ length: 201 }, (_, i) => [
      `agency-${String(i).padStart(3, "0")}`,
      "agency:1",
      "2026-09-24T01:00:00.000Z",
    ]),
    ["untouched", "domain:other", "2026-09-24T00:00:00.000Z"],
  ];
  for (let i = 0; i < rows.length; i += 100) {
    await db.batch(
      rows
        .slice(i, i + 100)
        .map(([id, tenant, createdAt]) =>
          db
            .prepare(
              "INSERT INTO studio_audit(id,tenant_id,action,object_name,detail,created_at) VALUES (?,?, 'record.created','example','{}',?)",
            )
            .bind(id, tenant, createdAt),
        ),
    );
  }
});

afterAll(async () => {
  await platform?.dispose();
});

it("keeps the 200 newest events per domain without pruning agency audit", async () => {
  expect(await purgeStudioAudit(db)).toEqual({ deleted: 3 });

  const { results } = await db
    .prepare(
      "SELECT tenant_id,count(*) AS total FROM studio_audit GROUP BY tenant_id ORDER BY tenant_id",
    )
    .all<{ tenant_id: string; total: number }>();
  expect(results).toEqual([
    { tenant_id: "agency:1", total: 201 },
    { tenant_id: "domain:inventory", total: 200 },
    { tenant_id: "domain:other", total: 1 },
    { tenant_id: "domain:platform", total: 200 },
  ]);
  const removed = await db
    .prepare(
      "SELECT id FROM studio_audit WHERE id IN ('old','tie-a','tie-b','agency-000') ORDER BY id",
    )
    .all<{ id: string }>();
  expect(removed.results.map((row) => row.id)).toEqual(["agency-000", "tie-b"]);
  expect(await purgeStudioAudit(db)).toEqual({ deleted: 0 });
});
