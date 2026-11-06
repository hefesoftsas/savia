import { beforeAll, afterAll, it, expect } from "vitest";
import type { NotificationPolicy } from "@savia/studio-shared/notifications";
import { sendAdminNotice, adminEventStatus } from "../src/notifications/admin";
import { processNotifications } from "../src/notifications/dispatcher";
import { notificationFixture } from "./notifications-fixture";

let fixture: Awaited<ReturnType<typeof notificationFixture>>;
const scope = { kind: "workspace", id: "domain:general" } as const;
let now = 3_000_000;

const managers = new Set(["admin"]);
const policy: NotificationPolicy = {
  async recipients(event, after, limit) {
    if (event.audience.kind !== "explicit") return { ids: [], nextCursor: null };
    return { ids: event.audience.principals.slice(0, limit), nextCursor: null };
  },
  async canReadScope() {
    return true;
  },
  async canReadSource() {
    return true;
  },
  async canSend(principal) {
    return managers.has(principal);
  },
};

function payload(title = "Maintenance") {
  return {
    title,
    body: "Window at midnight",
    audience: { kind: "explicit", principals: ["alice", "bob"] },
    requireAcknowledgement: false,
  } as const;
}

beforeAll(async () => {
  fixture = await notificationFixture();
});

afterAll(async () => {
  await fixture?.dispose();
});

it("accepts admin notices idempotently and rejects unauthorized senders", async () => {
  const first = await sendAdminNotice(fixture.db, policy, "admin", scope, "window-1", payload(), now);
  expect(first.status).toBe("accepted");
  expect(first.duplicate).toBe(false);
  const second = await sendAdminNotice(fixture.db, policy, "admin", scope, "window-1", payload(), now);
  expect(second.duplicate).toBe(true);
  expect(second.eventId).toBe(first.eventId);
  await expect(
    sendAdminNotice(fixture.db, policy, "admin", scope, "window-1", payload("Changed"), now),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    sendAdminNotice(fixture.db, policy, "mallory", scope, "window-2", payload(), now),
  ).rejects.toMatchObject({ status: 403 });
});

it("enforces the per-minute send quota", async () => {
  for (let i = 0; i < 9; i++) {
    await sendAdminNotice(fixture.db, policy, "admin", scope, `quota-${i}`, payload(), now);
  }
  await expect(
    sendAdminNotice(fixture.db, policy, "admin", scope, "quota-over", payload(), now),
  ).rejects.toMatchObject({ status: 429 });
});

it("reports delivery status after dispatch", async () => {
  const sent = await sendAdminNotice(
    fixture.db,
    policy,
    "admin",
    scope,
    "status-1",
    payload(),
    now + 61_000,
  );
  const before = await adminEventStatus(fixture.db, "admin", sent.eventId);
  expect(before.status).toBe("accepted");
  await processNotifications(fixture.db, policy, {
    now: () => now + 61_000,
    random: () => 0,
    workerId: "admin-status",
  });
  const after = await adminEventStatus(fixture.db, "admin", sent.eventId);
  expect(after.status).toBe("completed");
  expect(after.delivered).toBe(2);
});
