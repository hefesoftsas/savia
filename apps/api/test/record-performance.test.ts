import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { createStudioApp } from "@savia/studio-server";

const tenant = "performance-test";
const app = createStudioApp(tenant);
const bindings = { DB: env.DB, FILES: env.DOCUMENTS, POC_LOCAL: "false" };
const config = {
  version: 2,
  fields: {
    name: { type: "Textbox", label: "Name" },
    stage: { type: "Textbox", label: "Stage" },
    amount: { type: "Number", label: "Amount" },
  },
  fieldOrder: ["name", "stage", "amount"],
  performance: {
    indexes: [
      { fields: ["name"], order: "ASC" },
      { fields: ["stage", "updated_at"], order: "DESC" },
    ],
    summaries: [{ group: "stage", amountField: "amount" }],
  },
};
const request = (path: string, body?: unknown) =>
  app.request(
    "http://localhost/api" + path,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
    bindings,
  );
beforeAll(async () => {
  for (const [, sql] of Object.entries(
    import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
      eager: true,
      import: "default",
      query: "?raw",
    }),
  ).sort(([a], [b]) => a.localeCompare(b)))
    for (const part of sql.split("--> statement-breakpoint")) {
      const normalized = part
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (normalized) await env.DB.exec(normalized);
    }
});
it("creates only configured indexes when a collection is created", async () => {
  const response = await request("/objects", {
    name: "indexed_items",
    label: "Indexed items",
    config,
  });
  expect(response.status).toBe(201);
  const indexes = await env.DB.prepare(
    "SELECT name,sql FROM sqlite_master WHERE type='index' AND name LIKE 'studio_perf_%'",
  ).all();
  expect(indexes.results).toHaveLength(2);
  expect(
    indexes.results.every((r) => String(r.sql).includes("performance-test")),
  ).toBe(true);
});
it("rejects unknown performance fields before publishing", async () => {
  const response = await request("/objects", {
    name: "invalid_index",
    label: "Invalid index",
    config: { ...config, performance: { indexes: [{ fields: ["missing"] }] } },
  });
  expect(response.status).toBe(422);
});
it("bounds index configuration instead of indexing every field", async () => {
  const response = await request("/objects", {
    name: "too_many",
    label: "Too many",
    config: {
      ...config,
      performance: {
        indexes: Array.from({ length: 5 }, () => ({ fields: ["name"] })),
      },
    },
  });
  expect(response.status).toBe(422);
});
it("reads a bounded first page from a configured JSON index without a warm cache", async () => {
  await env.DB.prepare(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<2000)
    INSERT INTO studio_records(tenant_id,id,object_name,data) SELECT ?,printf('perf-%05d',i),'indexed_items',json_object('name',printf('Person%05d',2001-i),'stage',CASE WHEN i%2=0 THEN 'open' ELSE 'closed' END,'amount',i) FROM n`,
  )
    .bind(tenant)
    .run();
  let rowsRead = 0;
  const measuredDb = new Proxy(env.DB, {
    get(target, key) {
      if (key === "batch")
        return async (statements: D1PreparedStatement[]) => {
          const results = await target.batch(statements);
          rowsRead += results.reduce(
            (n, r) => n + Number(r.meta.rows_read ?? 0),
            0,
          );
          return results;
        };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const response = await app.request(
    "http://localhost/api/records/indexed_items?sort=name&order=ASC&perPage=25",
    {},
    { ...bindings, DB: measuredDb },
  );
  expect(response.status).toBe(200);
  const body: any = await response.json();
  expect(body.total).toBe(2000);
  expect(body.data[0].name).toBe("Person00001");
  expect(rowsRead).toBeLessThan(150);
});
it("returns typed custom-field cursors after an indexed cold page", async () => {
  const first: any = await (
    await request("/records/indexed_items?sort=name&order=ASC&perPage=25")
  ).json();
  expect(first.nextCursor).toEqual(expect.any(String));
  const second: any = await (
    await request(
      "/records/indexed_items?sort=name&order=ASC&perPage=25&cursor=" +
        encodeURIComponent(first.nextCursor),
    )
  ).json();
  expect(second.data[0].name).toBe("Person00026");
  expect(second.total).toBe(2000);
});
it("reconfigures indexes without rewriting records and removes retired indexes", async () => {
  const before = await env.DB.prepare(
    "SELECT id,data,version,updated_at FROM studio_records WHERE tenant_id=? ORDER BY id",
  )
    .bind(tenant)
    .all();
  const response = await app.request(
    "http://localhost/api/objects/indexed_items/performance",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: 1,
        performance: { indexes: [{ fields: ["amount"], order: "DESC" }] },
      }),
    },
    bindings,
  );
  expect(response.status).toBe(200);
  const after = await env.DB.prepare(
    "SELECT id,data,version,updated_at FROM studio_records WHERE tenant_id=? ORDER BY id",
  )
    .bind(tenant)
    .all();
  expect(after.results).toEqual(before.results);
  const indexes = await env.DB.prepare(
    "SELECT sql FROM sqlite_master WHERE type='index' AND name LIKE 'studio_perf_%'",
  ).all();
  expect(indexes.results).toHaveLength(1);
  expect(String(indexes.results[0].sql)).toContain("$.amount");
  const stale = await app.request(
    "http://localhost/api/objects/indexed_items/performance",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 1, performance: { indexes: [] } }),
    },
    bindings,
  );
  expect(stale.status).toBe(409);
});
it("serves fresh summaries and exact filtered totals after edits to the same collection", async () => {
  const setup = await app.request(
    "http://localhost/api/objects/indexed_items/performance",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 2, performance: config.performance }),
    },
    bindings,
  );
  expect(setup.status).toBe(200);
  const first: any = await (
    await request("/records/indexed_items?stage=open&perPage=25")
  ).json();
  expect(first.total).toBe(1000);
  await env.DB.prepare(
    "UPDATE studio_records SET data=json_set(data,'$.stage','closed','$.amount',3000) WHERE tenant_id=? AND id='perf-00002'",
  )
    .bind(tenant)
    .run();
  const second: any = await (
    await request("/records/indexed_items?stage=open&perPage=25")
  ).json();
  expect(second.total).toBe(999);
  const summary: any = await (
    await request(
      "/records/indexed_items/summary?group=stage&amountField=amount",
    )
  ).json();
  const expected = await env.DB.prepare(
    "SELECT json_extract(data,'$.stage') AS value,COUNT(*) AS count,SUM(CAST(json_extract(data,'$.amount') AS REAL)) AS amount FROM studio_records WHERE tenant_id=? AND object_name='indexed_items' AND deleted_at IS NULL GROUP BY value ORDER BY count DESC",
  )
    .bind(tenant)
    .all();
  expect(summary.data).toEqual(expected.results);
});
it("keeps row permissions authoritative for totals and summaries", async () => {
  await env.DB.prepare(
    "INSERT INTO access_revisions(scope,revision) VALUES ('platform',1) ON CONFLICT(scope) DO UPDATE SET revision=1",
  ).run();
  const restricted = createStudioApp(tenant, {
    accessPolicy: {
      principalId: "restricted-reader",
      scope: "platform",
      revision: 1,
      grants: [
        {
          id: "read",
          roleId: "reader",
          resource: "collection:indexed_items",
          action: "read",
          fields: ["name", "stage", "amount"],
          predicate: { field: "amount", op: "lt", value: { literal: 10 } },
        },
      ],
    },
  });
  const get = (path: string) =>
    restricted.request("http://localhost/api" + path, {}, bindings);
  const list: any = await (
    await get("/records/indexed_items?stage=open")
  ).json();
  expect(list, JSON.stringify(list)).toHaveProperty("total", 3);
  const summary: any = await (
    await get("/records/indexed_items/summary?group=stage&amountField=amount")
  ).json();
  expect(summary.data.reduce((n: number, r: any) => n + r.count, 0)).toBe(8);
  const denied = await restricted.request(
    "http://localhost/api/objects/indexed_items/performance",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 3, performance: { indexes: [] } }),
    },
    bindings,
  );
  expect(denied.status).toBe(403);
});
it("finishes an in-flight page if its configured index is retired concurrently", async () => {
  let retired = false;
  const db = new Proxy(env.DB, {
    get(target, key) {
      if (key === "batch")
        return async (statements: D1PreparedStatement[]) => {
          if (!retired) {
            retired = true;
            const row = await target
              .prepare(
                "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'studio_perf_%' AND sql LIKE '%$.name%'",
              )
              .first<{ name: string }>();
            if (row) await target.prepare(`DROP INDEX ${row.name}`).run();
          }
          return target.batch(statements);
        };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const response = await app.request(
    "http://localhost/api/records/indexed_items?sort=name&order=ASC",
    {},
    { ...bindings, DB: db },
  );
  expect(response.status).toBe(200);
  const body: any = await response.json();
  expect(body.total).toBe(2000);
  expect(body.data[0].name).toBe("Person00001");
});
it("keeps long indexed text readable without issuing an unusable cursor", async () => {
  expect(
    (
      await request("/objects", {
        name: "long_text",
        label: "Long text",
        config: {
          ...config,
          performance: { indexes: [{ fields: ["name"], order: "ASC" }] },
        },
      })
    ).status,
  ).toBe(201);
  await env.DB.batch(
    ["a".repeat(501), "z"].map((name, i) =>
      env.DB.prepare(
        "INSERT INTO studio_records(tenant_id,id,object_name,data) VALUES (?,?,'long_text',?)",
      ).bind(tenant, "long-" + i, JSON.stringify({ name })),
    ),
  );
  const response = await request(
    "/records/long_text?sort=name&order=ASC&perPage=1",
  );
  expect(response.status).toBe(200);
  const page: any = await response.json();
  expect(page.data[0].name).toHaveLength(501);
  expect(page.nextCursor).toBeNull();
});
