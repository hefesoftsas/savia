import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync, readdirSync } from "node:fs";
import { migrationStatements } from "./migration-statements";
import { historyDatabase } from "../src/record-history-storage";
import { CollectionEventOutbox } from "../src/collection-event-outbox";
import { deleteRecord } from "../src/services";

let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;
const tenant = "collection-events";

beforeAll(async () => {
  platform = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: false,
  });
  db = platform.env.DB;
  for (const name of readdirSync("migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    for (const sql of migrationStatements(
      readFileSync(`migrations/${name}`, "utf8"),
    ))
      await db.prepare(sql).run();
  }
  for (const sql of migrationStatements(
    readFileSync(
      "../db/migrations/0057_savia_flows_collection_events.sql",
      "utf8",
    ),
  ))
    await db.prepare(sql).run();
  await db
    .prepare(
      "INSERT INTO studio_objects(tenant_id,name,label,description,config) VALUES(?,?,?,?,?)",
    )
    .bind(tenant, "contacts", "Contacts", "", JSON.stringify({ fields: {} }))
    .run();
  await db
    .prepare(
      "CREATE TABLE test_delete_checkpoint (id TEXT PRIMARY KEY, version INTEGER NOT NULL)",
    )
    .run();
});

afterAll(async () => platform?.dispose());

beforeEach(async () => {
  await db.prepare("DELETE FROM savia_flows_collection_event_outbox").run();
});

async function seedRecord(
  id: string,
  data: Record<string, unknown>,
  version = 1,
) {
  await db
    .prepare(
      "INSERT INTO studio_records(id,tenant_id,object_name,data,version,created_at,updated_at,created_by) VALUES(?,?,?,?,?,?,?,?)",
    )
    .bind(
      id,
      tenant,
      "contacts",
      JSON.stringify(data),
      version,
      "2026-10-12T00:00:00.000Z",
      "2026-10-12T00:00:00.000Z",
      "creator",
    )
    .run();
}

it("captures authenticated lifecycle snapshots in the transaction and skips system/no-op writes", async () => {
  const actor = historyDatabase(db, tenant, { kind: "user", id: "alice" });
  const outbox = new CollectionEventOutbox(db);
  await actor
    .prepare(
      "INSERT INTO studio_records(id,tenant_id,object_name,data,created_at,updated_at,created_by) VALUES(?,?,?,?,?,?,?)",
    )
    .bind(
      "contact-a",
      tenant,
      "contacts",
      JSON.stringify({ name: "Ada", score: 1 }),
      "2026-10-12T00:00:00.000Z",
      "2026-10-12T00:00:00.000Z",
      "alice",
    )
    .run();
  await actor
    .prepare(
      "UPDATE studio_records SET data=?,version=2 WHERE tenant_id=? AND id=?",
    )
    .bind(JSON.stringify({ name: "Ada", score: 2 }), tenant, "contact-a")
    .run();
  await actor
    .prepare(
      "UPDATE studio_records SET data=?,version=3,deleted_at=? WHERE tenant_id=? AND id=?",
    )
    .bind(
      JSON.stringify({ name: "Ada", score: 2 }),
      "2026-10-12T00:01:00.000Z",
      tenant,
      "contact-a",
    )
    .run();
  await actor
    .prepare(
      "UPDATE studio_records SET deleted_at=NULL,version=4 WHERE tenant_id=? AND id=?",
    )
    .bind(tenant, "contact-a")
    .run();
  await actor
    .prepare(
      "UPDATE studio_records SET data=?,version=5 WHERE tenant_id=? AND id=?",
    )
    .bind(JSON.stringify({ name: "Ada", score: 2 }), tenant, "contact-a")
    .run();
  await seedRecord("system-only", { name: "System" });

  const claimed = await outbox.claim(
    10,
    Date.parse("2026-10-12T00:02:00.000Z"),
  );
  expect(claimed.map(({ event }) => event.operation)).toEqual([
    "created",
    "updated",
    "deleted",
    "restored",
  ]);
  expect(claimed[0].event).toMatchObject({
    tenant,
    collection: "contacts",
    recordId: "contact-a",
    recordVersion: 1,
    actor: { kind: "user", id: "alice" },
    before: null,
    after: {
      id: "contact-a",
      _version: 1,
      created_by: "alice",
      name: "Ada",
      score: 1,
    },
  });
  expect(claimed[1].event).toMatchObject({
    changedFields: ["score"],
    before: { score: 1 },
    after: { score: 2 },
  });
  expect(claimed[2].event.after).toMatchObject({
    deleted_at: "2026-10-12T00:01:00.000Z",
  });
  expect(claimed[3].event.before).toMatchObject({
    deleted_at: "2026-10-12T00:01:00.000Z",
  });
  expect(await outbox.get(claimed[0].event.id)).toEqual(claimed[0].event);
});

