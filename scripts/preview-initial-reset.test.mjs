import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import {
  buildPreviewInitialReset,
  fingerprint,
} from "./preview-initial-reset.mjs";
const initial = readFileSync(
  new URL("../packages/db/migrations/0001_initial.sql", import.meta.url),
  "utf8",
);
const bootstrap = readFileSync(
  new URL("../packages/db/migrations/0002_bootstrap.sql", import.meta.url),
  "utf8",
);
const seed = [
  "INSERT INTO identity_principal(id,issuer,subject,email,display_name,created_at,updated_at) VALUES('person','auth','subject','user@example.test','User','now','now')",
  "INSERT INTO assistant_openrouter_settings(id,scope,api_key_ciphertext,api_key_iv,updated_at,updated_by) VALUES('global','global','opaque-key','opaque-iv','now','person')",
  "INSERT INTO flow_variables(flow_id,key,value,secret) VALUES('flow','provider_password','opaque-password',1),('flow','request_body','example-data',0)",
  "INSERT INTO studio_objects(tenant_id,name,label,config) VALUES('tenant:0','items','Items','{}')",
  "INSERT INTO studio_records(tenant_id,id,object_name,data) VALUES('tenant:0','discard','items','{}')",
];
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec(initial);
  db.exec(bootstrap);
  for (const sql of seed) db.exec(sql);
  return db;
}
test("reset preserves credentials and users, removes records, and rolls back on failure", () => {
  const db = fixture();
  try {
    const plan = buildPreviewInitialReset(db, initial, bootstrap);
    db.exec("BEGIN");
    for (const s of plan.statements) db.prepare(s.sql).run(...s.params);
    db.exec("COMMIT");
    assert.equal(
      db.prepare("SELECT count(*) n FROM studio_records").get().n,
      0,
    );
    assert.equal(
      db.prepare("SELECT count(*) n FROM studio_objects").get().n,
      0,
    );
    for (const r of plan.retained)
      assert.equal(
        fingerprint(db.prepare(`SELECT * FROM "${r.table}"`).all()),
        r.fingerprint,
        r.table,
      );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    const retry = buildPreviewInitialReset(db, initial, bootstrap);
    db.exec("BEGIN");
    for (const s of retry.statements.slice(0, 12))
      db.prepare(s.sql).run(...s.params);
    assert.throws(() => db.exec("INSERT INTO missing_table VALUES(1)"));
    db.exec("ROLLBACK");
    assert.equal(
      db
        .prepare(
          "SELECT api_key_ciphertext FROM assistant_openrouter_settings WHERE id='global'",
        )
        .get().api_key_ciphertext,
      "opaque-key",
    );
  } finally {
    db.close();
  }
});
test("the reset executes as one actual Miniflare D1 batch", async () => {
  const require = createRequire(
    new URL("../apps/api/package.json", import.meta.url),
  );
  const { Miniflare, convertV4MiniflareOptions } = require(
    require.resolve("miniflare", {
      paths: [dirname(require.resolve("wrangler"))],
    }),
  );
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      d1Databases: { DB: "initial-reset-test" },
    }),
  );
  const source = fixture();
  try {
    const db = await mf.getD1Database("DB");
    const parts = [
      ...initial.split("--> statement-breakpoint"),
      ...bootstrap.split("--> statement-breakpoint"),
      ...seed,
    ].filter((s) => s.trim());
    await db.batch(parts.map((s) => db.prepare(s)));
    const plan = buildPreviewInitialReset(source, initial, bootstrap);
    await db.batch(
      plan.statements.map((s) => db.prepare(s.sql).bind(...s.params)),
    );
    assert.equal(
      await db.prepare("SELECT count(*) n FROM studio_records").first("n"),
      0,
    );
    assert.equal(
      await db.prepare("SELECT count(*) n FROM identity_principal").first("n"),
      1,
    );
    assert.equal(
      await db
        .prepare(
          "SELECT value FROM flow_variables WHERE key='provider_password'",
        )
        .first("value"),
      "opaque-password",
    );
    assert.deepEqual(
      (await db.prepare("PRAGMA foreign_key_check").all()).results,
      [],
    );
  } finally {
    source.close();
    await mf.dispose();
  }
});

test("concurrent credential changes abort before application tables are removed", () => {
  const db = fixture();
  try {
    const plan = buildPreviewInitialReset(db, initial, bootstrap);
    db.exec(
      "UPDATE assistant_openrouter_settings SET api_key_ciphertext='newer-key'",
    );
    db.exec("BEGIN");
    assert.throws(() => {
      for (const statement of plan.statements)
        db.prepare(statement.sql).run(...statement.params);
    }, /CHECK constraint failed/);
    db.exec("ROLLBACK");
    assert.equal(
      db.prepare("SELECT count(*) n FROM studio_records").get().n,
      1,
    );
    assert.equal(
      db
        .prepare(
          "SELECT api_key_ciphertext FROM assistant_openrouter_settings WHERE id='global'",
        )
        .get().api_key_ciphertext,
      "newer-key",
    );
  } finally {
    db.close();
  }
});
