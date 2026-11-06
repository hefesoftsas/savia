import { expect, it } from "vitest";
import { SqliteDatabase } from "../src/sqlite";
import { tableNames, foreignKeys } from "../../api/src/lib/database-schema";
import { postgresTestUrl, withPostgresFixture } from "./postgres-fixture";
import { registerDialect } from "@savia/db/dialect";
import { postgresDialect } from "@savia/db/postgres-dialect";
async function exercise(db: D1Database) {
  await db.exec("CREATE TABLE tenants(id INTEGER PRIMARY KEY)");
  await db.exec(
    "CREATE TABLE crm_child(id INTEGER PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE RESTRICT)",
  );
  expect(await tableNames(db, "tenant_id")).toContain("crm_child");
  expect((await foreignKeys(db, "crm_child"))[0]).toMatchObject({
    table: "tenants",
    from: "tenant_id",
    to: "id",
    on_delete: "RESTRICT",
  });
}
it("inspects SQLite tenant references", async () => {
  const db = new SqliteDatabase(":memory:");
  try {
    await exercise(db);
  } finally {
    db.close();
  }
});
it.skipIf(!postgresTestUrl)("inspects PostgreSQL tenant references", async () =>
  withPostgresFixture(async (db) => {
    registerDialect(db, postgresDialect);
    await exercise(db);
  }),
);

it("does not inspect SQLite reserved internal tables", async () => {
  const db = new SqliteDatabase(":memory:");
  try {
    await db.exec("CREATE TABLE _cf_internal(id INTEGER PRIMARY KEY)");
    expect(await tableNames(db)).not.toContain("_cf_internal");
  } finally {
    db.close();
  }
});
