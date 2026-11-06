import { beforeAll, afterAll, beforeEach, it, expect } from "vitest";
import { makeConfig } from "@savia/studio-shared/metadata";
import { NotificationRepository } from "../src/notifications/repository";
import {
  backfillWorkflowNotices,
  getRetentionSettings,
  maintainNotifications,
  saveRetentionSettings,
} from "../src/notifications/maintenance";
import { WorkflowRepository } from "../src/workflows/repository";
import { notificationFixture } from "./notifications-fixture";

let fixture: Awaited<ReturnType<typeof notificationFixture>>;
const tenant = "domain:general";
const dayMs = 86_400_000;
const now = 400 * dayMs;

beforeAll(async () => {
  fixture = await notificationFixture();
  await fixture.db
    .prepare(
      "INSERT INTO studio_objects(tenant_id,name,label,config) VALUES (?,?,?,?)",
    )
    .bind(
      tenant,
      "requests",
      "Requests",
      JSON.stringify(
        makeConfig({ title: { type: "Textbox", label: "Title" } }),
      ),
    )
    .run();
});

afterAll(async () => {
  await fixture?.dispose();
});

beforeEach(async () => {
  await fixture.db.exec(
    "DELETE FROM notification_recipient_retries; DELETE FROM notification_deliveries; DELETE FROM notification_events; DELETE FROM notification_scope_settings; DELETE FROM notification_maintenance_checkpoints;",
  );
});

async function seedDelivery(
  recipient: string,
  createdAt: number,
  readAt: number | null,
) {
  const repository = new NotificationRepository(fixture.db);
  const { id } = await repository.accept({
    scope: { kind: "workspace", id: tenant },
    key: `m-${recipient}-${createdAt}`,
    actor: { kind: "user", id: "admin" },
    source: { kind: "admin-message", id: `m-${createdAt}` },
    title: "Old",
    body: "",
    audience: { kind: "explicit", principals: [recipient] },
    createdAt,
    expiresAt: null,
  });
  await fixture.db
    .prepare(
      "INSERT INTO notification_deliveries(id,event_id,scope_kind,scope_id,recipient_id,created_at,read_at) VALUES (?,?,?,?,?,?,?)",
    )
    .bind(`dlv-${id}`, id, "workspace", tenant, recipient, createdAt, readAt)
    .run();
}

it("retains unread longer than read and protects open tasks", async () => {
  await saveRetentionSettings(fixture.db, tenant, {
    readDays: 90,
    unreadDays: 180,
  });
  expect(await getRetentionSettings(fixture.db, tenant)).toEqual({
    readDays: 90,
    unreadDays: 180,
  });
  await expect(
    saveRetentionSettings(fixture.db, tenant, { readDays: 90, unreadDays: 30 }),
  ).rejects.toThrow();
  await seedDelivery("alice", now - 100 * dayMs, now - 99 * dayMs);
  await seedDelivery("bob", now - 100 * dayMs, null);
  const report = await maintainNotifications(fixture.db, now, 100);
  expect(report.cleanedDeliveries).toBe(1);
  const remaining = (
    await fixture.db
      .prepare("SELECT recipient_id FROM notification_deliveries")
      .all<{
        recipient_id: string;
      }>()
  ).results;
  expect(remaining.map((row) => row.recipient_id)).toEqual(["bob"]);
});

it("backfills open workflow tasks resumably without duplicating live capture", async () => {
  const repo = new WorkflowRepository(fixture.db, tenant);
  const draft = await repo.create(
    {
      name: "Backfill flow",
      definition: {
        trigger: { type: "manual", collection: "requests" },
        nodes: [
          { id: "t1", type: "task", title: "Open item", assignee: "alice" },
        ],
      },
    },
    "owner",
  );
  await repo.publish(draft.id, draft.revision, "owner");
  await repo.start(draft.id, {}, "owner", `backfill-${now}`);
  const { processWorkflows } = await import("../src/workflows/runtime");
  await processWorkflows(fixture.db, async () => true, { now });
  const first = await backfillWorkflowNotices(fixture.db, null, 100);
  expect(first.backfilled).toBeGreaterThanOrEqual(1);
  expect(first.cursor).not.toBeNull();
  const second = await backfillWorkflowNotices(fixture.db, null, 100);
  expect(second.backfilled).toBe(0);
  const resumed = await backfillWorkflowNotices(fixture.db, first.cursor, 100);
  expect(resumed.backfilled).toBe(0);
  const checkpoint = await fixture.db
    .prepare(
      "SELECT cursor FROM notification_maintenance_checkpoints WHERE name='backfill'",
    )
    .bind()
    .first<{ cursor: string }>();
  expect(checkpoint?.cursor).toBe(first.cursor);
});
