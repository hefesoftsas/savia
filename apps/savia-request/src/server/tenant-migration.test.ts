import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const baselineFiles = ["0001_initial.sql", "0002_bootstrap.sql"];

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const migration of baselineFiles)
    db.exec(
      readFileSync(
        new URL(`../../migrations/${migration}`, import.meta.url),
        "utf8",
      ),
    );
  return db;
}

it("baseline keeps global defaults and tenant secret overrides in distinct scopes", () => {
  const db = database();
  try {
    expect(
      db
        .prepare(
          "SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key='domain:platform'",
        )
        .get(),
    ).toEqual({ tenant_id: 0 });

    db.exec(`
      INSERT INTO flows(id,definition) VALUES('flow','{"id":"flow"}');
      INSERT INTO flow_variables(flow_id,key,value,secret) VALUES('flow','provider_token','global-ciphertext',1);
      INSERT INTO tenant_flows(tenant_id,flow_id,definition,updated_at) VALUES
        ('tenant:101','flow','{"id":"flow","tenant":101}','now'),
        ('tenant:202','flow','{"id":"flow","tenant":202}','now');
      INSERT INTO tenant_flow_variables(tenant_id,flow_id,key,value,secret,updated_at) VALUES
        ('tenant:101','flow','provider_token','tenant-101-ciphertext',1,'now'),
        ('tenant:202','flow','provider_token','tenant-202-ciphertext',1,'now');
      INSERT INTO tenant_flow_versions(id,tenant_id,flow_id,definition,created_at) VALUES
        ('version-101','tenant:101','flow','{}','now'),
        ('version-202','tenant:202','flow','{}','now');
    `);

    expect(
      db
        .prepare(
          "SELECT tenant_id,value,secret FROM tenant_flow_variables WHERE flow_id='flow' ORDER BY tenant_id",
        )
        .all(),
    ).toEqual([
      { tenant_id: "tenant:101", value: "tenant-101-ciphertext", secret: 1 },
      { tenant_id: "tenant:202", value: "tenant-202-ciphertext", secret: 1 },
    ]);
    expect(
      db.prepare("SELECT value FROM flow_variables WHERE flow_id='flow'").get(),
    ).toEqual({ value: "global-ciphertext" });
    expect(
      db
        .prepare("SELECT id,tenant_id FROM tenant_flow_versions ORDER BY id")
        .all(),
    ).toEqual([
      { id: "version-101", tenant_id: "tenant:101" },
      { id: "version-202", tenant_id: "tenant:202" },
    ]);
  } finally {
    db.close();
  }
});
