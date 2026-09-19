import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { openSqliteDatabase } from "../src/sqlite.ts";

function fixture(t: { onTestFinished(fn: () => void): void }) {
  const directory = mkdtempSync(join(tmpdir(), "savia-sqlite-"));
  t.onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("D1 bindings, first/raw/all/run and persistent reopen", async (t) => {
  const path = join(fixture(t), "db.sqlite");
  let db = openSqliteDatabase(path);
  await db.exec(
    "CREATE TABLE item(id INTEGER PRIMARY KEY, label TEXT, payload BLOB)",
  );
  const insert = db.prepare("INSERT INTO item(label,payload) VALUES (?,?)");
  const first = await insert.bind("one", new Uint8Array([1, 2])).run();
  assert.equal(first.success, true);
  assert.equal(first.meta.changes, 1);
  assert.equal(first.meta.last_row_id, 1);
  await insert.bind("two", null).run();
  assert.equal(
    await db
      .prepare("SELECT label FROM item WHERE id=?")
      .bind(1)
      .first("label"),
    "one",
  );
  assert.equal(
    await db.prepare("SELECT label FROM item WHERE id=9").first(),
    null,
  );
  assert.deepEqual(
    await db.prepare("SELECT id,label FROM item ORDER BY id").raw(),
    [
      [1, "one"],
      [2, "two"],
    ],
  );
  assert.deepEqual(
    await db
      .prepare("SELECT id,label FROM item WHERE id=1")
      .raw({ columnNames: true }),
    [
      ["id", "label"],
      [1, "one"],
    ],
  );
  assert.deepEqual(
    (await db.prepare("SELECT payload FROM item WHERE id=1").first())?.payload,
    [1, 2],
  );
  await assert.rejects(
    db.prepare("SELECT id FROM item").first("missing"),
    /column/i,
  );
  db.close();
  db = openSqliteDatabase(path);
  t.onTestFinished(() => db.close());
  assert.deepEqual(
    (await db.prepare("SELECT label FROM item ORDER BY id").all()).results,
    [{ label: "one" }, { label: "two" }],
  );
});

test("atomic batches preserve trigger and changes() guard semantics", async (t) => {
  const db = openSqliteDatabase(join(fixture(t), "db.sqlite"));
  t.onTestFinished(() => db.close());
  await db.exec(`CREATE TABLE item(id TEXT PRIMARY KEY, version INTEGER NOT NULL);
    CREATE TABLE history(id TEXT, version INTEGER);
    CREATE TABLE guard(valid INTEGER CHECK(valid=1));
    CREATE TRIGGER audit AFTER INSERT ON item BEGIN
      INSERT INTO history VALUES(NEW.id, NEW.version);
    END;`);
  const results = await db.batch([
    db.prepare("INSERT INTO item VALUES (?,?)").bind("one", 1),
    db.prepare("INSERT INTO guard VALUES(changes()=1)"),
    db.prepare("SELECT * FROM history"),
  ]);
  assert.equal(results[0].meta.changes, 1);
  assert.deepEqual(results[2].results, [{ id: "one", version: 1 }]);
  await assert.rejects(
    db.batch([
      db.prepare("INSERT INTO item VALUES ('two',1)"),
      db.prepare("UPDATE item SET version=2 WHERE id='missing'"),
      db.prepare("INSERT INTO guard VALUES(changes()=1)"),
    ]),
    /CHECK/,
  );
  assert.equal(
    await db.prepare("SELECT count(*) AS n FROM item").first("n"),
    1,
  );
  assert.equal(
    await db.prepare("SELECT count(*) AS n FROM history").first("n"),
    1,
  );
  await assert.rejects(
    db.exec(
      "INSERT INTO item VALUES('three',1); INSERT INTO item VALUES('one',1)",
    ),
    /UNIQUE/,
  );
  assert.equal(
    await db.prepare("SELECT count(*) AS n FROM item").first("n"),
    1,
  );
});

test("migrations run complete trigger bodies, are idempotent and verify migration integrity", async (t) => {
  const directory = fixture(t);
  const db = openSqliteDatabase(join(directory, "db.sqlite"));
  t.onTestFinished(() => db.close());
  writeFileSync(
    join(directory, "0001.sql"),
    "CREATE TABLE item(id INTEGER PRIMARY KEY); CREATE TABLE log(id INTEGER);",
  );
  writeFileSync(
    join(directory, "0002.sql"),
    "CREATE TRIGGER audit AFTER INSERT ON item BEGIN INSERT INTO log VALUES(NEW.id); INSERT INTO log VALUES(NEW.id+1); END; INSERT INTO item VALUES(1);",
  );
  assert.deepEqual(await db.migrate(directory), ["0001.sql", "0002.sql"]);
  assert.deepEqual(await db.migrate(directory), []);
  assert.equal(await db.prepare("SELECT count(*) AS n FROM log").first("n"), 2);
  writeFileSync(join(directory, "0000.sql"), "SELECT 1;");
  assert.deepEqual(await db.migrate(directory), ["0000.sql"]);
  assert.deepEqual(await db.migrate(directory), []);
  assert.equal(await db.prepare("SELECT count(*) AS n FROM log").first("n"), 2);
  rmSync(join(directory, "0000.sql"));
  await assert.rejects(db.migrate(directory), /missing|history/i);
  writeFileSync(join(directory, "0000.sql"), "SELECT 1;");
  writeFileSync(
    join(directory, "0001.sql"),
    "CREATE TABLE changed(id INTEGER);",
  );
  await assert.rejects(db.migrate(directory), /checksum|changed/i);
});

test("failed migrations roll back schema and data and may be corrected", async (t) => {
  const directory = fixture(t);
  const db = openSqliteDatabase(join(directory, "db.sqlite"));
  t.onTestFinished(() => db.close());
  writeFileSync(
    join(directory, "0001.sql"),
    "CREATE TABLE broken(id INTEGER); INSERT INTO absent VALUES(1);",
  );
  await assert.rejects(db.migrate(directory), /absent/);
  assert.equal(
    await db
      .prepare("SELECT name FROM sqlite_master WHERE name='broken'")
      .first(),
    null,
  );
  writeFileSync(
    join(directory, "0001.sql"),
    "CREATE TABLE broken(id INTEGER); INSERT INTO broken VALUES(1);",
  );
  assert.deepEqual(await db.migrate(directory), ["0001.sql"]);
  assert.equal(await db.prepare("SELECT id FROM broken").first("id"), 1);
});

test("local D1 sessions share committed state and reject foreign database statements", async (t) => {
  const db = openSqliteDatabase(":memory:");
  const other = openSqliteDatabase(":memory:");
  t.onTestFinished(() => {
    db.close();
    other.close();
  });
  const session = db.withSession("first-primary");
  await db.exec("CREATE TABLE item(id INTEGER)");
  await session.batch([session.prepare("INSERT INTO item VALUES(1)")]);
  assert.equal(
    await db.withSession().prepare("SELECT id FROM item").first("id"),
    1,
  );
  await assert.rejects(
    db.batch([other.prepare("SELECT 1")]),
    /another database/,
  );
});

test("all production migration scripts apply and reopen without replaying seeds", async (t) => {
  const path = join(fixture(t), "db.sqlite");
  let db = openSqliteDatabase(path);
  const migrations = new URL(
    "../../../packages/db/migrations/",
    import.meta.url,
  ).pathname;
  const applied = await db.migrate(decodeURIComponent(migrations));
  assert.ok(applied.includes("0057_record_history.sql"));
  assert.ok(
    await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND name='crm_sync_insert'",
      )
      .first(),
  );
  assert.equal(
    await db.prepare("PRAGMA foreign_keys").first("foreign_keys"),
    1,
  );
  db.close();
  db = openSqliteDatabase(path);
  t.onTestFinished(() => db.close());
  assert.deepEqual(await db.migrate(decodeURIComponent(migrations)), []);
});

test("trigger-initiated rollback preserves the original failure and connection reuse", async (t) => {
  const db = openSqliteDatabase(":memory:");
  t.onTestFinished(() => db.close());
  await db.exec(`CREATE TABLE item(id INTEGER);
    CREATE TRIGGER reject BEFORE INSERT ON item WHEN NEW.id=2 BEGIN
      SELECT RAISE(ROLLBACK,'business-rule-rejected');
    END;`);
  await assert.rejects(
    db.batch([
      db.prepare("INSERT INTO item VALUES(1)"),
      db.prepare("INSERT INTO item VALUES(2)"),
    ]),
    /business-rule-rejected/,
  );
  assert.equal(
    await db.prepare("SELECT COUNT(*) AS n FROM item").first("n"),
    0,
  );
  await db.prepare("INSERT INTO item VALUES(3)").run();
  assert.equal(await db.prepare("SELECT id FROM item").first("id"), 3);
});
