import { beforeAll, afterAll, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import {
  historyDatabase,
  purgeExpiredRecordHistory,
} from "../src/record-history-storage";
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;
beforeAll(async () => {
  platform = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: false,
  });
  db = platform.env.DB;
  await db.exec(
    "CREATE TABLE studio_objects(tenant_id TEXT,name TEXT,config TEXT); CREATE TABLE studio_records(tenant_id TEXT,object_name TEXT,id TEXT,data TEXT,version INTEGER DEFAULT 1,deleted_at TEXT); CREATE TABLE fail_guard(valid INTEGER CHECK(valid=1));",
  );
  // Inline history DDL (mirrors migrations/0017_record_history.sql with studio_* names).
  const historyDdl = `CREATE TABLE studio_record_history (
 tenant_id TEXT NOT NULL, object_name TEXT NOT NULL, record_id TEXT NOT NULL,
 version INTEGER NOT NULL, action TEXT NOT NULL CHECK(action IN ('created','updated','deleted','restored')),
 created_at TEXT NOT NULL, actor_kind TEXT NOT NULL CHECK(actor_kind IN ('user','workflow','public-form','system')),
 actor_id TEXT, cause_id TEXT, changes TEXT NOT NULL CHECK(json_valid(changes)), expires_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,object_name,record_id,version)
);
CREATE INDEX studio_record_history_expiry ON studio_record_history(expires_at);
CREATE TABLE studio_record_history_context (
 tenant_id TEXT PRIMARY KEY, actor_kind TEXT NOT NULL, actor_id TEXT, cause_id TEXT
);

CREATE VIEW studio_record_history_fields AS
 SELECT o.tenant_id,o.name AS object_name,f.key AS field_name,
 MIN(365,MAX(1,COALESCE(CAST(json_extract(o.config,'$.studio.history.retentionDays') AS INTEGER),90))) AS retention_days
 FROM studio_objects o,json_each(o.config,'$.fields') f
 WHERE json_extract(o.config,'$.studio.history.enabled')=1
 AND json_type(o.config,'$.studio.collection') IS NULL
 AND COALESCE(json_extract(o.config,'$.studio.business'),'') NOT IN ('managed-customer','managed-agency')
 AND json_type(o.config,'$.studio.history.fields')='array'
 AND f.key IN (SELECT value FROM json_each(o.config,'$.studio.history.fields') WHERE type='text' AND key<50)
 AND f.key NOT GLOB '*[^A-Za-z0-9_]*' AND f.key NOT LIKE '\\_%' ESCAPE '\\'
 AND f.key NOT IN ('id','created_at','updated_at','deleted_at','created_by','updated_by','createdAt','updatedAt','deletedAt','createdBy','updatedBy','constructor','prototype')
 AND json_extract(f.value,'$.type') IN ('Textbox','Textarea','Email','Phone','Url','Address','Number','Currency','Dropdown','Autocomplete','Toggle','DateControl')
 AND COALESCE(json_extract(f.value,'$.hidden'),0)=0
 AND COALESCE(json_extract(f.value,'$.readOnly'),0)=0
 AND COALESCE(json_extract(f.value,'$.config.sensitive'),0)=0
 AND COALESCE(json_extract(f.value,'$.config.readable'),1)<>0
 AND COALESCE(json_extract(f.value,'$.readable'),1)<>0
 AND COALESCE(json_extract(f.value,'$.config.multiple'),0)=0
 AND json_extract(f.value,'$.config.formula') IS NULL
 AND json_extract(f.value,'$.config.relation') IS NULL
 AND json_extract(f.value,'$.config.collectionRelation') IS NULL
 AND json_extract(f.value,'$.config.collectionRelationTarget') IS NULL;

CREATE TRIGGER studio_history_insert AFTER INSERT ON studio_records
 BEGIN
 INSERT INTO studio_record_history(tenant_id,object_name,record_id,version,action,created_at,actor_kind,actor_id,cause_id,changes,expires_at)
 SELECT NEW.tenant_id,NEW.object_name,NEW.id,NEW.version,'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),
 COALESCE((SELECT actor_kind FROM studio_record_history_context WHERE tenant_id=NEW.tenant_id),'system'),
 (SELECT actor_id FROM studio_record_history_context WHERE tenant_id=NEW.tenant_id),
 (SELECT cause_id FROM studio_record_history_context WHERE tenant_id=NEW.tenant_id),
 (SELECT json_group_object(field_name,json(substr('{}',1,length('{}')-1)||IIF('{}'<>'{}' AND IIF(json_type(NEW.data,'$.'||field_name) IN ('null','text','integer','real','true','false'),json_patch(json_object('after',IIF(json_type(NEW.data,'$.'||field_name)='text' AND NOT (instr(json_extract(NEW.data,'$.'||field_name),char(0))>0 AND length((NEW.data -> ('$.'||field_name)))<=2050),substr(json_extract(NEW.data,'$.'||field_name),1,2048),json((NEW.data -> ('$.'||field_name))))),IIF(json_type(NEW.data,'$.'||field_name)='text' AND (length(json_extract(NEW.data,'$.'||field_name))>2048 OR (instr(json_extract(NEW.data,'$.'||field_name),char(0))>0 AND length((NEW.data -> ('$.'||field_name)))>2050)),json_object('afterTruncated',json('true')),'{}')),'{}')<>'{}',',','')||substr(IIF(json_type(NEW.data,'$.'||field_name) IN ('null','text','integer','real','true','false'),json_patch(json_object('after',IIF(json_type(NEW.data,'$.'||field_name)='text' AND NOT (instr(json_extract(NEW.data,'$.'||field_name),char(0))>0 AND length((NEW.data -> ('$.'||field_name)))<=2050),substr(json_extract(NEW.data,'$.'||field_name),1,2048),json((NEW.data -> ('$.'||field_name))))),IIF(json_type(NEW.data,'$.'||field_name)='text' AND (length(json_extract(NEW.data,'$.'||field_name))>2048 OR (instr(json_extract(NEW.data,'$.'||field_name),char(0))>0 AND length((NEW.data -> ('$.'||field_name)))>2050)),json_object('afterTruncated',json('true')),'{}')),'{}'),2))) FROM studio_record_history_fields WHERE tenant_id=NEW.tenant_id AND object_name=NEW.object_name AND (json_type(NEW.data,'$.'||field_name) IN ('null','text','integer','real','true','false'))),
 strftime('%Y-%m-%dT%H:%M:%fZ','now','+'||retention_days||' days')
 FROM studio_record_history_fields
 WHERE tenant_id=NEW.tenant_id AND object_name=NEW.object_name
 AND ((1) OR EXISTS(SELECT 1 FROM studio_record_history_fields WHERE tenant_id=NEW.tenant_id AND object_name=NEW.object_name AND (json_type(NEW.data,'$.'||field_name) IN ('null','text','integer','real','true','false'))))
 LIMIT 1;
 END;

CREATE TRIGGER studio_history_update AFTER UPDATE ON studio_records
 BEGIN
 INSERT INTO studio_record_history(tenant_id,object_name,record_id,version,action,created_at,actor_kind,actor_id,cause_id,changes,expires_at)
 SELECT NEW.tenant_id,NEW.object_name,NEW.id,NEW.version,IIF(OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL,'deleted',IIF(OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL,'restored','updated')),strftime('%Y-%m-%dT%H:%M:%fZ','now'),
 COALESCE((SELECT actor_kind FROM studio_record_history_context WHERE tenant_id=NEW.tenant_id),'system'),
 (SELECT actor_id FROM studio_record_history_context WHERE tenant_id=NEW.tenant_id),
 (SELECT cause_id FROM studio_record_history_context WHERE tenant_id=NEW.tenant_id),
 (SELECT json_group_object(field_name,json(substr(IIF(json_type(OLD.data,'$.'||field_name) IN ('null','text','integer','real','true','false'),json_patch(json_object('before',IIF(json_type(OLD.data,'$.'||field_name)='text' AND NOT (instr(json_extract(OLD.data,'$.'||field_name),char(0))>0 AND length((OLD.data -> ('$.'||field_name)))<=2050),substr(json_extract(OLD.data,'$.'||field_name),1,2048),json((OLD.data -> ('$.'||field_name))))),IIF(json_type(OLD.data,'$.'||field_name)='text' AND (length(json_extract(OLD.data,'$.'||field_name))>2048 OR (instr(json_extract(OLD.data,'$.'||field_name),char(0))>0 AND length((OLD.data -> ('$.'||field_name)))>2050)),json_object('beforeTruncated',json('true')),'{}')),'{}'),1,length(IIF(json_type(OLD.data,'$.'||field_name) IN ('null','text','integer','real','true','false'),json_patch(json_object('before',IIF(json_type(OLD.data,'$.'||field_name)='text' AND NOT (instr(json_extract(OLD.data,'$.'||field_name),char(0))>0 AND length((OLD.data -> ('$.'||field_name)))<=2050),substr(json_extract(OLD.data,'$.'||field_name),1,2048),json((OLD.data -> ('$.'||field_name))))),IIF(json_type(OLD.data,'$.'||field_name)='text' AND (length(json_extract(OLD.data,'$.'||field_name))>2048 OR (instr(json_extract(OLD.data,'$.'||field_name),char(0))>0 AND length((OLD.data -> ('$.'||field_name)))>2050)),json_object('beforeTruncated',json('true')),'{}')),'{}'))-1)||IIF(IIF(json_type(OLD.data,'$.'||field_name) IN ('null','text','integer','real','true','false'),json_patch(json_object('before',IIF(json_type(OLD.data,'$.'||field_name)='text' AND NOT (instr(json_extract(OLD.data,'$.'||field_name),char(0))>0 AND length((OLD.data -> ('$.'||field_name)))<=2050),substr(json_extract(OLD.data,'$.'||field_name),1,2048),json((OLD.data -> ('$.'||field_name))))),IIF(json_type(OLD.data,'$.'||field_name)='text' AND (length(json_extract(OLD.data,'$.'||field_name))>2048 OR (instr(json_extract(OLD.data,'$.'||field_name),char(0))>0 AND length((OLD.data -> ('$.'||field_name)))>2050)),json_object('beforeTruncated',json('true')),'{}')),'{}')<>'{}' AND IIF(json_type(NEW.data,'$.'||field_name) IN ('null','text','integer','real','true','false'),json_patch(json_object('after',IIF(json_type(NEW.data,'$.'||field_name)='text' AND NOT (instr(json_extract(NEW.data,'$.'||field_name),char(0))>0 AND length((NEW.data -> ('$.'||field_name)))<=2050),substr(json_extract(NEW.data,'$.'||field_name),1,2048),json((NEW.data -> ('$.'||field_name))))),IIF(json_type(NEW.data,'$.'||field_name)='text' AND (length(json_extract(NEW.data,'$.'||field_name))>2048 OR (instr(json_extract(NEW.data,'$.'||field_name),char(0))>0 AND length((NEW.data -> ('$.'||field_name)))>2050)),json_object('afterTruncated',json('true')),'{}')),'{}')<>'{}',',','')||substr(IIF(json_type(NEW.data,'$.'||field_name) IN ('null','text','integer','real','true','false'),json_patch(json_object('after',IIF(json_type(NEW.data,'$.'||field_name)='text' AND NOT (instr(json_extract(NEW.data,'$.'||field_name),char(0))>0 AND length((NEW.data -> ('$.'||field_name)))<=2050),substr(json_extract(NEW.data,'$.'||field_name),1,2048),json((NEW.data -> ('$.'||field_name))))),IIF(json_type(NEW.data,'$.'||field_name)='text' AND (length(json_extract(NEW.data,'$.'||field_name))>2048 OR (instr(json_extract(NEW.data,'$.'||field_name),char(0))>0 AND length((NEW.data -> ('$.'||field_name)))>2050)),json_object('afterTruncated',json('true')),'{}')),'{}'),2))) FROM studio_record_history_fields WHERE tenant_id=NEW.tenant_id AND object_name=NEW.object_name AND (((IIF(json_type(OLD.data,'$.'||field_name) IN ('integer','real'),'number',json_type(OLD.data,'$.'||field_name)) IS NOT IIF(json_type(NEW.data,'$.'||field_name) IN ('integer','real'),'number',json_type(NEW.data,'$.'||field_name)) OR json_extract(OLD.data,'$.'||field_name) IS NOT json_extract(NEW.data,'$.'||field_name)) AND (json_type(OLD.data,'$.'||field_name) IN ('null','text','integer','real','true','false') OR json_type(NEW.data,'$.'||field_name) IN ('null','text','integer','real','true','false'))))),
 strftime('%Y-%m-%dT%H:%M:%fZ','now','+'||retention_days||' days')
 FROM studio_record_history_fields
 WHERE tenant_id=NEW.tenant_id AND object_name=NEW.object_name
 AND ((OLD.deleted_at IS NOT NEW.deleted_at) OR EXISTS(SELECT 1 FROM studio_record_history_fields WHERE tenant_id=NEW.tenant_id AND object_name=NEW.object_name AND (((IIF(json_type(OLD.data,'$.'||field_name) IN ('integer','real'),'number',json_type(OLD.data,'$.'||field_name)) IS NOT IIF(json_type(NEW.data,'$.'||field_name) IN ('integer','real'),'number',json_type(NEW.data,'$.'||field_name)) OR json_extract(OLD.data,'$.'||field_name) IS NOT json_extract(NEW.data,'$.'||field_name)) AND (json_type(OLD.data,'$.'||field_name) IN ('null','text','integer','real','true','false') OR json_type(NEW.data,'$.'||field_name) IN ('null','text','integer','real','true','false'))))))
 LIMIT 1;
 END;

CREATE TRIGGER studio_history_delete AFTER DELETE ON studio_records BEGIN
 DELETE FROM studio_record_history WHERE tenant_id=OLD.tenant_id AND object_name=OLD.object_name AND record_id=OLD.id;
END;`;
  for (const sql of historyDdl
    .split(/;(?!(?:\s*END\b))/i)
    .filter((s) => s.trim()))
    await db.prepare(sql).run();
  await db
    .prepare("INSERT INTO studio_objects VALUES ('t','items',?)")
    .bind(
      JSON.stringify({
        fields: {
          name: { type: "Textbox" },
          count: { type: "Number" },
          active: { type: "Toggle" },
          secret: { type: "Password" },
          file: { type: "R2Attachment" },
        },
        studio: {
          history: {
            enabled: true,
            fields: ["name", "count", "active", "secret", "file"],
            retentionDays: 1,
          },
        },
      }),
    )
    .run();
});
afterAll(async () => platform?.dispose());
const events = async (id: string) =>
  (
    await db
      .prepare(
        "SELECT * FROM studio_record_history WHERE record_id=? ORDER BY version",
      )
      .bind(id)
      .all<any>()
  ).results;
