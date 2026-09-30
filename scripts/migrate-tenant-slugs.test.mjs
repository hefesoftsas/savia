import assert from "node:assert/strict";
import { test } from "node:test";
import { planTenantSlugMigration } from "./migrate-tenant-slugs.mjs";
const old = "b14431f5-dea6-4846-8f40-85229c108cf6";
test("migrates only UUID slugs, retains readable names and reserves aliases", () => {
  const rows = [
    { id: 4, name: "Savia Team", idSlug: old, kind: "commercial" },
    {
      id: 3,
      name: "Merka Seguros",
      idSlug: "merkaseguros",
      kind: "commercial",
    },
  ];
  assert.deepEqual(planTenantSlugMigration(rows, ["savia-team"]), [
    { id: 4, name: "Savia Team", previousSlug: old, slug: "savia-team-2" },
  ]);
});
test("allocates repeated names deterministically and is idempotent after application", () => {
  const rows = [
    { id: 2, name: "Águila", idSlug: old, kind: "commercial" },
    {
      id: 1,
      name: "Águila",
      idSlug: "a14431f5-dea6-4846-8f40-85229c108cf6",
      kind: "commercial",
    },
  ];
  const plan = planTenantSlugMigration(rows, []);
  assert.deepEqual(
    plan.map((x) => [x.id, x.slug]),
    [
      [1, "aguila"],
      [2, "aguila-2"],
    ],
  );
  assert.deepEqual(
    planTenantSlugMigration(
      rows.map((r) => ({ ...r, idSlug: plan.find((p) => p.id === r.id).slug })),
      [],
    ),
    [],
  );
});

test("applies the forward migration and preserves old addresses atomically", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { readFileSync } = await import("node:fs");
  const { tenantMigrationBatch } = await import("./migrate-tenant-slugs.mjs");
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      "CREATE TABLE tenants(id INTEGER PRIMARY KEY, name TEXT, id_slug TEXT UNIQUE NOT NULL, kind TEXT, updated_at TEXT)",
    );
    db.prepare("INSERT INTO tenants VALUES(4,?,?,?,?)").run(
      "Savia Team",
      old,
      "commercial",
      "before",
    );
    db.exec(
      readFileSync(
        new URL(
          "../packages/db/migrations/0003_tenant_slug_aliases.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const row = planTenantSlugMigration(
      [{ id: 4, name: "Savia Team", idSlug: old, kind: "commercial" }],
      [old],
    )[0];
    db.exec("BEGIN");
    for (const stmt of tenantMigrationBatch(row, "after"))
      db.prepare(stmt.sql).all(...stmt.params);
    db.exec("COMMIT");
    assert.equal(
      db.prepare("SELECT id_slug FROM tenants WHERE id=4").get().id_slug,
      "savia-team",
    );
    assert.deepEqual(
      db
        .prepare("SELECT slug FROM tenant_slug_aliases ORDER BY slug")
        .all()
        .map((x) => x.slug),
      [old, "savia-team"],
    );
    // A stale plan must not reserve a new alias after another process changes the URL.
    const stale = { ...row, slug: "unused-stale" };
    for (const stmt of tenantMigrationBatch(stale, "later"))
      db.prepare(stmt.sql).all(...stmt.params);
    assert.equal(
      db
        .prepare("SELECT COUNT(*) AS n FROM tenant_slug_aliases WHERE slug=?")
        .get(stale.slug).n,
      0,
    );
  } finally {
    db.close();
  }
});
