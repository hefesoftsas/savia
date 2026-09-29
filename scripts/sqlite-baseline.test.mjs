import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteBaseline } from "./sqlite-baseline.mjs";
for (const directory of [
  "packages/db/migrations",
  "packages/studio-server/migrations",
  "apps/savia-request/migrations",
])
  test(`baseline round trip preserves ${directory}`, () => {
    const source = new DatabaseSync(":memory:");
    const copy = new DatabaseSync(":memory:");
    try {
      source.exec("PRAGMA foreign_keys=ON");
      copy.exec("PRAGMA foreign_keys=ON");
      const files = readdirSync(directory)
        .filter((f) => f.endsWith(".sql"))
        .sort();
      assert.deepEqual(
        files,
        !directory.includes("packages/db/")
          ? ["0001_initial.sql"]
          : ["0001_initial.sql", "0002_bootstrap.sql"],
      );
      for (const file of files)
        source.exec(readFileSync(directory + "/" + file, "utf8"));
      const snapshot = sqliteBaseline(source);
      copy.exec(snapshot.schema);
      copy.exec(snapshot.bootstrap);
      const objects = (db) =>
        db
          .prepare(
            "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
          )
          .all();
      assert.deepEqual(objects(copy), objects(source));
      for (const { name, type } of source.prepare("PRAGMA table_list").all()) {
        if (type !== "table" || name.startsWith("sqlite_")) continue;
        const sql = 'SELECT * FROM "' + name.replaceAll('"', '""') + '"';
        assert.deepEqual(
          copy.prepare(sql).all(),
          source.prepare(sql).all(),
          name,
        );
      }
      assert.deepEqual(copy.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      source.close();
      copy.close();
    }
  });

test("schema snapshots exclude installer history and Cloudflare internals", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      "CREATE TABLE _savia_migrations(filename TEXT);INSERT INTO _savia_migrations VALUES('retired.sql');CREATE TABLE d1_migrations(name TEXT);CREATE TABLE _cf_METADATA(key TEXT);CREATE TABLE items(id TEXT PRIMARY KEY)",
    );
    const snapshot = sqliteBaseline(db);
    assert.doesNotMatch(
      snapshot.schema,
      /_savia_migrations|d1_migrations|_cf_METADATA/,
    );
    assert.equal(snapshot.seedCount, 0);
    assert.match(snapshot.schema, /CREATE TABLE items/);
  } finally {
    db.close();
  }
});

test("fresh core has no retired industry, customer or migration bookkeeping tables", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(readFileSync("packages/db/migrations/0001_initial.sql", "utf8"));
    db.exec(readFileSync("packages/db/migrations/0002_bootstrap.sql", "utf8"));
    const objects = db
      .prepare("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL")
      .all();
    const retired =
      /\b(?:agencies|agency_branches|agency_contacts|auto_light_quote_\w+|customer_\w+|managed_customer_\w+|insurer_companies|ramos|sub_ramos|legacy_import_\w+|tenant_consolidation_\w+|tenant_namespace_migrations|crm_sync_rules|crm_sync_jobs|crm_sync_mappings|business_commercialunit|app_economicactivity|document_ownership|attachment_uploads|countries|departments|cities|categories)\b/;
    assert.doesNotMatch(
      readFileSync("packages/db/postgres/0001_initial.sql", "utf8"),
      retired,
      "PostgreSQL baseline must also exclude retired tables and dependencies",
    );
    for (const object of objects)
      assert.doesNotMatch(object.sql, retired, object.name);
    // Tenant creation must work without the removed agency mirror.
    db.exec(
      "INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at,kind) VALUES(7,'example','Example',1,'now','now','commercial')",
    );
    db.exec("UPDATE tenants SET name='Updated' WHERE id=7");
    assert.equal(
      db.prepare("SELECT name FROM tenants WHERE id=7").get().name,
      "Updated",
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
});
