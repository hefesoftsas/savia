import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

const migrations = new URL("../packages/db/migrations/", import.meta.url);
const target = "0046_tenant_user_invariant.sql";

for (const partial of [0, 34, 203]) {
  test(`migration runner preserves solution references (${partial ? `resume after statement ${partial}` : "fresh migration"})`, () => {
    const dir = mkdtempSync(join(tmpdir(), "savia-migrations-"));
    const dbPath = join(dir, "domain.sqlite");
    const db = new DatabaseSync(dbPath);
    try {
      db.exec(
        "PRAGMA foreign_keys=ON; CREATE TABLE _savia_migrations (filename TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
      );
      for (const file of readdirSync(migrations)
        .filter((name) => name.endsWith(".sql"))
        .sort()) {
        if (file >= target) break;
        db.exec(readFileSync(new URL(file, migrations), "utf8"));
        db.prepare("INSERT INTO _savia_migrations VALUES (?, 'test')").run(
          file,
        );
      }
      db.exec(`
        INSERT INTO tenants (id,id_slug,name,is_active,created_at,updated_at)
        VALUES (101,'primary','Primary',1,'test','test'),(102,'source','Source',1,'test','test');
    INSERT INTO agencies (
      id,tenant_id,id_slug,created_at,updated_at,name,address,id_check_digit,id_number,
      lr_id_number,lr_id_type,lr_name,payments_email,is_active,email,is_in_house,email_domain,
      birthday_from_email,payment_from_email,renewal_from_email,home_url,short_name,
      seller_required,has_compliance,surnames,type,theme
    ) VALUES (
      102,102,'empty-source','2026-09-15','2026-09-15','Tenant sin usuarios','Calle 1','0','102',
      '102','NIT','Representante','pagos@source.test',1,'source@test.test',0,'source.test',
      'birthday@source.test','payment@source.test','renewal@source.test','https://source.test','source',
      0,0,'','agency','default'
    );
    INSERT INTO document_ownership (domain,collection,document_id,agency_id,created_at,updated_at)
    VALUES ('customer-portfolio','customer-profiles','source-document',102,'2026-09-15','2026-09-15');

        INSERT INTO crm_solution_installations (tenant_id,id,version,manifest)
        VALUES ('agency:102','source.solution','1.0.0','{}');
        INSERT INTO crm_solution_objects (tenant_id,solution_id,object_name,definition)
        VALUES ('agency:102','source.solution','contacts','{}');
      `);
      if (partial) {
        const sql = readFileSync(new URL(target, migrations), "utf8");
        for (const statement of sql
          .split("--> statement-breakpoint")
          // Reproduce the deployed version before the ownership fix.
          .filter(
            (statement) => !statement.includes("UPDATE document_ownership"),
          )
          .slice(0, partial))
          db.exec(statement);
      }
      const preload = join(dir, "d1.mjs");
      writeFileSync(
        preload,
        `
        import { DatabaseSync } from 'node:sqlite';
        const db = new DatabaseSync(${JSON.stringify(dbPath)});
        db.exec('PRAGMA foreign_keys=ON');
        globalThis.fetch = async (_url, options) => {
          try {
            const results = db.prepare(JSON.parse(options.body).sql).all();
            return Response.json({success:true,result:[{results}]});
          } catch (error) {
            return Response.json({success:false,errors:[{message:error.message}]},{status:400});
          }
        };
      `,
      );
      const run = () =>
        spawnSync(
          process.execPath,
          [
            "--import",
            preload,
            fileURLToPath(
              new URL("./apply-d1-migrations.mjs", import.meta.url),
            ),
          ],
          {
            env: {
              ...process.env,
              CLOUDFLARE_ACCOUNT_ID: "test",
              CLOUDFLARE_DATABASE_ID: "test",
              CLOUDFLARE_API_TOKEN: "test",
            },
            encoding: "utf8",
          },
        );
      const result = run();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(
        db
          .prepare(
            "SELECT tenant_id FROM crm_solution_installations WHERE id='source.solution'",
          )
          .get().tenant_id,
        "agency:101",
      );
      assert.equal(
        db
          .prepare(
            "SELECT tenant_id FROM crm_solution_objects WHERE solution_id='source.solution'",
          )
          .get().tenant_id,
        "agency:101",
      );
      assert.equal(
        db
          .prepare(
            "SELECT agency_id FROM document_ownership WHERE document_id='source-document'",
          )
          .get().agency_id,
        101,
      );
      assert.equal(
        db.prepare("SELECT count(*) AS count FROM agencies WHERE id=102").get()
          .count,
        0,
      );
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
      assert.ok(
        db
          .prepare("SELECT filename FROM _savia_migrations WHERE filename=?")
          .get(target),
      );
      const again = run();
      assert.equal(again.status, 0, again.stderr);
      assert.match(again.stdout, /D1 schema is up to date/);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

for (const [partial, mismatch] of [
  [22, false],
  [23, false],
  [22, true],
]) {
  test(`ACL migration recovery preserves grants (${partial} statements, mismatch=${mismatch})`, () => {
    const dir = mkdtempSync(join(tmpdir(), "savia-acl-recovery-"));
    const dbPath = join(dir, "domain.sqlite");
    const db = new DatabaseSync(dbPath);
    const acl = "0055_access_control.sql";
    try {
      db.exec(
        "PRAGMA foreign_keys=ON; CREATE TABLE _savia_migrations(filename TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
      );
      for (const file of readdirSync(migrations)
        .filter((name) => name.endsWith(".sql"))
        .sort()) {
        if (file >= acl) break;
        db.exec(readFileSync(new URL(file, migrations), "utf8"));
        db.prepare("INSERT INTO _savia_migrations VALUES (?, 'test')").run(
          file,
        );
      }
      db.exec(
        "INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at) VALUES(101,'recovery','Recovery',1,'test','test')",
      );
      db.exec(
        "INSERT INTO identity_principal(id,issuer,subject,email,display_name,created_at,updated_at) VALUES('actor','test','actor','actor@test','Actor','test','test'); INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,created_at,updated_at) VALUES('member','actor',101,'viewer','test','test')",
      );
      const statements = readFileSync(new URL(acl, migrations), "utf8").split(
        "--> statement-breakpoint",
      );
      for (const statement of statements.slice(0, partial)) db.exec(statement);
      db.exec(
        "UPDATE access_roles SET label='Customized label' WHERE scope='tenant:101' AND name='viewer'; UPDATE access_revisions SET revision=7 WHERE scope='tenant:101'; INSERT INTO access_grants(id,scope,role_id,resource,action,predicate,fields) VALUES('saved','tenant:101','builtin:tenant:101:viewer','collection:contacts','read','{}','[\"name\"]')",
      );
      db.exec(
        "DELETE FROM access_assignments WHERE principal_id='actor'; INSERT INTO access_roles(id,scope,name,label) VALUES('custom','tenant:101','custom','Custom'); INSERT INTO access_assignments(scope,principal_id,role_id) VALUES('tenant:101','actor','custom')",
      );
      if (mismatch)
        db.exec("ALTER TABLE access_roles ADD COLUMN unexpected TEXT");
      const preload = join(dir, "d1.mjs");
      writeFileSync(
        preload,
        `import {DatabaseSync} from 'node:sqlite';
        const db = new DatabaseSync(${JSON.stringify(dbPath)}); db.exec('PRAGMA foreign_keys=ON');
        globalThis.fetch = async (_url, options) => { try { const results = db.prepare(JSON.parse(options.body).sql).all(); return Response.json({success:true,result:[{results}]}); } catch(error) { return Response.json({success:false,errors:[{message:error.message}]},{status:400}); } };`,
      );
      const run = () =>
        spawnSync(
          process.execPath,
          [
            "--import",
            preload,
            fileURLToPath(
              new URL("./apply-d1-migrations.mjs", import.meta.url),
            ),
          ],
          {
            env: {
              ...process.env,
              CLOUDFLARE_ACCOUNT_ID: "test",
              CLOUDFLARE_DATABASE_ID: "test",
              CLOUDFLARE_API_TOKEN: "test",
            },
            encoding: "utf8",
          },
        );
      const result = run();
      if (mismatch) {
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Unexpected access_roles schema/);
        assert.equal(
          db
            .prepare("SELECT filename FROM _savia_migrations WHERE filename=?")
            .get(acl),
          undefined,
        );
      } else {
        assert.equal(result.status, 0, result.stderr);
        assert.equal(
          db
            .prepare(
              "SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name IN ('access_object_changed','access_object_removed')",
            )
            .get().n,
          2,
        );
        assert.equal(run().status, 0);
      }
      assert.equal(
        db
          .prepare(
            "SELECT label FROM access_roles WHERE scope='tenant:101' AND name='viewer'",
          )
          .get().label,
        "Customized label",
      );
      assert.equal(
        db
          .prepare("SELECT count(*) AS n FROM access_grants WHERE id='saved'")
          .get().n,
        1,
      );
      assert.equal(
        db
          .prepare(
            "SELECT revision FROM access_revisions WHERE scope='tenant:101'",
          )
          .get().revision,
        7,
      );
      assert.deepEqual(
        db
          .prepare(
            "SELECT role_id FROM access_assignments WHERE principal_id='actor' ORDER BY role_id",
          )
          .all()
          .map((row) => row.role_id),
        ["custom"],
      );
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("0063 migration recovery handles interrupted deployment and preserves relationships", () => {
  const dir = mkdtempSync(join(tmpdir(), "savia-0063-recovery-"));
  const dbPath = join(dir, "domain.sqlite");
  const db = new DatabaseSync(dbPath);
  const targetMigration = "0063_tenant_crm_and_assistant_tables.sql";
  try {
    db.exec(
      "PRAGMA foreign_keys=ON; CREATE TABLE _savia_migrations(filename TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
    );
    for (const file of readdirSync(migrations)
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      if (file >= targetMigration) break;
      db.exec(readFileSync(new URL(file, migrations), "utf8"));
      db.prepare("INSERT INTO _savia_migrations VALUES (?, 'test')").run(file);
    }
    db.exec(`
      INSERT INTO tenants(id, id_slug, name, is_active, created_at, updated_at)
      VALUES (1, 't1', 'Tenant 1', 1, 'test', 'test');

      INSERT INTO identity_principal(id, issuer, subject, email, display_name, created_at, updated_at)
      VALUES ('p1', 'iss', 'sub', 'p1@test', 'Principal 1', 'test', 'test');

      INSERT INTO agency_crm_connections (
        id, agency_id, created_by_principal_id, provider,
        nango_connection_id, nango_integration_id, status,
        created_at, updated_at
      ) VALUES (
        'conn1', 1, 'p1', 'hubspot', 'n1', 'i1', 'connected', 'test', 'test'
      );

      INSERT INTO agency_crm_connection_audit_events (
        id, connection_id, agency_id, principal_id, provider,
        event_type, outcome, created_at
      ) VALUES (
        'audit1', 'conn1', 1, 'p1', 'hubspot', 'auth', 'ok', 'test'
      );

      INSERT INTO crm_sync_rules (
        id, principal_id, tenant_id, provider, connection_id,
        external_account_id, account_label
      ) VALUES (
        'rule1', 'p1', 1, 'hubspot', 'conn1', 'ext1', 'Label'
      );

      INSERT INTO crm_sync_jobs (id, rule_id, customer_id)
      VALUES ('job1', 'rule1', 100);

      INSERT INTO assistant_active_agencies (principal_id, agency_id, updated_at)
      VALUES ('p1', 1, 'test');

      -- Simulate interrupted preview state where tenant_crm_connections already exists
      CREATE TABLE tenant_crm_connections (id TEXT PRIMARY KEY, tenant_id BIGINT);
      INSERT INTO tenant_crm_connections VALUES ('conn1', 1);
    `);

    const preload = join(dir, "d1.mjs");
    writeFileSync(
      preload,
      `import {DatabaseSync} from 'node:sqlite';
      const db = new DatabaseSync(${JSON.stringify(dbPath)}); db.exec('PRAGMA foreign_keys=ON');
      globalThis.fetch = async (_url, options) => {
        try {
          const results = db.prepare(JSON.parse(options.body).sql).all();
          return Response.json({success:true,result:[{results}]});
        } catch(error) {
          return Response.json({success:false,errors:[{message:error.message}]},{status:400});
        }
      };`,
    );
    const run = () =>
      spawnSync(
        process.execPath,
        [
          "--import",
          preload,
          fileURLToPath(new URL("./apply-d1-migrations.mjs", import.meta.url)),
        ],
        {
          env: {
            ...process.env,
            CLOUDFLARE_ACCOUNT_ID: "test",
            CLOUDFLARE_DATABASE_ID: "test",
            CLOUDFLARE_API_TOKEN: "test",
          },
          encoding: "utf8",
        },
      );

    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);

    assert.equal(
      db.prepare("SELECT type FROM sqlite_master WHERE name='tenant_crm_connections'").get().type,
      "table",
    );
    assert.equal(
      db.prepare("SELECT type FROM sqlite_master WHERE name='agency_crm_connections'").get().type,
      "view",
    );
    assert.equal(
      db.prepare("SELECT count(*) c FROM tenant_crm_connections WHERE id='conn1'").get().c,
      1,
    );
    assert.equal(
      db.prepare("SELECT count(*) c FROM agency_crm_connections WHERE id='conn1'").get().c,
      1,
    );
    assert.equal(
      db.prepare("SELECT count(*) c FROM assistant_active_tenants WHERE principal_id='p1'").get().c,
      1,
    );
    assert.equal(
      db.prepare("SELECT count(*) c FROM assistant_active_agencies WHERE principal_id='p1'").get().c,
      1,
    );
    assert.ok(
      db.prepare("SELECT filename FROM _savia_migrations WHERE filename=?").get(targetMigration),
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

