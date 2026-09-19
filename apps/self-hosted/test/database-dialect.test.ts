import { test, expect } from "vitest";
import {
  dialectFor,
  registerDialect,
  sqliteDialect,
  type SqlDialect,
  type JsonOperator,
} from "@savia/db/dialect";
import { postgresDialect } from "@savia/db/postgres-dialect";
import { openSqliteDatabase } from "../src/sqlite";
import {
  withPostgresFixture,
  postgresTestUrl,
  postgresTestsRequired,
} from "./postgres-fixture";
import { buildWhere } from "@savia/crm-server/query";
type CrmObject = Parameters<typeof buildWhere>[0];
import { compileAccessWhere } from "@savia/crm-server/access-query";
type AccessPolicy = Parameters<typeof compileAccessWhere>[0];
const values = [
  {},
  { value: null },
  { value: false },
  { value: 0 },
  { value: true },
  { value: 1 },
  { value: "0" },
  { value: "1" },
  { value: 2.5 },
  { value: [] },
  { value: ["x", 0] },
  { value: "x" },
  { value: "" },
  { value: { a: 1 } },
  { value: [" a b ", 'quote\" and \\ slash', { nested: [1, 2] }] },
  { value: "X" },
  { value: "☃" },
  { value: "é" },
  { value: "É" },
];
async function contract(db: D1Database, dialect: SqlDialect) {
  await db.exec("CREATE TABLE sample(id INTEGER PRIMARY KEY, data TEXT)");
  for (const [id, data] of values.entries())
    await db
      .prepare("INSERT INTO sample VALUES (?,?)")
      .bind(id, JSON.stringify({ ...data, "quoted'\"☃": "safe" }))
      .run();
  const rows = async (sql: string, args: unknown[] = []) =>
    (
      await db
        .prepare(`SELECT id FROM sample WHERE ${sql} ORDER BY id`)
        .bind(...args)
        .all()
    ).results.map((r) => r.id);
  const comparisons: Record<string, unknown> = {};
  for (const op of ["eq", "ne", "lt", "lte", "gt", "gte"] as JsonOperator[])
    for (const value of [null, false, 0, true, 1, "0", "1", "x", 2.5, ""]) {
      const c = dialect.jsonCompare("data", "$.value", op, value);
      comparisons[op + JSON.stringify(value)] = await rows(c.sql, c.parameters);
    }
  const types = (
    await db
      .prepare(
        `SELECT id,${dialect.jsonType("data", "$.value")} AS type FROM sample ORDER BY id`,
      )
      .all()
  ).results;
  const quoted = await rows(`${dialect.jsonValue("data", "$.quoted'\"☃")}=?`, [
    "safe",
  ]);
  const members = await rows(
    `EXISTS(SELECT 1 FROM ${dialect.jsonEach("data", "$.value", "j")} WHERE j.value=?)`,
    ["x"],
  );
  const sorted = (
    await db
      .prepare(
        `SELECT id FROM sample ORDER BY ${dialect.jsonSort("data", "$.value")},id`,
      )
      .all()
  ).results.map((r) => r.id);
  for (const column of ["tenant_id", "object_name", "deleted_at"])
    await db.exec(`ALTER TABLE sample ADD COLUMN ${column} TEXT`);
  await db
    .prepare("UPDATE sample SET tenant_id=?, object_name=?")
    .bind("tenant", "sample")
    .run();
  const object = {
    name: "sample",
    config: { fields: { value: { type: "text" } } },
  } as unknown as CrmObject;
  const filters: Record<string, unknown> = {};
  for (const [op, value] of [
    ["empty", null],
    ["contains", "x"],
    ["startsWith", "É"],
    ["endsWith", "0"],
    ["in", [0, "0", false]],
    ["eq", null],
    ["ne", false],
  ]) {
    const query = buildWhere(
      object,
      "tenant",
      {
        filters: JSON.stringify({
          conditions: [{ field: "value", op, value }],
        }),
      },
      undefined,
      dialect,
    );
    filters[String(op)] = await rows(query.where, query.args);
  }
  for (const searchFields of [undefined, "value"]) {
    const query = buildWhere(
      object,
      "tenant",
      { q: "X", searchFields },
      undefined,
      dialect,
    );
    filters["search" + searchFields] = await rows(query.where, query.args);
  }
  const acl: Record<string, unknown> = {};
  for (const value of [null, false, true, 0, 1, "0", "x"]) {
    const policy = {
      grants: [
        {
          resource: "collection:sample",
          action: "read",
          predicate: { field: "value", op: "eq", value: { literal: value } },
        },
      ],
    } as unknown as AccessPolicy;
    const compiled = compileAccessWhere(
      policy,
      "collection:sample",
      "read",
      {
        value: {
          expression: dialect.jsonValue("data", "$.value"),
          type: dialect.jsonType("data", "$.value"),
          document: "data",
          path: "$.value",
        },
      },
      dialect,
    );
    acl[JSON.stringify(value)] = await rows(compiled.sql, compiled.bindings);
  }
  const unusual = "x'); DROP TABLE sample; --";
  const unsafeDocument = JSON.stringify({ [unusual]: "safe" });
  expect(
    await db
      .prepare(
        `SELECT ${dialect.jsonValue("document", "$." + unusual)} AS value FROM (SELECT ? AS document) source`,
      )
      .bind(unsafeDocument)
      .first("value"),
  ).toBe("safe");
  const lexical = [];
  const scientificSearch = [];
  for (const document of [
    '{"value": 1.0}',
    '{"value": 1e2}',
    '{"value": 1e-7}',
    '{"value": -1e-7}',
    '{"value": 1e20}',
    '{"value": 1.25e-7}',
    '{"value": [ " a b ", { "x": 2 } ]}',
  ]) {
    // Expressions reference a column because a dialect can use it repeatedly.
    await db
      .prepare("UPDATE sample SET data=? WHERE id=0")
      .bind(document)
      .run();
    lexical.push(
      await db
        .prepare(
          `SELECT ${dialect.jsonType("data", "$.value")} AS type, ${dialect.jsonText("data", "$.value")} AS value FROM sample WHERE id=0`,
        )
        .first(),
    );
  }
  for (const [document, search] of [
    ['{"value":1e-7}', "1.0e-07"],
    ['{"value":1e20}', "1.0e+20"],
  ]) {
    await db
      .prepare("UPDATE sample SET data=? WHERE id=0")
      .bind(document)
      .run();
    const query = buildWhere(
      object,
      "tenant",
      { q: search, searchFields: "value" },
      undefined,
      dialect,
    );
    scientificSearch.push(await rows(query.where, query.args));
  }

  const exists = dialect.tableExists("sample"),
    columns = dialect.tableColumns("sample");
  expect(
    (
      await db
        .prepare(exists.sql)
        .bind(...exists.parameters)
        .all()
    ).results,
  ).toHaveLength(1);
  expect(
    (
      await db
        .prepare(columns.sql)
        .bind(...columns.parameters)
        .all()
    ).results.map((c) => c.name),
  ).toEqual(["id", "data", "tenant_id", "object_name", "deleted_at"]);
  expect(
    await db.prepare(`SELECT ${dialect.utcNow()} AS now`).first("now"),
  ).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  return {
    comparisons,
    types,
    quoted,
    members,
    sorted,
    acl,
    filters,
    lexical,
    scientificSearch,
  };
}
test("unregistered Cloudflare bindings default to SQLite; registrations are per object", () => {
  const a = {},
    b = {};
  registerDialect(a, postgresDialect);
  expect(dialectFor(a)).toBe(postgresDialect);
  expect(dialectFor(b)).toBe(sqliteDialect);
});
test("SQLite JSON contract distinguishes permission scalar types", async () => {
  const db = openSqliteDatabase(":memory:");
  try {
    const result = await contract(db, sqliteDialect);
    expect(result.acl.false).toEqual([2]);
    expect(result.acl["0"]).toEqual([3]);
    expect(result.acl['"0"']).toEqual([6]);
    expect(result.quoted).toHaveLength(values.length);
  } finally {
    db.close();
  }
});
test.runIf(Boolean(postgresTestUrl) || postgresTestsRequired)(
  "real PostgreSQL has identical JSON operators, sorting and ACL semantics",
  async () => {
    const sqlite = openSqliteDatabase(":memory:");
    try {
      const expected = await contract(sqlite, sqliteDialect);
      await withPostgresFixture(async (db) => {
        expect(await contract(db, postgresDialect)).toEqual(expected);
      });
    } finally {
      sqlite.close();
    }
  },
);
