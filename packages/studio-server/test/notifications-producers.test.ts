import { beforeAll, afterAll, it, expect } from "vitest";
import { makeConfig } from "@savia/studio-shared/metadata";
import type { NotificationPolicy } from "@savia/studio-shared/notifications";
import { createRecord, updateRecord } from "../src/services";
import { historyDatabase } from "../src/record-history-storage";
import { NotificationRepository } from "../src/notifications/repository";
import { processNotifications } from "../src/notifications/dispatcher";
import { WorkflowRepository } from "../src/workflows/repository";
import { processWorkflows } from "../src/workflows/runtime";
import { notificationFixture } from "./notifications-fixture";

let fixture: Awaited<ReturnType<typeof notificationFixture>>;
const tenant = "domain:general";
const now = 2_000_000;

function openPolicy(db: D1Database): NotificationPolicy {
  return {
    async recipients(event, after, limit) {
      if (event.audience.kind === "collection-followers") {
        const rows = (
          await db
            .prepare(
              "SELECT principal_id FROM notification_subscriptions WHERE workspace_id=? AND collection=? ORDER BY principal_id",
            )
            .bind(event.scope.id, event.audience.collection)
            .all<{ principal_id: string }>()
        ).results;
        return { ids: rows.map((row) => row.principal_id), nextCursor: null };
      }
      if (event.audience.kind !== "explicit") return { ids: [], nextCursor: null };
      const ordered = [...new Set(event.audience.principals)].sort();
      const start = after === null ? 0 : ordered.findIndex((id) => id > after);
      const ids = start < 0 ? [] : ordered.slice(start, start + limit);
      const last = ids[ids.length - 1];
      return {
        ids,
        nextCursor: last !== undefined && start + limit < ordered.length ? last : null,
      };
    },
    async canReadScope() {
      return true;
    },
    async canReadSource() {
      return true;
    },
    async canSend() {
      return true;
    },
  };
}

const options = { now: () => now, random: () => 0, workerId: "producers" };

beforeAll(async () => {
  fixture = await notificationFixture();
  await fixture.db
    .prepare("INSERT INTO crm_objects(tenant_id,name,label,config) VALUES (?,?,?,?)")
    .bind(
      tenant,
      "requests",
      "Requests",
      JSON.stringify(makeConfig({ title: { type: "Textbox", label: "Title" } })),
    )
    .run();
  for (const principal of ["alice", "bob"]) {
    await fixture.db
      .prepare(
        "INSERT INTO notification_subscriptions(workspace_id,principal_id,collection,created_at) VALUES (?,?,?,?)",
      )
      .bind(tenant, principal, "requests", now)
      .run();
  }
});

afterAll(async () => {
  await fixture?.dispose();
});

it("notifies followers except the acting user on record changes", async () => {
  const db = historyDatabase(fixture.db, tenant, { kind: "user", id: "alice" });
  const record = await createRecord(db, tenant, "requests", { title: "One" });
  const stored = await createRecord(db, tenant, "requests", { title: "Two" });
  await updateRecord(db, tenant, "requests", stored.id, { title: "Two edited" }, { version: 1 });
  const events = (
    await fixture.db.prepare("SELECT id FROM notification_events").all()
  ).results;
  expect(events).toHaveLength(3);
    const pl = await fixture.db.prepare("SELECT payload FROM notification_events LIMIT 1").first("payload") as string;
  const fanout = (
    await fixture.db.prepare("SELECT recipient_id FROM notification_deliveries").all()
  ).results;
  expect(fanout).toHaveLength(3);
  const report = await processNotifications(fixture.db, openPolicy(fixture.db), options);
  expect(report.delivered).toBe(0);
  expect(report.skipped).toBe(3);
  const repository = new NotificationRepository(fixture.db);
  const bob = await repository.list("bob", [{ kind: "workspace", id: tenant }], {});
  expect(bob.items).toHaveLength(3);
  const alice = await repository.list("alice", [{ kind: "workspace", id: tenant }], {});
  expect(alice.items).toHaveLength(0);
});

it("creates workflow task notices atomically with tasks", async () => {
  const repository = new NotificationRepository(fixture.db);
  const before = await fixture.db
    .prepare("SELECT COUNT(*) AS n FROM notification_events")
    .first<number>("n");
  const repo = new WorkflowRepository(fixture.db, tenant);
  const draft = await repo.create(
    {
      name: "Task flow",
      definition: {
        trigger: { type: "manual", collection: "requests" },
        nodes: [{ id: "t1", type: "task", title: "Do it", assignee: "alice" }],
      },
    },
    "owner",
  );
  await repo.publish(draft.id, draft.revision, "owner");
  const started = await repo.start(draft.id, {}, "owner", `notice-${now}`);
  await processWorkflows(fixture.db, async () => true, { now });
  expect(started).toBeDefined();
  const tasks = await fixture.db
    .prepare("SELECT COUNT(*) AS n FROM workflow_tasks")
    .first<number>("n");
  expect(tasks).toBeGreaterThan(0);
  const after = await fixture.db
    .prepare("SELECT COUNT(*) AS n FROM notification_events")
    .first<number>("n");
  expect(after).toBeGreaterThan(before ?? 0);
  await processNotifications(fixture.db, openPolicy(fixture.db), options);
  const inbox = await repository.list("alice", [{ kind: "workspace", id: tenant }], {});
  expect(inbox.items.some((item) => item.source.kind === "workflow-task")).toBe(true);
});
