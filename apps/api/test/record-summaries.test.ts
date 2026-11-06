import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import {
  getMaintainedGroupCount,
  getMaintainedSummary,
  maintainedGroupCountStatement,
  summaryConfigurationStatements,
} from "../../../packages/studio-server/src/record-summaries";

const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([a], [b]) => a.localeCompare(b));

beforeAll(async () => {
  for (const [, sql] of migrations)
    for (const statement of sql.split("--> statement-breakpoint")) {
      const normalized = statement
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (normalized) await env.DB.exec(normalized);
    }
  await env.DB.prepare(
    "INSERT OR IGNORE INTO studio_objects(tenant_id,name,label,config) VALUES(?,?,?,?)",
  )
    .bind(tenant, objectName, "Orders", "{}")
    .run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO studio_objects(tenant_id,name,label,config) VALUES(?,?,?,?)",
  )
    .bind("other-tenant", "other-object", "Other", "{}")
    .run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO studio_objects(tenant_id,name,label,config) VALUES(?,?,?,?)",
  )
    .bind("summary-cardinality-test", "summary_groups", "Summary groups", "{}")
    .run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO studio_objects(tenant_id,name,label,config) VALUES(?,?,?,?)",
  )
    .bind("summary-cardinality-other", "summary_groups", "Other groups", "{}")
    .run();
});

const tenant = "record-summary-test";
const objectName = "orders";
const cardinalityTenant = "summary-cardinality-test";
const cardinalityObject = "summary_groups";
const summaries = [
  { group: "status", amountField: "amount" },
  { group: "status" },
  { group: "kind", amountField: "amount" },
];

async function configure() {
  await env.DB.batch(
    summaryConfigurationStatements(env.DB, tenant, objectName, summaries),
  );
}

async function add(id: string, data: unknown) {
  await env.DB.prepare(
    "INSERT INTO studio_records(tenant_id,id,object_name,data) VALUES(?,?,?,?)",
  )
    .bind(
      tenant,
      id,
      objectName,
      typeof data === "string" ? data : JSON.stringify(data),
    )
    .run();
}

async function direct(group: string, amountField?: string) {
  const groupPath = `$.${group}`;
  const amount = amountField
    ? `COALESCE(SUM(CAST(json_extract(data, '$.${amountField}') AS REAL)),0)`
    : "0";
  const rows = await env.DB.prepare(
    `SELECT json_extract(data, ?) AS value, COUNT(*) AS count, ${amount} AS amount FROM studio_records WHERE tenant_id=? AND object_name=? AND deleted_at IS NULL GROUP BY json_extract(data, ?) ORDER BY count DESC, value`,
  )
    .bind(groupPath, tenant, objectName, groupPath)
    .all<{ value: unknown; count: number; amount: number }>();
  return rows.results;
}

it("maintains grouped count and amount through record lifecycle changes", async () => {
  await add("a", { status: "open", kind: 1, amount: 10 });
  await add("b", '{"status":"open","kind":1.0,"amount":"2.5"}');
  await add("c", { status: "closed", kind: "1", amount: null });
  await add("d", { status: null, kind: false, amount: 4 });
  await configure();

  expect(
    await getMaintainedSummary(env.DB, tenant, objectName, "status", "amount"),
  ).toEqual(await direct("status", "amount"));
  expect(
    await getMaintainedSummary(env.DB, tenant, objectName, "status"),
  ).toEqual(await direct("status"));
  expect(
    await getMaintainedSummary(env.DB, tenant, objectName, "kind", "amount"),
  ).toEqual(await direct("kind", "amount"));

  await env.DB.prepare(
    "UPDATE studio_records SET data=? WHERE tenant_id=? AND id=?",
  )
    .bind(JSON.stringify({ status: "closed", kind: 1, amount: 7 }), tenant, "a")
    .run();
  await env.DB.prepare(
    "UPDATE studio_records SET deleted_at='2026-09-29' WHERE tenant_id=? AND id=?",
  )
    .bind(tenant, "b")
    .run();
  for (const [group, amountField] of [
    ["status", "amount"],
    ["status", undefined],
    ["kind", "amount"],
  ] as const)
    expect(
      await getMaintainedSummary(
        env.DB,
        tenant,
        objectName,
        group,
        amountField,
      ),
    ).toEqual(await direct(group, amountField));

  await env.DB.prepare(
    "UPDATE studio_records SET deleted_at=NULL WHERE tenant_id=? AND id=?",
  )
    .bind(tenant, "b")
    .run();
  await env.DB.prepare(
    "UPDATE studio_records SET tenant_id=?, object_name=? WHERE tenant_id=? AND id=?",
  )
    .bind("other-tenant", "other-object", tenant, "c")
    .run();
  await env.DB.prepare("DELETE FROM studio_records WHERE tenant_id=? AND id=?")
    .bind(tenant, "d")
    .run();
  for (const [group, amountField] of [
    ["status", "amount"],
    ["status", undefined],
    ["kind", "amount"],
  ] as const)
    expect(
      await getMaintainedSummary(
        env.DB,
        tenant,
        objectName,
        group,
        amountField,
      ),
    ).toEqual(await direct(group, amountField));
  expect(
    await getMaintainedGroupCount(env.DB, tenant, objectName, "status", "open"),
  ).toBe(1);
  expect(
    await getMaintainedGroupCount(
      env.DB,
      tenant,
      objectName,
      "status",
      "missing",
    ),
  ).toBe(0);
  expect(
    await getMaintainedGroupCount(env.DB, tenant, objectName, "amount", 7),
  ).toBe(1);
});

