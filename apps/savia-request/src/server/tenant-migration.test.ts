import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const migrations = [
  "0001.sql",
  "0002.sql",
  "0003_insurance_bundles.sql",
  "0004_tenant_scope.sql",
  "0005_bundle_flow_state.sql",
  "0006_audit.sql",
];
const tenantMigration = readFileSync(
  new URL("../../migrations/0007_tenant_only_isolation.sql", import.meta.url),
  "utf8",
);

function database() {
  const db = new DatabaseSync(":memory:");
  for (const migration of migrations)
    db.exec(
      readFileSync(
        new URL(`../../migrations/${migration}`, import.meta.url),
        "utf8",
      ),
    );
  return db;
}

function applyTenantMigration(db: DatabaseSync) {
  db.exec("BEGIN");
  try {
    for (const statement of tenantMigration.split("--> statement-breakpoint"))
      if (statement.trim()) db.exec(statement);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

it("converts request-store scopes while preserving row contents and the global catalog", () => {
  const db = database();
  try {
    db.exec(
      "CREATE TABLE tenant_namespace_migrations(old_key TEXT PRIMARY KEY, tenant_id BIGINT NOT NULL); INSERT INTO tenant_namespace_migrations VALUES ('domain:research',303)",
    );
    db.exec(`
      INSERT INTO tenant_flows VALUES ('agency:101','agency-flow','{"id":"agency-flow"}','now');
      INSERT INTO tenant_flows VALUES ('domain:research','domain-flow','{"id":"domain-flow"}','now');
      INSERT INTO tenant_flow_variables VALUES ('agency:101','agency-flow','token','sealed-credential',1,'now');
      INSERT INTO tenant_flow_versions VALUES ('version-1','domain:research','domain-flow','{}','now');
      INSERT INTO tenant_flow_runs VALUES ('run-1','agency:101','agency-flow',NULL,'live','done','now','{}');
      INSERT INTO tenant_folders VALUES ('agency:101','/agency');
      INSERT INTO tenant_folders VALUES ('agency:0','/platform');
      INSERT INTO tenant_bundles VALUES ('domain:research','bundle','1.0.0','now');
      INSERT INTO bundle_flow_state VALUES ('domain:research','domain-flow','1.0.0','hash','now');
      INSERT INTO bundle_flow_state VALUES ('','shared-flow','1.0.0','shared-hash','now');
      INSERT INTO savia_request_audit VALUES ('audit-1','agency:101','principal','updated','agency-flow','{}','now');
    `);

    applyTenantMigration(db);

    expect(
      db
        .prepare(
          "SELECT tenant_id,flow_id,definition FROM tenant_flows ORDER BY flow_id",
        )
        .all(),
    ).toEqual([
      {
        tenant_id: "tenant:101",
        flow_id: "agency-flow",
        definition: '{"id":"agency-flow"}',
      },
      {
        tenant_id: "tenant:303",
        flow_id: "domain-flow",
        definition: '{"id":"domain-flow"}',
      },
    ]);
    expect(
      db.prepare("SELECT value,secret FROM tenant_flow_variables").get(),
    ).toEqual({
      value: "sealed-credential",
      secret: 1,
    });
    expect(
      db
        .prepare("SELECT scope,flow_id FROM bundle_flow_state ORDER BY scope")
        .all(),
    ).toEqual([
      { scope: "", flow_id: "shared-flow" },
      { scope: "tenant:303", flow_id: "domain-flow" },
    ]);
    expect(
      db.prepare("SELECT tenant_id FROM tenant_flow_versions").get(),
    ).toEqual({
      tenant_id: "tenant:303",
    });
    expect(db.prepare("SELECT tenant_id FROM tenant_flow_runs").get()).toEqual({
      tenant_id: "tenant:101",
    });
    expect(
      db
        .prepare("SELECT tenant_id,path FROM tenant_folders ORDER BY path")
        .all(),
    ).toEqual([
      { tenant_id: "tenant:101", path: "/agency" },
      { tenant_id: "tenant:0", path: "/platform" },
    ]);
    expect(db.prepare("SELECT tenant_id FROM tenant_bundles").get()).toEqual({
      tenant_id: "tenant:303",
    });
    expect(
      db.prepare("SELECT tenant_id FROM savia_request_audit").get(),
    ).toEqual({
      tenant_id: "tenant:101",
    });
    expect(
      db
        .prepare(
          "SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key='domain:platform'",
        )
        .get(),
    ).toEqual({ tenant_id: 0 });
  } finally {
    db.close();
  }
});

it("rejects a canonical tenant-key collision without partially changing rows", () => {
  const db = database();
  try {
    db.exec(
      "INSERT INTO tenant_flows VALUES ('agency:101','same-flow','{}','now'),('tenant:101','same-flow','{}','now')",
    );
    expect(() => applyTenantMigration(db)).toThrow(
      /tenant_namespace_collision/,
    );
    expect(
      db.prepare("SELECT tenant_id FROM tenant_flows ORDER BY tenant_id").all(),
    ).toEqual([{ tenant_id: "agency:101" }, { tenant_id: "tenant:101" }]);
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='tenant_namespace_migrations'",
        )
        .get(),
    ).toBeUndefined();
  } finally {
    db.close();
  }
});

it("rejects unmapped domain keys and unsafe agency identifiers", () => {
  const db = database();
  try {
    db.exec(
      "INSERT INTO tenant_flows VALUES ('domain:missing','orphan','{}','now')",
    );
    expect(() => applyTenantMigration(db)).toThrow(/tenant_namespace_unmapped/);
    db.exec("DELETE FROM tenant_flows");
    db.exec(
      "CREATE TABLE tenant_namespace_migrations(old_key TEXT PRIMARY KEY, tenant_id BIGINT NOT NULL); INSERT INTO tenant_namespace_migrations VALUES ('agency:9007199254740992',9007199254740992)",
    );
    db.exec(
      "INSERT INTO tenant_flows VALUES ('agency:9007199254740992','unsafe','{}','now')",
    );
    expect(() => applyTenantMigration(db)).toThrow(/tenant_namespace_invalid/);
    expect(db.prepare("SELECT tenant_id FROM tenant_flows").get()).toEqual({
      tenant_id: "agency:9007199254740992",
    });
  } finally {
    db.close();
  }
});