it("captures scalar null/false/zero, omits unsafe values, and attributes direct writes", async () => {
  const actor = historyDatabase(db, "t", { kind: "user", id: "alice" });
  await actor
    .prepare(
      "INSERT INTO studio_records(tenant_id,object_name,id,data) VALUES ('t','items','one',?)",
    )
    .bind(
      JSON.stringify({
        name: null,
        count: 0,
        active: false,
        secret: "hidden",
        file: "hidden",
      }),
    )
    .run();
  const rows = await events("one");
  expect(rows).toHaveLength(1);
  expect(rows[0].actor_id).toBe("alice");
  expect(JSON.parse(rows[0].changes)).toEqual({
    name: { after: null },
    count: { after: 0 },
    active: { after: false },
  });
  await actor.batch([
    actor
      .prepare("UPDATE studio_records SET data=?,version=2 WHERE id='one'")
      .bind(JSON.stringify({ name: "changed", count: 0, active: false })),
  ]);
  expect(JSON.parse((await events("one"))[1].changes)).toEqual({
    name: { before: null, after: "changed" },
  });
  await db.prepare("UPDATE studio_records SET version=3 WHERE id='one'").run();
  expect(await events("one")).toHaveLength(2);
  await db
    .prepare("UPDATE studio_records SET data='{}',version=4 WHERE id='one'")
    .run();
  expect((await events("one"))[2].actor_kind).toBe("system");
  expect(
    await db
      .prepare("SELECT count(*) n FROM studio_record_history_context")
      .first("n"),
  ).toBe(0);
});
it("rolls back history and actor context with failed mutation batches", async () => {
  const actor = historyDatabase(db, "t", { kind: "user", id: "bob" });
  await expect(
    actor.batch([
      actor.prepare(
        "INSERT INTO studio_records VALUES ('t','items','rollback','{\"name\":\"bad\"}',1,NULL)",
      ),
      actor.prepare("INSERT INTO fail_guard VALUES(0)"),
    ]),
  ).rejects.toThrow();
  expect(await events("rollback")).toHaveLength(0);
  expect(
    await db
      .prepare("SELECT count(*) n FROM studio_record_history_context")
      .first("n"),
  ).toBe(0);
});
it("captures deletion/restoration, purges hard deletion, bounds expiry cleanup", async () => {
  await db
    .prepare(
      "UPDATE studio_records SET deleted_at='now',version=5 WHERE id='one'",
    )
    .run();
  await db
    .prepare(
      "UPDATE studio_records SET deleted_at=NULL,version=6 WHERE id='one'",
    )
    .run();
  expect((await events("one")).slice(-2).map((r) => r.action)).toEqual([
    "deleted",
    "restored",
  ]);
  await db
    .prepare(
      "UPDATE studio_record_history SET expires_at='2000-01-01T00:00:00.000Z'",
    )
    .run();
  const before = (await events("one")).length;
  await purgeExpiredRecordHistory(db, 1);
  expect(await events("one")).toHaveLength(before - 1);
  await db.prepare("DELETE FROM studio_records WHERE id='one'").run();
  expect(await events("one")).toHaveLength(0);
});
it("isolates concurrent request actors and allows explicit actor overrides", async () => {
  const alice = historyDatabase(db, "t", { kind: "user", id: "alice" });
  const bob = historyDatabase(db, "t", { kind: "user", id: "bob" });
  await Promise.all([
    alice
      .prepare(
        "INSERT INTO studio_records VALUES('t','items','alice','{\"name\":\"a\"}',1,NULL)",
      )
      .run(),
    bob
      .prepare(
        "INSERT INTO studio_records VALUES('t','items','bob','{\"name\":\"b\"}',1,NULL)",
      )
      .run(),
  ]);
  expect((await events("alice"))[0].actor_id).toBe("alice");
  expect((await events("bob"))[0].actor_id).toBe("bob");
  const workflow = historyDatabase(alice, "t", {
    kind: "workflow",
    id: "owner",
    causeId: "execution",
  });
  await workflow
    .prepare(
      "UPDATE studio_records SET data='{\"name\":\"workflow\"}',version=2 WHERE id='alice' RETURNING id",
    )
    .first();
  expect((await events("alice"))[1]).toMatchObject({
    actor_kind: "workflow",
    actor_id: "owner",
    cause_id: "execution",
  });
});
it("defaults off and defensively ignores sensitive, readonly, hidden and relation metadata", async () => {
  const fields = {
    name: { type: "Textbox" },
    hidden: { type: "Textbox", hidden: true },
    readonly: { type: "Textbox", readOnly: true },
    sensitive: { type: "Textbox", config: { sensitive: true } },
    relation: { type: "Textbox", config: { relation: "items" } },
    created_by: { type: "Textbox" },
    object: { type: "Textbox" },
  };
  await db
    .prepare("INSERT INTO studio_objects VALUES('other','items',?)")
    .bind(JSON.stringify({ fields }))
    .run();
  await db
    .prepare(
      "INSERT INTO studio_records VALUES('other','items','disabled','{\"name\":\"a\"}',1,NULL)",
    )
    .run();
  expect(await events("disabled")).toHaveLength(0);
  await db
    .prepare("UPDATE studio_objects SET config=? WHERE tenant_id='other'")
    .bind(
      JSON.stringify({
        fields,
        studio: { history: { enabled: true, fields: Object.keys(fields) } },
      }),
    )
    .run();
  await db
    .prepare("UPDATE studio_records SET data=?,version=2 WHERE id='disabled'")
    .bind(
      JSON.stringify({
        name: "b",
        hidden: "no",
        readonly: "no",
        sensitive: "no",
        relation: "no",
        created_by: "no",
        object: { nested: "no" },
      }),
    )
    .run();
  expect(JSON.parse((await events("disabled"))[0].changes)).toEqual({
    name: { before: "a", after: "b" },
  });
});
it("bounds long string sides but compares complete values", async () => {
  const first = "a".repeat(2100);
  await db
    .prepare("INSERT INTO studio_records VALUES('t','items','long',?,1,NULL)")
    .bind(JSON.stringify({ name: first }))
    .run();
  await db
    .prepare("UPDATE studio_records SET data=?,version=2 WHERE id='long'")
    .bind(JSON.stringify({ name: first + "b" }))
    .run();
  const rows = await events("long");
  expect(rows).toHaveLength(2);
  expect(JSON.parse(rows[1].changes)).toEqual({
    name: {
      before: "a".repeat(2048),
      after: "a".repeat(2048),
      beforeTruncated: true,
      afterTruncated: true,
    },
  });
});
it("compares scalar meaning rather than JSON encoding", async () => {
  await db
    .prepare(
      "INSERT INTO studio_records VALUES('t','items','equivalent',?,1,NULL)",
    )
    .bind('{"name":"a","count":1}')
    .run();
  await db
    .prepare("UPDATE studio_records SET data=?,version=2 WHERE id='equivalent'")
    .bind('{"name":"\\u0061","count":1.0}')
    .run();
  expect(await events("equivalent")).toHaveLength(1);
});
it("preserves short embedded-NUL strings and bounds long values after NUL", async () => {
  const short = "before\u0000after";
  await db
    .prepare("INSERT INTO studio_records VALUES('t','items','nul',?,1,NULL)")
    .bind(JSON.stringify({ name: short }))
    .run();
  expect(JSON.parse((await events("nul"))[0].changes)).toEqual({
    name: { after: short },
  });
  const long = "before\u0000" + "a".repeat(2100);
  await db
    .prepare("UPDATE studio_records SET data=?,version=2 WHERE id='nul'")
    .bind(JSON.stringify({ name: long }))
    .run();
  expect(JSON.parse((await events("nul"))[1].changes)).toEqual({
    name: { before: short, after: "before", afterTruncated: true },
  });
  await db
    .prepare("UPDATE studio_records SET data=?,version=3 WHERE id='nul'")
    .bind(JSON.stringify({ name: "before\u0000changed" }))
    .run();
  expect(JSON.parse((await events("nul"))[2].changes)).toEqual({
    name: {
      before: "before",
      beforeTruncated: true,
      after: "before\u0000changed",
    },
  });
});

it("reports remaining expiration lag after a bounded maintenance batch", async () => {
  await db
    .prepare(
      "UPDATE studio_record_history SET expires_at='2000-01-01T00:00:00.000Z'",
    )
    .run();
  const { maintainRecordHistory } =
    await import("../src/record-history-storage");
  const report = await maintainRecordHistory(db, 1);
  expect(report.deleted).toBe(1);
  expect(report.oldestExpiredAt).toBe("2000-01-01T00:00:00.000Z");
  expect(report.lagSeconds).toBeGreaterThan(0);
});