it("replaces definitions atomically and distinguishes unconfigured summaries", async () => {
  await add("reconfigure", { status: "ready", amount: 3 });
  await configure();
  expect(
    await getMaintainedSummary(env.DB, tenant, objectName, "unknown"),
  ).toBeUndefined();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO studio_objects(tenant_id,name,label,config) VALUES(?,?,?,?)",
  )
    .bind(tenant, "empty-summary", "Empty", "{}")
    .run();
  await env.DB.batch(
    summaryConfigurationStatements(env.DB, tenant, "empty-summary", [
      { group: "status" },
    ]),
  );
  expect(
    await getMaintainedSummary(env.DB, tenant, "empty-summary", "status"),
  ).toEqual([]);

  await env.DB.batch(
    summaryConfigurationStatements(env.DB, tenant, objectName, [
      { group: "status", amountField: "amount" },
    ]),
  );
  expect(
    await getMaintainedSummary(env.DB, tenant, objectName, "status"),
  ).toBeUndefined();
  expect(
    await getMaintainedSummary(env.DB, tenant, objectName, "status", "amount"),
  ).toEqual(await direct("status", "amount"));
});

it("rejects unsafe summary field names before creating SQL statements", () => {
  expect(() =>
    summaryConfigurationStatements(env.DB, tenant, objectName, [
      { group: "status'); DROP TABLE studio_records;--" },
    ]),
  ).toThrow();
});

it("keeps summary writes and exact counts bounded with many groups and tenants", async () => {
  const otherTenant = "summary-cardinality-other";
  await env.DB.batch(
    summaryConfigurationStatements(
      env.DB,
      cardinalityTenant,
      "summary_groups",
      [{ group: "status", amountField: "amount" }],
    ),
  );
  await env.DB.batch(
    summaryConfigurationStatements(env.DB, otherTenant, "summary_groups", [
      { group: "status", amountField: "amount" },
    ]),
  );
  for (let offset = 0; offset < 1000; offset += 100) {
    const records = Array.from({ length: 100 }, (_, index) => {
      const number = offset + index;
      return env.DB.prepare(
        "INSERT INTO studio_records(tenant_id,id,object_name,data) VALUES(?,?,?,?)",
      ).bind(
        cardinalityTenant,
        `summary-${number}`,
        "summary_groups",
        JSON.stringify({
          status: `group-${number.toString().padStart(4, "0")}`,
          amount: number,
        }),
      );
    });
    await env.DB.batch(records);
  }
  for (let number = 0; number < 100; number++)
    await env.DB.prepare(
      "INSERT INTO studio_records(tenant_id,id,object_name,data) VALUES(?,?,?,?)",
    )
      .bind(
        otherTenant,
        `other-${number}`,
        "summary_groups",
        JSON.stringify({ status: `other-${number}`, amount: number }),
      )
      .run();

  const exact = await maintainedGroupCountStatement(
    env.DB,
    cardinalityTenant,
    cardinalityObject,
    "status",
    "group-0999",
  ).all<{ count: number }>();
  expect(exact.results[0].count).toBe(1);
  expect(exact.meta.rows_read).toBeLessThan(25);

  const updated = await env.DB.prepare(
    "UPDATE studio_records SET data=? WHERE tenant_id=? AND id=?",
  )
    .bind(
      JSON.stringify({ status: "changed", amount: 999 }),
      cardinalityTenant,
      "summary-0500",
    )
    .run();
  expect(updated.meta.rows_read).toBeLessThan(100);

  const deleted = await env.DB.prepare(
    "DELETE FROM studio_records WHERE tenant_id=? AND id=?",
  )
    .bind(cardinalityTenant, "summary-0501")
    .run();
  expect(deleted.meta.rows_read).toBeLessThan(100);
});
