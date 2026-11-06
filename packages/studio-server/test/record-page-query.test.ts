import { afterAll, beforeAll, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { buildRecordPageSelection } from "../src/record-page-query";
import {
  decodeRecordCursor,
  encodeRecordCursor,
  paginationScope,
  type RecordCursor,
} from "../src/record-pagination";

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
      "CREATE TABLE record_page_test (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, sort_value)",
    )
    .run();
});

afterAll(async () => {
  await platform?.dispose();
});

function selection(cursor: RecordCursor | undefined, order: "ASC" | "DESC") {
  return buildRecordPageSelection({
    source: "record_page_test",
    where: "tenant_id=?",
    args: ["tenant"],
    sortSql: "sort_value",
    sortName: "sort_value",
    order,
    perPage: 37,
    offset: 0,
    cursor,
  });
}

async function ids(sql: string, bindings: unknown[]) {
  return (
    await db
      .prepare(sql)
      .bind(...(bindings as (string | number | null)[]))
      .all<{ id: string }>()
  ).results.map((row) => row.id);
}

it("keeps SQLite ordering for mixed numeric, text, and null cursor values across pages", async () => {
  const values: (number | string | null)[] = [
    null,
    null,
    -3,
    0,
    2.5,
    "",
    "01",
    "alpha",
    "zeta",
  ];
  await db.prepare("DELETE FROM record_page_test").run();
  await db.batch(
    values.map((value, index) =>
      db
        .prepare("INSERT INTO record_page_test VALUES(?,?,?)")
        .bind(`mixed-${index.toString().padStart(2, "0")}`, "tenant", value),
    ),
  );

  for (const order of ["ASC", "DESC"] as const) {
    const expected = await ids(
      `SELECT id FROM record_page_test WHERE tenant_id=? ORDER BY sort_value ${order},id ASC`,
      ["tenant"],
    );
    const actual: string[] = [];
    let cursor: RecordCursor | undefined;
    while (actual.length < expected.length) {
      const query = selection(cursor, order);
      const page = await db
        .prepare(query.sql)
        .bind(...(query.bindings as (string | number | null)[]))
        .all<{ id: string }>();
      const selected = page.results.slice(0, 37);
      actual.push(...selected.map((row) => row.id));
      if (selected.length < 37) break;
      const lastId = selected.at(-1)!.id;
      const last = await db
        .prepare("SELECT sort_value AS value FROM record_page_test WHERE id=?")
        .bind(lastId)
        .first<{ value: string | number | null }>();
      cursor = { id: lastId, value: last!.value };
    }
    expect(actual).toEqual(expected);
    expect(new Set(actual).size).toBe(actual.length);
  }
});

it("seeks past more than a thousand equal sort values with bounded tie queries", async () => {
  await db.prepare("DELETE FROM record_page_test").run();
  const batchSize = 100;
  for (let start = 0; start < 1205; start += batchSize) {
    const batch = [];
    for (let i = start; i < Math.min(start + batchSize, 1205); i++) {
      batch.push(
        db
          .prepare("INSERT INTO record_page_test VALUES(?,?,?)")
          .bind(`tie-${i.toString().padStart(4, "0")}`, "tenant", "same"),
      );
    }
    await db.batch(batch);
  }

  const expected = await ids(
    "SELECT id FROM record_page_test WHERE tenant_id=? ORDER BY sort_value ASC,id ASC",
    ["tenant"],
  );
  const actual: string[] = [];
  let cursor: RecordCursor | undefined;
  while (actual.length < expected.length) {
    const query = selection(cursor, "ASC");
    const page = await db
      .prepare(query.sql)
      .bind(...(query.bindings as (string | number | null)[]))
      .all<{ id: string }>();
    const selected = page.results.slice(0, 37);
    actual.push(...selected.map((row) => row.id));
    if (selected.length < 37) break;
    cursor = { id: selected.at(-1)!.id, value: "same" };
  }
  expect(actual).toEqual(expected);
  expect(new Set(actual).size).toBe(actual.length);
  const deepQuery = selection({ id: "tie-1109", value: "same" }, "ASC");
  expect((await ids(deepQuery.sql, deepQuery.bindings))[0]).toBe("tie-1110");
  expect(deepQuery.sql).toContain("LIMIT ?");
});

it("round trips numeric, null, and legacy string cursor values", async () => {
  const scope = await paginationScope(["tenant", "items"]);
  for (const value of ["old-token-value", 17.25, null] as const) {
    const token = encodeRecordCursor(scope, value, "row-id");
    expect(decodeRecordCursor(token, scope)).toEqual({ value, id: "row-id" });
  }
});
