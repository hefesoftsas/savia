import { beforeAll, afterAll, beforeEach, it, expect } from "vitest";
import type {
  NoticeEventInput,
  NotificationPolicy,
} from "@savia/studio-shared/notifications";
import { NotificationRepository } from "../src/notifications/repository";
import { processNotifications } from "../src/notifications/dispatcher";
import { notificationFixture } from "./notifications-fixture";

let fixture: Awaited<ReturnType<typeof notificationFixture>>;
const scope = { kind: "workspace", id: "domain:general" } as const;
let now = 1_000_000;

function input(key: string, principals: string[]): NoticeEventInput {
  return {
    scope,
    key,
    actor: { kind: "user", id: "admin" },
    source: { kind: "admin-message", id: key },
    title: "Review",
    body: "",
    audience: { kind: "explicit", principals },
    createdAt: now,
    expiresAt: null,
  };
}

function stubPolicy(overrides: Partial<{
  members: string[];
  followers: string[];
  inactive: Set<string>;
  failOnce: Set<string>;
  calls: string[];
}> = {}): NotificationPolicy {
  const calls = overrides.calls ?? [];
  const failOnce = new Set(overrides.failOnce ?? []);
  return {
    async canReadScope(principal) {
      calls.push(`scope:${principal}`);
      return !overrides.inactive?.has(principal);
    },
    async canReadSource(principal) {
      calls.push(`source:${principal}`);
      if (failOnce.has(principal)) {
        failOnce.delete(principal);
        throw new Error("transient policy outage");
      }
      return !overrides.inactive?.has(principal);
    },
    async canSend() {
      return true;
    },
    async recipients(event, after, limit) {
      const base =
        event.audience.kind === "explicit"
          ? [...event.audience.principals]
          : event.audience.kind === "workspace-members"
            ? [...(overrides.members ?? [])]
            : [...(overrides.followers ?? [])];
      const ordered = [...new Set(base)].sort();
      const start = after === null ? 0 : ordered.findIndex((id) => id > after);
      const ids = start < 0 ? [] : ordered.slice(start, start + limit);
      const last = ids[ids.length - 1];
      return {
        ids,
        nextCursor: last !== undefined && start + limit < ordered.length ? last : null,
      };
    },
  };
}

const options = {
  now: () => now,
  random: () => 0,
  workerId: "test",
};

beforeAll(async () => {
  fixture = await notificationFixture();
});

afterAll(async () => {
  await fixture?.dispose();
});

beforeEach(async () => {
  now = 1_000_000;
  await fixture.db.exec(
    "DELETE FROM notification_recipient_retries; DELETE FROM notification_deliveries; DELETE FROM notification_events; DELETE FROM notification_subscriptions;",
  );
});

it("delivers once per recipient with two concurrent workers", async () => {
  const repository = new NotificationRepository(fixture.db);
  await repository.accept(input("two-workers", ["alice", "bob"]));
  const policy = stubPolicy();
  const [a, b] = await Promise.all([
    processNotifications(fixture.db, policy, { ...options, workerId: "a" }),
    processNotifications(fixture.db, policy, { ...options, workerId: "b" }),
  ]);
  expect(a.delivered + b.delivered).toBe(2);
  const count = await fixture.db
    .prepare("SELECT COUNT(*) AS n FROM notification_deliveries")
    .first<number>("n");
  expect(count).toBe(2);
});

it("recovers a stale lease after a crash", async () => {
  const repository = new NotificationRepository(fixture.db);
  const { id } = await repository.accept(input("crash", ["alice"]));
  await fixture.db
    .prepare(
      "UPDATE notification_events SET status='processing',lease_token='dead',lease_until=? WHERE id=?",
    )
    .bind(now - 1000, id)
    .run();
  const report = await processNotifications(fixture.db, stubPolicy(), options);
  expect(report.recoveredLeases).toBe(1);
  expect(report.delivered).toBe(1);
});

it("skips inactive members, removed followers, and self-notifications", async () => {
  const repository = new NotificationRepository(fixture.db);
  await repository.accept(input("skip", ["alice", "mallory", "admin"]));
  await fixture.db
    .prepare(
      "INSERT INTO notification_subscriptions(workspace_id,principal_id,collection,created_at) VALUES (?,?,?,?)",
    )
    .bind("domain:general", "carol", "requests", now)
    .run();
  await fixture.db
    .prepare(
      "DELETE FROM notification_subscriptions WHERE workspace_id=? AND principal_id=?",
    )
    .bind("domain:general", "carol")
    .run();
  const policy = stubPolicy({ inactive: new Set(["mallory"]) });
  const report = await processNotifications(fixture.db, policy, options);
  expect(report.delivered).toBe(1);
  expect(report.skipped).toBe(2);
  const rows = (
    await fixture.db
      .prepare("SELECT recipient_id FROM notification_deliveries")
      .all<{ recipient_id: string }>()
  ).results;
  expect(rows.map((r) => r.recipient_id)).toEqual(["alice"]);
});

it("bounds work for oversized audiences", async () => {
  const repository = new NotificationRepository(fixture.db);
  const members = Array.from({ length: 1001 }, (_, i) => `user-${i}`);
  await repository.accept({
    ...input("huge", []),
    audience: { kind: "workspace-members" },
  });
  const report = await processNotifications(fixture.db, stubPolicy({ members }), {
    ...options,
    maxRecipients: 5,
  });
  expect(report.delivered).toBe(5);
  const status = await fixture.db
    .prepare("SELECT status FROM notification_events")
    .first<string>("status");
  expect(status).toBe("pending");
});

it("retries transient failures and delivers on the next tick", async () => {
  const repository = new NotificationRepository(fixture.db);
  await repository.accept(input("flaky", ["alice"]));
  const policy = stubPolicy({ failOnce: new Set(["alice"]) });
  const first = await processNotifications(fixture.db, policy, options);
  expect(first.retried).toBe(1);
  expect(first.delivered).toBe(0);
  now += 61_000;
  const second = await processNotifications(fixture.db, policy, options);
  expect(second.delivered).toBe(1);
});
