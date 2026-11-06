import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { createStudioApp } from "@savia/studio-server";
const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
);
const app = createStudioApp("pagination-test");
const bindings = () => ({
  DB: env.DB,
  FILES: env.DOCUMENTS,
  POC_LOCAL: "false",
});
const request = (path: string) =>
  app.request("http://localhost/api" + path, {}, bindings());
beforeAll(async () => {
  for (const [, sql] of migrations.sort(([a], [b]) => a.localeCompare(b)))
    for (const part of sql.split("--> statement-breakpoint")) {
      const normalized = part
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (normalized) await env.DB.exec(normalized);
    }
  await env.DB.prepare(
    "INSERT INTO studio_objects(tenant_id,name,label,config) VALUES (?,?,?,?)",
  )
    .bind(
      "pagination-test",
      "items",
      "Items",
      JSON.stringify({ fields: { name: { type: "Text", label: "Name" } } }),
    )
    .run();
  for (let i = 1; i <= 7; i++)
    await env.DB.prepare(
      "INSERT INTO studio_records(tenant_id,id,object_name,data,updated_at) VALUES (?,?,?,?,?)",
    )
      .bind(
        "pagination-test",
        String(i),
        "items",
        JSON.stringify({ name: "Item " + i }),
        i < 5 ? "2026-01-02" : "2026-01-01",
      )
      .run();
});
it("returns cursor pages without losing records with equal sort dates", async () => {
  const first: any = await (await request("/records/items?perPage=3")).json();
  expect(first.data.map((r: any) => r.id)).toEqual(["1", "2", "3"]);
  expect(first.nextCursor).toEqual(expect.any(String));
  const second: any = await (
    await request(
      "/records/items?perPage=3&page=2&cursor=" +
        encodeURIComponent(first.nextCursor),
    )
  ).json();
  expect(second.data.map((r: any) => r.id)).toEqual(["4", "5", "6"]);
  expect(second.total).toBe(7);
  const third: any = await (
    await request(
      "/records/items?perPage=3&page=3&cursor=" +
        encodeURIComponent(second.nextCursor),
    )
  ).json();
  expect(third.data.map((r: any) => r.id)).toEqual(["7"]);
  expect(third.nextCursor).toBeNull();
});
it("rejects a cursor reused with a different sort or filter", async () => {
  const first: any = await (await request("/records/items?perPage=3")).json();
  expect(first.nextCursor).toEqual(expect.any(String));
  const response = await request(
    "/records/items?perPage=3&order=ASC&cursor=" +
      encodeURIComponent(first.nextCursor),
  );
  expect(response.status).toBe(422);
});
it("keeps numbered page jumps compatible", async () => {
  const result: any = await (
    await request("/records/items?perPage=3&page=2")
  ).json();
  expect(result.data.map((r: any) => r.id)).toEqual(["4", "5", "6"]);
  expect(result.total).toBe(7);
});

it("invalidates cached sorted pages and summaries immediately after a mutation", async () => {
  const sorted = "/records/items?sort=name&order=ASC&perPage=3";
  const before: any = await (await request(sorted)).json();
  const warm: any = await (await request(sorted)).json();
  expect(warm).toEqual(before);
  const summary = "/records/items/summary?group=name";
  const oldSummary: any = await (await request(summary)).json();
  expect(oldSummary.data).toHaveLength(7);
  await env.DB.prepare(
    "UPDATE studio_records SET data=? WHERE tenant_id=? AND id=?",
  )
    .bind(JSON.stringify({ name: "AAA" }), "pagination-test", "7")
    .run();
  const after: any = await (await request(sorted)).json();
  expect(after.data[0].id).toBe("7");
  expect(after.total).toBe(7);
  const newSummary: any = await (await request(summary)).json();
  expect(newSummary.data.some((r: any) => r.value === "AAA")).toBe(true);
  expect(newSummary.data.some((r: any) => r.value === "Item 7")).toBe(false);
});
it("returns exact trash counts after deleting and restoring a record", async () => {
  await env.DB.prepare(
    "UPDATE studio_records SET deleted_at='2026-01-03' WHERE tenant_id=? AND id=?",
  )
    .bind("pagination-test", "7")
    .run();
  expect(
    ((await (await request("/records/items?trash=true")).json()) as any).total,
  ).toBe(1);
  expect(((await (await request("/records/items")).json()) as any).total).toBe(
    6,
  );
  await env.DB.prepare(
    "UPDATE studio_records SET deleted_at=NULL WHERE tenant_id=? AND id=?",
  )
    .bind("pagination-test", "7")
    .run();
  expect(((await (await request("/records/items")).json()) as any).total).toBe(
    7,
  );
});

it.each([
  {
    sort: "updated_at",
    order: "ASC",
    first: ["5", "6", "7"],
    second: ["1", "2", "3"],
  },
  {
    sort: "id",
    order: "DESC",
    first: ["7", "6", "5"],
    second: ["4", "3", "2"],
  },
])(
  "seeks correctly for $sort $order",
  async ({ sort, order, first, second }) => {
    const query = `/records/items?perPage=3&sort=${sort}&order=${order}`;
    const initial: any = await (await request(query)).json();
    expect(initial.data.map((r: any) => r.id)).toEqual(first);
    const next: any = await (
      await request(query + "&cursor=" + encodeURIComponent(initial.nextCursor))
    ).json();
    expect(next.data.map((r: any) => r.id)).toEqual(second);
  },
);

it("seeks deep into a large group with the same timestamp without rescanning it", async () => {
  await env.DB.prepare(
    "INSERT INTO studio_objects(tenant_id,name,label,config) VALUES (?,?,?,?)",
  )
    .bind(
      "pagination-test",
      "ties",
      "Ties",
      JSON.stringify({ fields: { name: { type: "Text", label: "Name" } } }),
    )
    .run();
  await env.DB.exec(
    "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<1000) INSERT INTO studio_records(tenant_id,id,object_name,data,updated_at) SELECT 'pagination-test',printf('tie%04d',i),'ties',json_object('name',i),'2026-01-01' FROM n;",
  );
  const anchor: any = await (
    await request("/records/ties?perPage=25&page=36")
  ).json();
  let rowsRead = 0;
  const db = new Proxy(env.DB, {
    get(target, key) {
      if (key === "batch")
        return async (statements: D1PreparedStatement[]) => {
          const results = await target.batch(statements);
          rowsRead += results.reduce((n, r) => n + r.meta.rows_read, 0);
          return results;
        };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const response = await app.request(
    "http://localhost/api/records/ties?perPage=25&cursor=" +
      encodeURIComponent(anchor.nextCursor),
    {},
    { ...bindings(), DB: db },
  );
  const next: any = await response.json();
  expect(response.status).toBe(200);
  expect(next.data[0].id).toBe("tie0901");
  expect(next.data.at(-1).id).toBe("tie0925");
  expect(rowsRead).toBeLessThan(150);
});