it("rolls back the outbox row with the record transaction", async () => {
  const actor = historyDatabase(db, tenant, {
    kind: "user",
    id: "rollback-user",
  });
  await db
    .prepare(
      "CREATE TRIGGER fail_contact_insert BEFORE INSERT ON studio_records WHEN NEW.id='rollback-contact' BEGIN SELECT RAISE(ABORT,'forced rollback'); END",
    )
    .run();
  await expect(
    actor
      .prepare(
        "INSERT INTO studio_records(id,tenant_id,object_name,data,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      )
      .bind("rollback-contact", tenant, "contacts", "{}", "now", "now")
      .run(),
  ).rejects.toThrow();
  await db.prepare("DROP TRIGGER fail_contact_insert").run();
  expect(
    await db
      .prepare(
        "SELECT count(*) n FROM savia_flows_collection_event_outbox WHERE record_id='rollback-contact'",
      )
      .first("n"),
  ).toBe(0);
});

it("captures direct multi-record transactions without depending on a route callback", async () => {
  const actor = historyDatabase(db, tenant, {
    kind: "workflow",
    id: "flow-owner",
    causeId: JSON.stringify({
      rootEventId: "event-root",
      workflowIds: ["flow-a"],
      depth: 1,
    }),
  });
  const outbox = new CollectionEventOutbox(db);
  await actor.batch([
    db
      .prepare(
        "INSERT INTO studio_records(id,tenant_id,object_name,data,created_at,updated_at,created_by) VALUES(?,?,?,?,?,?,?)",
      )
      .bind(
        "bundle-a",
        tenant,
        "contacts",
        JSON.stringify({ name: "A" }),
        "now",
        "now",
        "flow-owner",
      ),
    db
      .prepare(
        "INSERT INTO studio_records(id,tenant_id,object_name,data,created_at,updated_at,created_by) VALUES(?,?,?,?,?,?,?)",
      )
      .bind(
        "bundle-b",
        tenant,
        "contacts",
        JSON.stringify({ name: "B" }),
        "now",
        "now",
        "flow-owner",
      ),
  ]);
  const claimed = await outbox.claim(10, Date.now());
  expect(claimed.map(({ event }) => event.recordId).sort()).toEqual([
    "bundle-a",
    "bundle-b",
  ]);
  expect(claimed[0].event).toMatchObject({
    cause: { rootEventId: "event-root", workflowIds: ["flow-a"], depth: 1 },
    actor: { kind: "workflow", id: "flow-owner" },
  });
});

it("excludes schema data migration updates but resumes capture after publication", async () => {
  await seedRecord("schema-contact", { name: "Before" });
  const actor = historyDatabase(db, tenant, {
    kind: "user",
    id: "schema-editor",
  });
  const outbox = new CollectionEventOutbox(db);
  await actor.batch([
    db
      .prepare(
        "INSERT INTO studio_schema_data(tenant_id,object_name,version,record_id,data) VALUES(?,?,?,?,?)",
      )
      .bind(
        tenant,
        "contacts",
        1,
        "schema-contact",
        JSON.stringify({ name: "Before" }),
      ),
    db
      .prepare(
        "UPDATE studio_records SET data=?,version=version+1 WHERE tenant_id=? AND id=?",
      )
      .bind(JSON.stringify({ name: "Migrated" }), tenant, "schema-contact"),
  ]);
  expect(await outbox.claim(10, Date.now())).toEqual([]);
  await db
    .prepare(
      "UPDATE studio_objects SET version=2 WHERE tenant_id=? AND name='contacts'",
    )
    .bind(tenant)
    .run();
  await actor
    .prepare(
      "UPDATE studio_records SET data=?,version=version+1 WHERE tenant_id=? AND id=?",
    )
    .bind(JSON.stringify({ name: "Regular update" }), tenant, "schema-contact")
    .run();
  expect(
    (await outbox.claim(10, Date.now())).map(({ event }) => event.operation),
  ).toEqual(["updated"]);
});

it("runs delete checkpoints inside the delete transaction with the committed version result", async () => {
  await seedRecord("checkpoint-contact", { name: "Checkpoint" });
  const actor = historyDatabase(db, tenant, {
    kind: "workflow",
    id: "delete-flow",
  });
  const result = await deleteRecord(
    actor,
    tenant,
    "contacts",
    "checkpoint-contact",
    {
      version: 1,
      checkpoint: {
        before: [
          db.prepare(
            "INSERT INTO test_delete_checkpoint(id,version) VALUES('before',0)",
          ),
        ],
        after: ({ id, _version }) => [
          db
            .prepare(
              "INSERT INTO test_delete_checkpoint(id,version) VALUES(?,?)",
            )
            .bind(id, _version),
        ],
      },
    },
  );
  expect(result).toEqual({ id: "checkpoint-contact", _version: 2 });
  expect(
    (
      await db
        .prepare("SELECT id,version FROM test_delete_checkpoint ORDER BY id")
        .all()
    ).results,
  ).toEqual([
    { id: "before", version: 0 },
    { id: "checkpoint-contact", version: 2 },
  ]);
  const [event] = await new CollectionEventOutbox(db).claim(10, Date.now());
  expect(event.event.operation).toBe("deleted");
});

it("leases atomically, retries with capped backoff, completes, and retains delivered rows", async () => {
  const actor = historyDatabase(db, tenant, { kind: "user", id: "lease-user" });
  const outbox = new CollectionEventOutbox(db);
  await actor
    .prepare(
      "INSERT INTO studio_records(id,tenant_id,object_name,data,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    )
    .bind("lease-contact", tenant, "contacts", "{}", "now", "now")
    .run();
  const [first] = await outbox.claim(1, 1000);
  expect(first).toBeDefined();
  expect(await outbox.claim(10, 1001)).toEqual([]);
  await outbox.retry(first.event.id, first.lease, "temporary", 2000);
  expect(await outbox.claim(1, 2000)).toEqual([]);
  const [retried] = await outbox.claim(1, 32000);
  expect(retried.event.id).toBe(first.event.id);
  await outbox.complete(retried.event.id, retried.lease, 33000);
  expect(await outbox.claim(10, 40000)).toEqual([]);
  expect(await outbox.get(first.event.id)).toEqual(first.event);
});

it("marks repeatedly failing events durably after twenty claims and ignores stale leases", async () => {
  const actor = historyDatabase(db, tenant, {
    kind: "user",
    id: "exhaust-user",
  });
  const outbox = new CollectionEventOutbox(db);
  await actor
    .prepare(
      "INSERT INTO studio_records(id,tenant_id,object_name,data,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    )
    .bind("exhaust-contact", tenant, "contacts", "{}", "now", "now")
    .run();
  let now = Date.now();
  for (let attempt = 0; attempt < 20; attempt++) {
    const [claimed] = await outbox.claim(1, now);
    expect(claimed).toBeDefined();
    await outbox.retry(
      claimed.event.id,
      claimed.lease,
      `failure ${attempt}`,
      now,
    );
    now += 5 * 60_000;
  }
  expect(await outbox.claim(1, now + 1)).toEqual([]);
  const state = await db
    .prepare(
      "SELECT status,attempt_count,last_error FROM savia_flows_collection_event_outbox WHERE record_id='exhaust-contact'",
    )
    .first<any>();
  expect(state).toEqual({
    status: "failed",
    attempt_count: 20,
    last_error: "failure 19",
  });
});
