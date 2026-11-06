import type { D1Migration } from "cloudflare:test";
import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import type { SaviaCollectionEvent } from "@savia/studio-shared/savia-flows";
import {
  createDatabase,
  organizations,
  saviaCollectionTriggers,
  saviaCollectionEventBatchGroups,
  workflows,
} from "../db";
import type { ApiContext, Bindings } from "../context";
import { saviaCollectionSubscriptionRoutes } from "../routes/savia-collection-subscriptions";
import { saviaCollectionEventRoutes } from "../routes/savia-collection-events";

const batchMocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  execute: vi.fn(),
  policyStatus: vi.fn(),
  getWorkflow: vi.fn(),
  HostError: class extends Error {
    status: number;
    constructor(status: number, message = "Host authorization failed") {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("../nodes/savia/collection-client", () => ({
  callSaviaCollections: batchMocks.authorize,
  SaviaCollectionHostError: batchMocks.HostError,
}));
vi.mock("./workflow-executor", () => ({
  WorkflowExecutor: { execute: batchMocks.execute },
}));
vi.mock("./execution-policy", () => ({
  policyStatus: batchMocks.policyStatus,
}));
vi.mock("../stores/workflow-store", () => ({
  WorkflowStore: class {
    getWithData = batchMocks.getWorkflow;
    constructor() {}
  },
}));
import {
  enqueueSaviaCollectionEventBatch,
  flushSaviaCollectionEventBatch,
  MAX_SAVIA_COLLECTION_BATCH_EVENTS,
  MAX_PENDING_SAVIA_COLLECTION_EVENTS_PER_ORG,
  purgeSaviaCollectionEventBatchReceipts,
} from "./collection-event-batches";

const testEnv = env as Bindings & { TEST_MIGRATIONS: D1Migration[] };
const defaultQueueSend = vi.fn().mockResolvedValue(undefined);
const bindings = new Proxy(testEnv, {
  get(target, property, receiver) {
    if (property === "WORKFLOW_QUEUE") return { send: defaultQueueSend };
    return Reflect.get(target, property, receiver);
  },
}) as Bindings;
const database = createDatabase(bindings.DB);
const configCreatedAt = new Date("2026-10-01T00:00:00.000Z");
const flushWithClock = flushSaviaCollectionEventBatch as unknown as (
  env: Bindings,
  options: { now: number; clock: () => number },
) => Promise<{ skipped: string | false; groupKey?: string }>;

function event(id: string): SaviaCollectionEvent {
  return {
    id,
    tenant: "batch-tenant",
    collection: "Tasks",
    operation: "updated",
    recordId: `record-${id}`,
    recordVersion: 1,
    timestamp: "2026-10-13T12:00:00.000Z",
    before: { status: "open" },
    after: { status: "done" },
    changedFields: ["status"],
    actor: { kind: "user", id: "user-1" },
  };
}

const subscription = {
  workflowId: "batch-workflow",
  organizationId: "batch-tenant",
  principalId: "batch-user",
  configCreatedAt,
};

beforeEach(async () => {
  await bindings.DB.prepare(
    "DELETE FROM savia_collection_event_batch_groups WHERE workflow_id = ?",
  )
    .bind(subscription.workflowId)
    .run();
  await bindings.DB.prepare(
    "DELETE FROM savia_collection_admissions WHERE workflow_id = ?",
  )
    .bind(subscription.workflowId)
    .run();
  await database
    .insert(organizations)
    .values({ id: subscription.organizationId, name: "Batch Tenant" })
    .onConflictDoNothing();
  await database
    .insert(workflows)
    .values({
      id: subscription.workflowId,
      name: "Batch Workflow",
      organizationId: subscription.organizationId,
      trigger: "savia_collection_event",
    })
    .onConflictDoNothing();
  await database
    .delete(saviaCollectionTriggers)
    .where(eq(saviaCollectionTriggers.workflowId, subscription.workflowId));
  defaultQueueSend.mockReset().mockResolvedValue(undefined);
  batchMocks.authorize.mockReset();
  batchMocks.execute.mockReset();
  batchMocks.policyStatus.mockReset();
  batchMocks.getWorkflow.mockReset();
  batchMocks.policyStatus.mockResolvedValue({ executionsEnabled: true });
  batchMocks.getWorkflow.mockResolvedValue({
    enabled: true,
    data: {
      id: subscription.workflowId,
      name: "Batch Workflow",
      trigger: "savia_collection_event",
      nodes: [{ type: "savia-collection-event" }],
      edges: [],
    },
  });
  batchMocks.authorize.mockImplementation(async (_env, request, options) => ({
    authorized: true,
    event: {
      ...event("authorized"),
      id: request.eventId,
      tenant: options.tenant,
    },
  }));
  batchMocks.execute.mockResolvedValue({ execution: { error: null } });
});

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("durable Savia collection event batching", () => {
  it("wakes a committed batch through the queue after its batching window", async () => {
    await configureBatchSubscription();
    const send = vi.fn().mockResolvedValue(undefined);
    const queueBindings = {
      ...bindings,
      WORKFLOW_QUEUE: { send },
    } as unknown as Bindings;
    const now = Date.now();
    const queued = await enqueueSaviaCollectionEventBatch(
      queueBindings,
      event("queue-wakeup"),
      subscription,
      now,
    );
    expect(send).toHaveBeenCalledWith(
      { type: "savia.collection-batch.wakeup.v1", groupKey: queued.groupKey },
      { delaySeconds: 60 },
    );
    await enqueueSaviaCollectionEventBatch(
      queueBindings,
      event("same-batch"),
      subscription,
      now,
    );
    expect(send).toHaveBeenCalledTimes(1);

    await bindings.DB.prepare(
      "UPDATE savia_collection_event_batch_groups SET due_at = ?, next_attempt_at = ? WHERE workflow_id = ?",
    )
      .bind(now - 1, now - 1, subscription.workflowId)
      .run();
    const ack = vi.fn();
    const retry = vi.fn();
    const { handleQueueMessages } = await import("../queue");
    await handleQueueMessages(
      {
        messages: [
          {
            body: send.mock.calls[0][0],
            id: "wakeup",
            attempts: 1,
            ack,
            retry,
          },
        ],
      } as unknown as MessageBatch,
      queueBindings,
      {} as ExecutionContext,
    );
    const item = await bindings.DB.prepare(
      "SELECT status FROM savia_collection_event_batch_items WHERE event_id = ? AND workflow_id = ?",
    )
      .bind("queue-wakeup", subscription.workflowId)
      .first<{ status: string }>();
    expect(item?.status).toBe("accepted");
    expect(ack).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
  });

  it("returns wakeup failures as retryable and resends the same group's signal", async () => {
    await configureBatchSubscription();
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("queue unavailable"))
      .mockResolvedValue(undefined);
    const queueBindings = {
      ...bindings,
      WORKFLOW_QUEUE: { send },
    } as unknown as Bindings;
    const now = Date.now();
    const first = await enqueueSaviaCollectionEventBatch(
      queueBindings,
      event("lost-wakeup"),
      subscription,
      now,
    );
    expect(first).toMatchObject({ status: "wakeup-unavailable" });

    const retry = await enqueueSaviaCollectionEventBatch(
      queueBindings,
      event("lost-wakeup"),
      subscription,
      now + 10_000,
    );
    expect(retry).toMatchObject({ status: "queued", groupKey: first.groupKey });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toEqual({
      type: "savia.collection-batch.wakeup.v1",
      groupKey: first.groupKey,
    });
    expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
  });

  it("returns retryable HTTP failure when queue wakeup publication fails", async () => {
    await configureBatchSubscription();
    const secret = "a-secure-local-flows-bridge-secret-that-is-long-enough";
    const eventBody = {
      ...event("route-wakeup-failure"),
      before: null,
      after: null,
      changedFields: [],
    };
    const body = JSON.stringify(eventBody);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(body),
    );
    const bodyDigest = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const token = await new SignJWT({
      tenant: eventBody.tenant,
      eventId: eventBody.id,
      bodyDigest,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("savia")
      .setAudience("savia-flows-collection-events")
      .setIssuedAt()
      .setExpirationTime("30s")
      .sign(new TextEncoder().encode(secret));
    const send = vi.fn().mockRejectedValue(new Error("queue unavailable"));
    const queueBindings = {
      ...bindings,
      WORKFLOW_QUEUE: { send },
      SAVIA_FLOWS_BRIDGE_SECRET: secret,
    } as unknown as Bindings;
    const app = new Hono<ApiContext>();
    app.route("/internal/savia/collection-events", saviaCollectionEventRoutes);

    const response = await app.request(
      "/internal/savia/collection-events",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-savia-flows-event": token,
        },
        body,
      },
      queueBindings,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Savia collection batch queue is unavailable; retry delivery later",
    });
    const admission = await bindings.DB.prepare(
      "SELECT status FROM savia_collection_admissions WHERE event_id=? AND workflow_id=?",
    )
      .bind(eventBody.id, subscription.workflowId)
      .first<{ status: string }>();
    expect(admission?.status).toBe("wakeup_pending");
  });

  it("rejects batch admission explicitly when the workflow queue is absent", async () => {
    await configureBatchSubscription();
    const result = await enqueueSaviaCollectionEventBatch(
      { DB: bindings.DB },
      event("missing-queue"),
      subscription,
    );
    expect(result.status).toBe("wakeup-unavailable");
    const admission = await bindings.DB.prepare(
      "SELECT status FROM savia_collection_admissions WHERE event_id = ? AND workflow_id = ?",
    )
      .bind("missing-queue", subscription.workflowId)
      .first();
    expect(admission).toBeNull();
  });

  it("enqueues targeted wakeups for manager-retried failed groups", async () => {
    const configuredAt = await configureBatchSubscription();
    const groupKey = "failed-group-retry-test";
    const now = Date.now();
    await database.insert(saviaCollectionEventBatchGroups).values({
      groupKey,
      bucketKey: "failed-bucket-retry-test",
      workflowId: subscription.workflowId,
      organizationId: subscription.organizationId,
      configCreatedAt: configuredAt.getTime(),
      chunkIndex: 0,
      status: "failed",
      dueAt: now - 60_000,
      nextAttemptAt: now,
      attempts: 5,
      leaseToken: null,
      leaseUntil: 0,
      lastError: "failed",
      createdAt: now - 60_000,
      updatedAt: now - 60_000,
      finishedAt: now - 60_000,
    });
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("queue temporarily unavailable"))
      .mockResolvedValue(undefined);
    const app = new Hono<ApiContext>();
    app.use("*", async (c, next) => {
      c.set("saviaBridge", true);
      c.set("organizationId", subscription.organizationId);
      c.set("jwtPayload", {
        sub: "batch-admin",
        organization: { id: subscription.organizationId, role: "admin" },
      } as never);
      await next();
    });
    app.route("/:organizationId/workflows", saviaCollectionSubscriptionRoutes);
    const retryUrl = `/${subscription.organizationId}/workflows/${subscription.workflowId}/savia-trigger/batches/retry`;
    const absentQueue = await app.request(
      retryUrl,
      { method: "POST" },
      { DB: bindings.DB } as unknown as Bindings,
    );
    expect(absentQueue.status).toBe(503);
    expect(await absentQueue.json()).toMatchObject({
      error: "Collection batch queue is unavailable; no batches were retried",
    });

    const failedSend = await app.request(
      retryUrl,
      { method: "POST" },
      { ...bindings, WORKFLOW_QUEUE: { send } } as unknown as Bindings,
    );
    expect(failedSend.status).toBe(503);
    expect(await failedSend.json()).toMatchObject({ retried: 0, failed: 1 });
    let group = await bindings.DB.prepare(
      "SELECT status FROM savia_collection_event_batch_groups WHERE group_key = ?",
    )
      .bind(groupKey)
      .first<{ status: string }>();
    expect(group?.status).toBe("failed");

    const response = await app.request(
      retryUrl,
      { method: "POST" },
      { ...bindings, WORKFLOW_QUEUE: { send } } as unknown as Bindings,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ retried: 1 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]).toEqual([
      { type: "savia.collection-batch.wakeup.v1", groupKey },
    ]);
    group = await bindings.DB.prepare(
      "SELECT status FROM savia_collection_event_batch_groups WHERE group_key = ?",
    )
      .bind(groupKey)
      .first<{ status: string }>();
    expect(group?.status).toBe("pending");
  });

  it("wakes the requested batch even when another batch is older", async () => {
    await configureBatchSubscription();
    const now = Date.now();
    await enqueueSaviaCollectionEventBatch(
      bindings,
      event("older"),
      subscription,
      now - 180_000,
    );
    const requested = await enqueueSaviaCollectionEventBatch(
      bindings,
      event("requested"),
      subscription,
      now - 120_000,
    );
    const ack = vi.fn();
    const { handleQueueMessages } = await import("../queue");
    await handleQueueMessages(
      {
        messages: [
          {
            body: {
              type: "savia.collection-batch.wakeup.v1",
              groupKey: requested.groupKey,
            },
            id: "wakeup",
            attempts: 1,
            ack,
            retry: vi.fn(),
          },
        ],
      } as unknown as MessageBatch,
      bindings,
      {} as ExecutionContext,
    );
    const statuses = await bindings.DB.prepare(
      "SELECT event_id, status FROM savia_collection_event_batch_items WHERE workflow_id = ? ORDER BY event_id",
    )
      .bind(subscription.workflowId)
      .all<{ event_id: string; status: string }>();
    expect(statuses.results).toEqual([
      { event_id: "older", status: "pending" },
      { event_id: "requested", status: "accepted" },
    ]);
    expect(ack).toHaveBeenCalledOnce();
  });

  it("retries a wakeup when the batch encounters a transient failure", async () => {
    await configureBatchSubscription();
    const now = Date.now() - 61_000;
    const queued = await enqueueSaviaCollectionEventBatch(
      bindings,
      event("retry-wakeup"),
      subscription,
      now,
    );
    batchMocks.authorize.mockRejectedValueOnce(new Error("host unavailable"));
    const ack = vi.fn();
    const retry = vi.fn();
    const { handleQueueMessages } = await import("../queue");
    await handleQueueMessages(
      {
        messages: [
          {
            body: {
              type: "savia.collection-batch.wakeup.v1",
              groupKey: queued.groupKey,
            },
            id: "wakeup",
            attempts: 1,
            ack,
            retry,
          },
        ],
      } as unknown as MessageBatch,
      bindings,
      {} as ExecutionContext,
    );
    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledWith({ delaySeconds: 60 });
    const group = await bindings.DB.prepare(
      "SELECT status FROM savia_collection_event_batch_groups WHERE workflow_id = ?",
    )
      .bind(subscription.workflowId)
      .first<{ status: string }>();
    expect(group?.status).toBe("pending");
  });

  it("deduplicates concurrent source event deliveries atomically", async () => {
    expect(
      await bindings.DB.prepare("SELECT id FROM workflows WHERE id = ?")
        .bind(subscription.workflowId)
        .first(),
    ).toBeTruthy();
    const duplicate = event("same-event");
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        enqueueSaviaCollectionEventBatch(
          bindings,
          duplicate,
          subscription,
          Date.UTC(2026, 9, 13, 12, 0, 5),
        ),
      ),
    );

    expect(results.every((result) => result.status === "queued")).toBe(true);
    const items = await bindings.DB.prepare(
      "SELECT COUNT(*) AS count FROM savia_collection_event_batch_items WHERE workflow_id = ? AND event_id = ?",
    )
      .bind(subscription.workflowId, duplicate.id)
      .first<{ count: number }>();
    const groups = await bindings.DB.prepare(
      "SELECT COUNT(*) AS count FROM savia_collection_event_batch_groups WHERE workflow_id = ?",
    )
      .bind(subscription.workflowId)
      .first<{ count: number }>();
    expect(items?.count).toBe(1);
    expect(groups?.count).toBe(1);
    const stored = await bindings.DB.prepare(
      "SELECT event_json FROM savia_collection_event_batch_items WHERE workflow_id = ? AND event_id = ?",
    )
      .bind(subscription.workflowId, duplicate.id)
      .first<{ event_json: string }>();
    const receipt = JSON.parse(stored!.event_json);
    expect(receipt).not.toHaveProperty("before");
    expect(receipt).not.toHaveProperty("after");
  });

  it("rejects oversized receipt metadata before creating an admission", async () => {
    const oversized = {
      ...event("oversized-receipt"),
      changedFields: ["field-" + "x".repeat(16 * 1024)],
    };
    const result = await enqueueSaviaCollectionEventBatch(
      bindings,
      oversized,
      subscription,
      Date.UTC(2026, 9, 13, 12, 0, 5),
    );
    const admission = await bindings.DB.prepare(
      "SELECT event_id FROM savia_collection_admissions WHERE event_id = ? AND workflow_id = ?",
    )
      .bind(oversized.id, subscription.workflowId)
      .first();
    expect(result.status).toBe("too-large");
    expect(admission).toBeNull();
  });

  it("rejects new admissions at the per-organization pending cap, including failed backlog", async () => {
    const now = Date.UTC(2026, 9, 13, 12, 0, 5);
    await bindings.DB.prepare(
      `WITH RECURSIVE groups(n) AS (
         SELECT 0 UNION ALL SELECT n + 1 FROM groups WHERE n < 99
       )
       INSERT INTO savia_collection_event_batch_groups
         (group_key, bucket_key, workflow_id, organization_id, config_created_at,
          chunk_index, status, due_at, next_attempt_at, created_at, updated_at)
       SELECT 'cap-group-' || n, 'cap-bucket-' || n, ?, ?, ?, 0,
         CASE WHEN n < 50 THEN 'failed' ELSE 'pending' END, ?, ?, ?, ?
       FROM groups`,
    )
      .bind(
        subscription.workflowId,
        subscription.organizationId,
        configCreatedAt.getTime(),
        now,
        now,
        now,
        now,
      )
      .run();
    for (let batch = 0; batch < 5; batch += 1) {
      const offset = batch * 1000;
      await bindings.DB.prepare(
        `WITH RECURSIVE events(n) AS (
           SELECT 0 UNION ALL SELECT n + 1 FROM events WHERE n < 999
         )
         INSERT INTO savia_collection_event_batch_items
           (event_id, workflow_id, bucket_key, chunk_index, group_key,
            event_json, status, created_at, updated_at)
         SELECT 'cap-event-' || (n + ?), ?,
           'cap-bucket-' || CAST(CAST((n + ?) / ? AS INTEGER) AS TEXT),
           0, 'cap-group-' || CAST(CAST((n + ?) / ? AS INTEGER) AS TEXT),
           '{}', 'pending', ?, ? FROM events`,
      )
        .bind(
          offset,
          subscription.workflowId,
          offset,
          MAX_SAVIA_COLLECTION_BATCH_EVENTS,
          offset,
          MAX_SAVIA_COLLECTION_BATCH_EVENTS,
          now,
          now,
        )
        .run();
    }

    const result = await enqueueSaviaCollectionEventBatch(
      bindings,
      event("over-cap-event"),
      subscription,
      now,
    );
    const pending = await bindings.DB.prepare(
      `SELECT COUNT(*) AS count FROM savia_collection_event_batch_items item
       INNER JOIN savia_collection_event_batch_groups batch ON batch.group_key = item.group_key
       WHERE batch.organization_id = ? AND item.status = 'pending'
         AND batch.status IN ('pending', 'processing', 'failed')`,
    )
      .bind(subscription.organizationId)
      .first<{ count: number }>();
    const admission = await bindings.DB.prepare(
      "SELECT event_id FROM savia_collection_admissions WHERE event_id = ? AND workflow_id = ?",
    )
      .bind("over-cap-event", subscription.workflowId)
      .first();

    expect(result.status).toBe("backpressure");
    expect(pending?.count).toBe(MAX_PENDING_SAVIA_COLLECTION_EVENTS_PER_ORG);
    expect(admission).toBeNull();
  });

  it("assigns concurrent events to chunks of at most fifty", async () => {
    const receivedAt = Date.UTC(2026, 9, 13, 12, 0, 5);
    await Promise.all(
      Array.from(
        { length: MAX_SAVIA_COLLECTION_BATCH_EVENTS + 1 },
        (_, index) =>
          enqueueSaviaCollectionEventBatch(
            bindings,
            event(`event-${index}`),
            subscription,
            receivedAt,
          ),
      ),
    );

    const chunks = await bindings.DB.prepare(
      `SELECT item.chunk_index, COUNT(*) AS count
       FROM savia_collection_event_batch_items item
       WHERE item.workflow_id = ?
       GROUP BY item.chunk_index ORDER BY item.chunk_index`,
    )
      .bind(subscription.workflowId)
      .all<{ chunk_index: number; count: number }>();
    expect(chunks.results.map((chunk) => chunk.count)).toEqual([50, 1]);
    expect(chunks.results.every((chunk) => chunk.count <= 50)).toBe(true);
  });

  it("retains accepted receipts for at least ninety days", async () => {
    const now = Date.UTC(2026, 9, 13, 12);
    await enqueueSaviaCollectionEventBatch(
      bindings,
      event("old-receipt"),
      subscription,
      now - 91 * 24 * 60 * 60 * 1000,
    );
    await bindings.DB.prepare(
      `UPDATE savia_collection_event_batch_items SET status = 'accepted', finished_at = ?
       WHERE event_id = 'old-receipt' AND workflow_id = ?`,
    )
      .bind(now - 89 * 24 * 60 * 60 * 1000, subscription.workflowId)
      .run();
    expect(
      await purgeSaviaCollectionEventBatchReceipts(bindings, { now }),
    ).toBe(0);

    await bindings.DB.prepare(
      `UPDATE savia_collection_event_batch_items SET finished_at = ?
       WHERE event_id = 'old-receipt' AND workflow_id = ?`,
    )
      .bind(now - 91 * 24 * 60 * 60 * 1000, subscription.workflowId)
      .run();
    expect(
      await purgeSaviaCollectionEventBatchReceipts(bindings, { now }),
    ).toBe(1);
  });

  it("reauthorizes every source event and skips events revoked by the host", async () => {
    await configureBatchSubscription();
    const now = Date.UTC(2026, 9, 13, 12, 0, 5);
    await enqueueSaviaCollectionEventBatch(
      bindings,
      event("revoked-source"),
      subscription,
      now,
    );
    batchMocks.authorize.mockRejectedValueOnce(
      new batchMocks.HostError(403, "Access revoked"),
    );

    const result = await flushSaviaCollectionEventBatch(bindings, {
      now: now + 60_000,
    });
    const item = await bindings.DB.prepare(
      "SELECT status FROM savia_collection_event_batch_items WHERE event_id = ? AND workflow_id = ?",
    )
      .bind("revoked-source", subscription.workflowId)
      .first<{ status: string }>();

    expect(result.skipped).toBe(false);
    expect(batchMocks.authorize).toHaveBeenCalledTimes(1);
    expect(batchMocks.execute).not.toHaveBeenCalled();
    expect(item?.status).toBe("skipped");
  });

  it("does not dispatch or mutate items after authorization outlives the lease", async () => {
    await configureBatchSubscription();
    const baseNow = Date.UTC(2026, 9, 13, 12, 0, 5);
    await enqueueSaviaCollectionEventBatch(
      bindings,
      event("expired-lease-source"),
      subscription,
      baseNow,
    );
    let clockNow = baseNow + 60_000;
    batchMocks.authorize.mockImplementationOnce(
      async (_env, request, options) => {
        clockNow += 6 * 60_000;
        return {
          authorized: true,
          event: { ...event(request.eventId), tenant: options.tenant },
        };
      },
    );

    await flushWithClock(bindings, {
      now: baseNow + 60_000,
      clock: () => clockNow,
    });
    const item = await bindings.DB.prepare(
      "SELECT status, execution_id FROM savia_collection_event_batch_items WHERE event_id = ? AND workflow_id = ?",
    )
      .bind("expired-lease-source", subscription.workflowId)
      .first<{ status: string; execution_id: string | null }>();

    expect(batchMocks.execute).not.toHaveBeenCalled();
    expect(item).toEqual({ status: "pending", execution_id: null });
  });

  it("does not dispatch or mutate items after another worker replaces the lease", async () => {
    await configureBatchSubscription();
    const baseNow = Date.UTC(2026, 9, 13, 12, 0, 5);
    await enqueueSaviaCollectionEventBatch(
      bindings,
      event("replaced-lease-source"),
      subscription,
      baseNow,
    );
    const now = baseNow + 60_000;
    let releaseAuthorization!: (result: {
      authorized: true;
      event: SaviaCollectionEvent;
    }) => void;
    batchMocks.authorize.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseAuthorization = resolve;
        }),
    );
    const flush = flushWithClock(bindings, { now, clock: () => now });
    await vi.waitFor(() => expect(releaseAuthorization).toBeTypeOf("function"));
    await bindings.DB.prepare(
      `UPDATE savia_collection_event_batch_groups
       SET lease_token = 'replacement-worker', lease_until = ?
       WHERE workflow_id = ? AND status = 'processing'`,
    )
      .bind(now + 10 * 60_000, subscription.workflowId)
      .run();
    releaseAuthorization({
      authorized: true,
      event: event("replaced-lease-source"),
    });

    await flush;
    const item = await bindings.DB.prepare(
      "SELECT status, execution_id FROM savia_collection_event_batch_items WHERE event_id = ? AND workflow_id = ?",
    )
      .bind("replaced-lease-source", subscription.workflowId)
      .first<{ status: string; execution_id: string | null }>();
    const group = await bindings.DB.prepare(
      "SELECT lease_token, status FROM savia_collection_event_batch_groups WHERE workflow_id = ?",
    )
      .bind(subscription.workflowId)
      .first<{ lease_token: string; status: string }>();

    expect(batchMocks.execute).not.toHaveBeenCalled();
    expect(item).toEqual({ status: "pending", execution_id: null });
    expect(group).toEqual({
      lease_token: "replacement-worker",
      status: "processing",
    });
  });

  it("does not accept an item after another worker replaces the lease during execution", async () => {
    await configureBatchSubscription();
    const baseNow = Date.UTC(2026, 9, 13, 12, 0, 5);
    await enqueueSaviaCollectionEventBatch(
      bindings,
      event("execution-lease-source"),
      subscription,
      baseNow,
    );
    const now = baseNow + 60_000;
    let releaseExecution!: (result: { execution: { error: null } }) => void;
    batchMocks.execute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseExecution = resolve;
        }),
    );
    const flush = flushWithClock(bindings, { now, clock: () => now });
    await vi.waitFor(() => expect(releaseExecution).toBeTypeOf("function"));
    await bindings.DB.prepare(
      `UPDATE savia_collection_event_batch_groups
       SET lease_token = 'replacement-worker', lease_until = ?
       WHERE workflow_id = ? AND status = 'processing'`,
    )
      .bind(now + 10 * 60_000, subscription.workflowId)
      .run();
    releaseExecution({ execution: { error: null } });

    await flush;
    const item = await bindings.DB.prepare(
      "SELECT status, execution_id FROM savia_collection_event_batch_items WHERE event_id = ? AND workflow_id = ?",
    )
      .bind("execution-lease-source", subscription.workflowId)
      .first<{ status: string; execution_id: string | null }>();
    const group = await bindings.DB.prepare(
      "SELECT lease_token, status FROM savia_collection_event_batch_groups WHERE workflow_id = ?",
    )
      .bind(subscription.workflowId)
      .first<{ lease_token: string; status: string }>();

    expect(item?.status).toBe("pending");
    expect(item?.execution_id).toBeTruthy();
    expect(group).toEqual({
      lease_token: "replacement-worker",
      status: "processing",
    });
  });

  it("skips a queued batch when its subscription configuration changed", async () => {
    const configuredAt = await configureBatchSubscription();
    const now = Date.UTC(2026, 9, 13, 12, 0, 5);
    await enqueueSaviaCollectionEventBatch(
      bindings,
      event("config-changed-source"),
      { ...subscription, configCreatedAt: configuredAt },
      now,
    );
    await database
      .update(saviaCollectionTriggers)
      .set({
        config: JSON.stringify({
          collection: "Tasks",
          operations: ["updated"],
          ignoreOwnChanges: true,
          batchWindowSeconds: 0,
        }),
        createdAt: new Date(configuredAt.getTime() + 1),
      })
      .where(eq(saviaCollectionTriggers.workflowId, subscription.workflowId));

    await flushSaviaCollectionEventBatch(bindings, { now: now + 60_000 });
    const item = await bindings.DB.prepare(
      "SELECT status FROM savia_collection_event_batch_items WHERE event_id = ? AND workflow_id = ?",
    )
      .bind("config-changed-source", subscription.workflowId)
      .first<{ status: string }>();
    expect(batchMocks.authorize).not.toHaveBeenCalled();
    expect(item?.status).toBe("skipped");
  });

  it("backs off transient failures and marks the group failed after five attempts", async () => {
    await configureBatchSubscription();
    const baseNow = Date.UTC(2026, 9, 13, 12, 0, 5);
    await enqueueSaviaCollectionEventBatch(
      bindings,
      event("retry-source"),
      subscription,
      baseNow,
    );
    batchMocks.execute.mockRejectedValue(
      new Error("temporary executor outage"),
    );

    let now = baseNow + 60_000;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await flushSaviaCollectionEventBatch(bindings, { now });
      expect(batchMocks.authorize).toHaveBeenCalled();
      expect(batchMocks.execute).toHaveBeenCalled();
      const group = await bindings.DB.prepare(
        "SELECT status, attempts, next_attempt_at FROM savia_collection_event_batch_groups WHERE workflow_id = ?",
      )
        .bind(subscription.workflowId)
        .first<{ status: string; attempts: number; next_attempt_at: number }>();
      if (attempt < 4) {
        expect(group?.status).toBe("pending");
        expect(group?.attempts).toBe(attempt + 1);
        now = group!.next_attempt_at + 1;
      } else {
        expect(group?.status).toBe("failed");
        expect(group?.attempts).toBe(5);
      }
    }
  });

  it("reuses frozen child execution IDs when projections repack differently on retry", async () => {
    await configureBatchSubscription();
    const baseNow = Date.UTC(2026, 9, 13, 12, 0, 5);
    for (const id of ["frozen-a", "frozen-b", "frozen-c"]) {
      await enqueueSaviaCollectionEventBatch(
        bindings,
        event(id),
        subscription,
        baseNow,
      );
    }
    const largeProjection = (id: string, size: number) => ({
      ...event(id),
      after: { value: "x".repeat(size) },
    });
    batchMocks.authorize.mockImplementation(async (_env, request, options) => ({
      authorized: true,
      event: {
        ...largeProjection(request.eventId, 300_000),
        tenant: options.tenant,
      },
    }));
    batchMocks.execute.mockRejectedValueOnce(
      new Error("connection lost after workflow submission"),
    );

    await flushSaviaCollectionEventBatch(bindings, { now: baseNow + 60_000 });
    const assigned = await bindings.DB.prepare(
      `SELECT event_id, execution_id FROM savia_collection_event_batch_items
       WHERE workflow_id = ? ORDER BY event_id`,
    )
      .bind(subscription.workflowId)
      .all<{ event_id: string; execution_id: string | null }>();
    expect(assigned.results.every((item) => item.execution_id)).toBe(true);
    const stableIds = new Set(
      assigned.results.map((item) => item.execution_id),
    );
    expect(stableIds.size).toBe(2);

    batchMocks.authorize.mockImplementation(async (_env, request, options) => ({
      authorized: true,
      event: {
        ...largeProjection(request.eventId, 1),
        tenant: options.tenant,
      },
    }));
    batchMocks.execute.mockResolvedValue({ execution: { error: null } });
    const group = await bindings.DB.prepare(
      "SELECT next_attempt_at FROM savia_collection_event_batch_groups WHERE workflow_id = ?",
    )
      .bind(subscription.workflowId)
      .first<{ next_attempt_at: number }>();
    await flushSaviaCollectionEventBatch(bindings, {
      now: group!.next_attempt_at + 1,
    });

    const retriedIds = new Set(
      batchMocks.execute.mock.calls
        .slice(1)
        .map(([options]) => options.executionId),
    );
    expect(retriedIds).toEqual(stableIds);
    expect(batchMocks.execute.mock.calls[1][0].executionId).toBe(
      batchMocks.execute.mock.calls[0][0].executionId,
    );
  });

  it("defers quota failures for an hour without consuming retry attempts", async () => {
    await configureBatchSubscription();
    const now = Date.UTC(2026, 9, 13, 12, 0, 5);
    await enqueueSaviaCollectionEventBatch(
      bindings,
      event("quota-source"),
      subscription,
      now,
    );
    batchMocks.execute.mockResolvedValue({
      execution: { error: "Organization compute credit limit reached" },
    });

    await flushSaviaCollectionEventBatch(bindings, { now: now + 60_000 });
    const group = await bindings.DB.prepare(
      "SELECT status, attempts, next_attempt_at FROM savia_collection_event_batch_groups WHERE workflow_id = ?",
    )
      .bind(subscription.workflowId)
      .first<{ status: string; attempts: number; next_attempt_at: number }>();
    expect(group?.status).toBe("pending");
    expect(group?.attempts).toBe(0);
    expect(group?.next_attempt_at).toBeGreaterThanOrEqual(
      now + 60_000 + 60 * 60 * 1000,
    );
  });
});

async function configureBatchSubscription(): Promise<Date> {
  const configuredAt = new Date(configCreatedAt);
  await database.insert(saviaCollectionTriggers).values({
    workflowId: subscription.workflowId,
    organizationId: subscription.organizationId,
    principalId: subscription.principalId,
    config: JSON.stringify({
      collection: "Tasks",
      operations: ["updated"],
      ignoreOwnChanges: true,
      batchWindowSeconds: 60,
    }),
    active: true,
    createdAt: configuredAt,
    updatedAt: configuredAt,
  });
  return configuredAt;
}
