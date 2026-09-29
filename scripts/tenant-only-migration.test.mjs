import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync, existsSync } from "node:fs";
const directory = new URL("../packages/db/migrations/", import.meta.url);
const migration = new URL("0077_tenant_only_isolation.sql", directory);
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync(directory)
    .filter((f) => f.endsWith(".sql") && f < "0077")
    .sort())
    db.exec(readFileSync(new URL(file, directory), "utf8"));
  return db;
}
function migrate(db) {
  db.exec("BEGIN");
  try {
    if (existsSync(migration)) db.exec(readFileSync(migration, "utf8"));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
test("migrates custom and platform data without changing opaque file references", () => {
  const db = fixture();
  try {
    db.exec(
      "INSERT INTO studio_data_domains(id,label,created_by) VALUES('research','Research','p'); INSERT INTO studio_objects(tenant_id,name,label,config) VALUES('domain:research','items','Items','{}'),('domain:platform','items','Items','{}')",
    );
    db.exec(
      "INSERT INTO studio_records(id,tenant_id,object_name,data) VALUES('r','domain:research','items','{\"name\":\"Preserved\"}'); INSERT INTO studio_files(id,tenant_id,object_name,record_id,name,mime,size,storage_key) VALUES('f','domain:research','items','r','a.txt','text/plain',1,'domain:research/files/f')",
    );
    migrate(db);
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) n FROM sqlite_master WHERE name='studio_data_domains'",
        )
        .get().n,
      0,
    );
    const tenant = db
      .prepare(
        "SELECT tenant_id FROM tenant_namespace_migrations WHERE old_key='domain:research'",
      )
      .get().tenant_id;
    assert.equal(
      db.prepare("SELECT tenant_id FROM studio_records WHERE id=?").get("r")
        .tenant_id,
      `tenant:${tenant}`,
    );
    assert.equal(
      db.prepare("SELECT storage_key FROM studio_files WHERE id=?").get("f")
        .storage_key,
      "domain:research/files/f",
    );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) n FROM studio_objects WHERE tenant_id='tenant:0'",
        )
        .get().n,
      1,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
});
test("rejects namespace collisions transactionally", () => {
  const db = fixture();
  try {
    db.exec(
      "INSERT INTO studio_objects(tenant_id,name,label,config) VALUES('domain:platform','items','Old','{}'),('tenant:0','items','New','{}')",
    );
    assert.throws(() => migrate(db), /tenant_namespace_collision/);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM studio_objects").get().n,
      2,
    );
    assert.ok(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='studio_data_domains'",
        )
        .get(),
    );
  } finally {
    db.close();
  }
});
test("rejects custom-domain grants that conflict with principal tenant membership", () => {
  const db = fixture();
  try {
    db.exec(
      "INSERT INTO identity_principal(id,issuer,subject,email,display_name,created_at,updated_at) VALUES('p','test','p','p@example.test','P','now','now'); INSERT INTO studio_data_domains(id,label,created_by) VALUES('private','Private','p'); INSERT INTO access_roles(id,scope,name,label) VALUES('r','domain:private','reader','Reader'); INSERT INTO access_assignments(scope,principal_id,role_id) VALUES('domain:private','p','r')",
    );
    assert.throws(() => migrate(db), /tenant_membership_conflict/);
    assert.equal(
      db
        .prepare("SELECT scope FROM access_assignments WHERE principal_id='p'")
        .get().scope,
      "domain:private",
    );
  } finally {
    db.close();
  }
});
test("preserves credential encryption metadata and canonicalizes widgets", () => {
  const db = fixture();
  try {
    db.exec(
      "INSERT INTO identity_principal(id,issuer,subject,email,display_name,created_at,updated_at) VALUES('p','test','p','p@example.test','P','now','now')",
    );
    db.exec(
      "INSERT INTO studio_geocoding_settings(tenant_id,encrypted_geoapify_key) VALUES('domain:platform','iv.ciphertext'); INSERT INTO studio_collection_sources(tenant_id,owner_principal_id,id,label,kind,config,encrypted_secret) VALUES('domain:platform','p','sql','SQL','postgres','{}','iv.secret'); INSERT INTO user_my_day_widgets(principal_id,layout,updated_at) VALUES('p','{\"version\":1,\"widgets\":[{\"apiBasePath\":\"/v1/data-domains/platform\"}]}','now')",
    );
    db.exec(
      'INSERT INTO user_navigation_preferences(principal_id,layout,updated_at) VALUES(\'p\',\'{"version":2,"blocks":[{"items":["page:platform:items"]}]}\',\'now\')',
    );
    migrate(db);
    assert.equal(
      JSON.parse(
        db.prepare("SELECT layout FROM user_navigation_preferences").get()
          .layout,
      ).blocks[0].items[0],
      "page:0:items",
    );
    const geo = JSON.parse(
      db
        .prepare(
          "SELECT encrypted_geoapify_key value FROM studio_geocoding_settings",
        )
        .get().value,
    );
    assert.deepEqual(geo, {
      version: 2,
      context: "tenant:0:geocoding",
      aad: "domain:platform:geocoding",
      value: "iv.ciphertext",
    });
    const source = JSON.parse(
      db
        .prepare("SELECT encrypted_secret value FROM studio_collection_sources")
        .get().value,
    );
    assert.equal(source.context, '["tenant:0","p"]:collection-source:sql');
    assert.equal(source.aad, '["domain:platform","p"]:collection-source:sql');
    assert.equal(
      JSON.parse(
        db.prepare("SELECT layout FROM user_my_day_widgets").get().layout,
      ).widgets[0].apiBasePath,
      "/v1/studio/0",
    );
  } finally {
    db.close();
  }
});

