import { createStudioApp } from "@savia/studio-server";
import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import type { StudioObject } from "@savia/studio-shared/metadata";
import { postgresDialect } from "@savia/db/postgres-dialect";
import { buildWhere } from "../../../packages/studio-server/src/query";

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
});

const tenant = "search-index-test";
const objectName = "search_index_test";
const object = {
  name: objectName,
  config: { fields: { title: {}, code: {} } },
} as StudioObject;

async function optimizedIds(q: string, searchField?: string, trash = false) {
  const params: Record<string, string> = { q };
  if (searchField) params.searchField = searchField;
  if (trash) params.trash = "true";
  const { where, args } = buildWhere(object, tenant, params);
  const result = await env.DB.prepare(
    `SELECT id FROM studio_records WHERE ${where} ORDER BY id`,
  )
    .bind(...args)
    .all<{ id: string }>();
  return result.results.map(({ id }) => id);
}

async function legacyIds(q: string, searchField?: string, trash = false) {
  const pattern = `%${q.slice(0, 200).replace(/[\\%_]/g, "\\$&")}%`;
  const filter = searchField
    ? `CAST(json_extract(data, '$.${searchField}') AS TEXT) LIKE ? ESCAPE '\\'`
    : `EXISTS(SELECT 1 FROM json_each(data, '$') AS search WHERE CAST(search.value AS TEXT) LIKE ? ESCAPE '\\')`;
  const result = await env.DB.prepare(
    `SELECT id FROM studio_records WHERE tenant_id=? AND object_name=? AND deleted_at IS ${trash ? "NOT " : ""}NULL AND ${filter} ORDER BY id`,
  )
    .bind(tenant, objectName, ...(searchField ? [pattern] : [pattern]))
    .all<{ id: string }>();
  return result.results.map(({ id }) => id);
}

it("keeps substring semantics while the trigram index reduces rows read", async () => {
  await env.DB.prepare(
    "INSERT INTO studio_objects(tenant_id,name,label,config) VALUES(?,?,?,?)",
  )
    .bind(
      tenant,
      objectName,
      "Search index test",
      JSON.stringify(object.config),
    )
    .run();

  for (let offset = 0; offset < 1000; offset += 100) {
    const statements = Array.from({ length: 100 }, (_, index) => {
      const serial = offset + index;
      return env.DB.prepare(
        "INSERT INTO studio_records(id,tenant_id,object_name,data) VALUES(?,?,?,?)",
      ).bind(
        `record-${serial.toString().padStart(4, "0")}`,
        tenant,
        objectName,
        JSON.stringify({
          title: `distraction-${serial}`,
          code: `code-${serial}`,
          nested: { text: "nested needle / Unicode café" },
        }),
      );
    });
    await env.DB.batch(statements);
  }
  await env.DB.prepare(
    "INSERT INTO studio_records(id,tenant_id,object_name,data) VALUES(?,?,?,?)",
  )
    .bind(
      "target",
      tenant,
      objectName,
      JSON.stringify({
        title: 'Person"000000001%_\\café Person000000001',
        code: 123456,
        nested: ["deep needle"],
      }),
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO studio_records(id,tenant_id,object_name,data) VALUES(?,?,?,?)",
  )
    .bind(
      "nul-record",
      tenant,
      objectName,
      JSON.stringify({ title: "prefix\0suffix", code: "laterneedle" }),
    )
    .run();

  for (const q of [
    'Person"000000001',
    "Person000000001",
    "needle",
    "100%_",
    "%_\\c",
    "café",
    "laterneedle",
  ])
    expect(await optimizedIds(q)).toEqual(await legacyIds(q));
  expect(await optimizedIds("laterneedle")).toEqual(["nul-record"]);
  expect(await optimizedIds("Person000000001", "title")).toEqual(
    await legacyIds("Person000000001", "title"),
  );
  expect(await optimizedIds("Person000000001")).toEqual(["target"]);

  const { where, args } = buildWhere(object, tenant, { q: "Person000000001" });
  const indexed = await env.DB.prepare(
    `SELECT id FROM studio_records NOT INDEXED WHERE ${where} ORDER BY updated_at DESC, id ASC LIMIT 26`,
  )
    .bind(...args)
    .all();
  const scanned = await env.DB.prepare(
    `SELECT id FROM studio_records WHERE tenant_id=? AND object_name=? AND deleted_at IS NULL AND EXISTS(SELECT 1 FROM json_each(data, '$') AS search WHERE CAST(search.value AS TEXT) LIKE ? ESCAPE '\\') ORDER BY updated_at DESC, id ASC LIMIT 26`,
  )
    .bind(tenant, objectName, "%Person000000001%")
    .all();
  expect(indexed.results).toHaveLength(1);
  expect(scanned.results).toHaveLength(1);
  expect(indexed.meta.rows_read).toBeLessThan(scanned.meta.rows_read);
  expect(indexed.meta.rows_read * 20).toBeLessThan(scanned.meta.rows_read);

  await env.DB.prepare("UPDATE studio_records SET data=? WHERE id='target'")
    .bind(JSON.stringify({ title: "Updated distinct phrase", code: 123456 }))
    .run();
  expect(await optimizedIds("Person000000001")).toEqual([]);
  expect(await optimizedIds("Updated distinct phrase")).toEqual(["target"]);
  expect(await optimizedIds("Updated distinct phrase")).toEqual(
    await legacyIds("Updated distinct phrase"),
  );

  const shortSearch = buildWhere(object, tenant, { q: "Up" });
  const unsupportedSearch = buildWhere(object, tenant, { q: "a\0b" });
  const postgresSearch = buildWhere(
    object,
    tenant,
    { q: "Updated distinct phrase" },
    undefined,
    postgresDialect,
  );
  expect(shortSearch.where).not.toContain("studio_record_search_fts");
  expect(unsupportedSearch.where).not.toContain("studio_record_search_fts");
  expect(postgresSearch.where).not.toContain("studio_record_search_fts");

  await env.DB.prepare("DELETE FROM studio_records WHERE id='target'").run();
  expect(await optimizedIds("Updated distinct phrase")).toEqual([]);
});

it("materializes selective page candidates before fetching record payloads", async () => {
  await env.DB.prepare(
    "INSERT INTO studio_records(id,tenant_id,object_name,data) VALUES(?,?,?,?)",
  )
    .bind(
      "route-target",
      tenant,
      objectName,
      JSON.stringify({ title: "actual-route-needle" }),
    )
    .run();
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
  const response = await createStudioApp(tenant).request(
    `http://localhost/api/records/${objectName}?q=actual-route-needle`,
    {},
    { DB: db, FILES: env.DOCUMENTS, POC_LOCAL: "false" },
  );
  expect(response.status).toBe(200);
  const body: any = await response.json();
  expect(body.data.map((r: any) => r.id)).toEqual(["route-target"]);
  expect(body.total).toBe(1);
  expect(rowsRead).toBeLessThan(100);
});
