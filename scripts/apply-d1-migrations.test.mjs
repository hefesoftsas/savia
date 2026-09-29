import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "savia-initial-"));
  const file = join(dir, "db.sqlite");
  const shim = join(dir, "fetch.mjs");
  writeFileSync(
    shim,
    `import {DatabaseSync} from 'node:sqlite';
const db=new DatabaseSync(${JSON.stringify(file)});db.exec('PRAGMA foreign_keys=ON');
globalThis.fetch=async (_url,options)=>{const {sql,batch}=JSON.parse(options.body);try{if(batch)db.exec('BEGIN');const result=(batch?batch.map(s=>s.sql):[sql]).map(s=>{if(process.env.FAIL_INITIAL==='1'&&s.includes('CREATE TRIGGER'))throw Error('injected');return {results:db.prepare(s).all(),success:true};});if(batch)db.exec('COMMIT');return {ok:true,json:async()=>({success:true,result})};}catch(e){if(db.isTransaction)db.exec('ROLLBACK');return {ok:false,status:400,json:async()=>({success:false,errors:[{message:e.message}]})};}};`,
  );
  return {
    file,
    close: () => rmSync(dir, { recursive: true, force: true }),
    run: (extra = {}) =>
      spawnSync(
        process.execPath,
        ["--import", shim, "scripts/apply-d1-migrations.mjs"],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            CLOUDFLARE_ACCOUNT_ID: "test",
            CLOUDFLARE_DATABASE_ID: "test",
            CLOUDFLARE_API_TOKEN: "test",
            ...extra,
          },
        },
      ),
  };
}

test("initial D1 schema and bootstrap apply once with intact triggers", () => {
  const f = fixture();
  try {
    const first = f.run();
    assert.equal(first.status, 0, first.stderr);
    const db = new DatabaseSync(f.file);
    assert.equal(
      db.prepare("SELECT count(*) n FROM _savia_migrations").get().n,
      2,
    );
    assert.ok(
      db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE name='studio_record_summary_update'",
        )
        .get() ||
        db
          .prepare("SELECT count(*) n FROM sqlite_master WHERE type='trigger'")
          .get().n > 60,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.exec("UPDATE tenants SET name='Preserved' WHERE id=0");
    db.close();
    const second = f.run();
    assert.equal(second.status, 0, second.stderr);
    const after = new DatabaseSync(f.file);
    assert.equal(
      after.prepare("SELECT name FROM tenants WHERE id=0").get().name,
      "Preserved",
    );
    after.close();
  } finally {
    f.close();
  }
});

test("a failing schema batch rolls back and can be retried", () => {
  const f = fixture();
  try {
    assert.notEqual(f.run({ FAIL_INITIAL: "1" }).status, 0);
    const db = new DatabaseSync(f.file);
    assert.equal(
      db
        .prepare("SELECT count(*) n FROM sqlite_master WHERE name='tenants'")
        .get().n,
      0,
    );
    assert.equal(
      db.prepare("SELECT count(*) n FROM _savia_migrations").get().n,
      0,
    );
    db.close();
    const retry = f.run();
    assert.equal(retry.status, 0, retry.stderr);
  } finally {
    f.close();
  }
});

test("retired history is rejected before changing application data", () => {
  const f = fixture();
  try {
    const db = new DatabaseSync(f.file);
    db.exec(
      "CREATE TABLE _savia_migrations(filename TEXT PRIMARY KEY,applied_at TEXT);INSERT INTO _savia_migrations VALUES('retired.sql','now');CREATE TABLE retained(value TEXT);INSERT INTO retained VALUES('keep');",
    );
    db.close();
    const run = f.run();
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /retired migration history/);
    const after = new DatabaseSync(f.file);
    assert.equal(
      after.prepare("SELECT value FROM retained").get().value,
      "keep",
    );
    after.close();
  } finally {
    f.close();
  }
});
