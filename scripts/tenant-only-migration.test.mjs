import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const directory = new URL("../packages/db/migrations/", import.meta.url);
const baselineFiles = ["0001_initial.sql", "0002_bootstrap.sql"];

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const file of baselineFiles)
    db.exec(readFileSync(new URL(file, directory), "utf8"));
  return db;
}

function seedTenant(db, id) {
  db.prepare(
    "INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at,kind) VALUES(?,?,?,1,'now','now','commercial')",
  ).run(id, `tenant-${id}`, `Tenant ${id}`);
}

test("baseline keeps the platform namespace and tenant-owned rows in separate scopes", () => {
  const db = fixture();
  try {
    assert.equal(
      db.prepare("SELECT kind FROM tenants WHERE id=0").get().kind,
      "platform",
    );
    assert.equal(
      db
        .prepare(
          "SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key='domain:platform'",
        )
        .get().tenant_id,
      0,
    );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='studio_data_domains'",
        )
        .get().n,
      0,
    );

    seedTenant(db, 101);
    seedTenant(db, 202);
    db.exec(`
      INSERT INTO studio_objects(tenant_id,name,label,config) VALUES
        ('tenant:0','items','Platform items','{}'),
        ('tenant:101','items','Tenant 101 items','{}'),
        ('tenant:202','items','Tenant 202 items','{}');
      INSERT INTO studio_records(tenant_id,id,object_name,data) VALUES
        ('tenant:0','same-id','items','{"name":"platform"}'),
        ('tenant:101','same-id','items','{"name":"tenant 101"}'),
        ('tenant:202','same-id','items','{"name":"tenant 202"}');
      INSERT INTO studio_geocoding_settings(tenant_id,encrypted_geoapify_key) VALUES
        ('tenant:101','ciphertext-101'),('tenant:202','ciphertext-202');
    `);

    assert.deepEqual(
      db
        .prepare(
          "SELECT tenant_id,data FROM studio_records WHERE id='same-id' ORDER BY tenant_id",
        )
        .all()
        .map((row) => ({ ...row })),
      [
        { tenant_id: "tenant:0", data: '{"name":"platform"}' },
        { tenant_id: "tenant:101", data: '{"name":"tenant 101"}' },
        { tenant_id: "tenant:202", data: '{"name":"tenant 202"}' },
      ],
    );
    assert.deepEqual(
      db
        .prepare(
          "SELECT tenant_id,encrypted_geoapify_key FROM studio_geocoding_settings ORDER BY tenant_id",
        )
        .all()
        .map((row) => ({ ...row })),
      [
        { tenant_id: "tenant:101", encrypted_geoapify_key: "ciphertext-101" },
        { tenant_id: "tenant:202", encrypted_geoapify_key: "ciphertext-202" },
      ],
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
});
