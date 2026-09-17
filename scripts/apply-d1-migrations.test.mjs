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