test("migrates workspace notification scope without rewriting account identities", () => {
  const db = fixture();
  try {
    db.exec(`INSERT INTO notification_events(id,scope_kind,scope_id,event_key,payload,created_at) VALUES
      ('workspace-event','workspace','domain:platform','event-w','{"scope":{"kind":"workspace","id":"domain:platform"}}',1),
      ('account-event','account','domain:platform','event-a','{"scope":{"kind":"account","id":"domain:platform"}}',1),
      ('other-account-event','account','tenant:0','event-a','{"scope":{"kind":"account","id":"tenant:0"}}',1)`);
    migrate(db);
    const workspace = db
      .prepare(
        "SELECT scope_id,payload FROM notification_events WHERE id='workspace-event'",
      )
      .get();
    assert.equal(workspace.scope_id, "tenant:0");
    assert.equal(JSON.parse(workspace.payload).scope.id, "tenant:0");
    assert.equal(
      db
        .prepare(
          "SELECT scope_id FROM notification_events WHERE id='account-event'",
        )
        .get().scope_id,
      "domain:platform",
    );
  } finally {
    db.close();
  }
});

test("preserves workflow webhook secrets and request bundle ownership", () => {
  const db = fixture();
  try {
    db.exec(
      "INSERT INTO workflow_webhook_destinations(workspace_id,id,name,current_revision,credential_type,encrypted_secret) VALUES('domain:platform','hook','Hook',1,'bearer','iv.secret'); INSERT INTO bundle_flow_state(scope,flow_id,bundle_version,content_hash,updated_at) VALUES('domain:platform','flow','v1','hash','now')",
    );
    migrate(db);
    const webhook = db
      .prepare(
        "SELECT workspace_id,encrypted_secret FROM workflow_webhook_destinations",
      )
      .get();
    assert.equal(webhook.workspace_id, "tenant:0");
    assert.deepEqual(JSON.parse(webhook.encrypted_secret), {
      version: 2,
      context: "workflow-webhook:tenant:0:hook",
      aad: "workflow-webhook:domain:platform:hook",
      value: "iv.secret",
    });
    assert.equal(
      db.prepare("SELECT scope FROM bundle_flow_state").get().scope,
      "tenant:0",
    );
  } finally {
    db.close();
  }
});
