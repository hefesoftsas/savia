import { env } from "cloudflare:test";
import type { D1Migration } from "cloudflare:test";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "./context";
import {
  claimScheduledTriggerOccurrence,
  markScheduledTriggerOccurrenceDispatched,
} from "./services/scheduled-trigger-claims";

const mocks = vi.hoisted(() => ({
  getActiveScheduledTriggers: vi.fn(),
  resolveOrganizationBillingOptions: vi.fn(),
  maintainLocalExecutionHistory: vi.fn(),
  maintainFinishedCostReceipts: vi.fn(),
  policyStatus: vi.fn(),
  flushSaviaCollectionEventBatch: vi.fn(),
  getWithData: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("cron-parser", () => ({
  default: {
    parse: vi.fn((expression: string, options: { currentDate: Date }) => {
      if (expression === "invalid") throw new Error("invalid cron expression");
      return {
        prev: () => ({
          toDate: () =>
            new Date(
              Math.floor(options.currentDate.getTime() / 60_000) * 60_000,
            ),
        }),
      };
    }),
  },
}));

vi.mock("./db", () => ({
  createDatabase: vi.fn(() => ({})),
  getActiveScheduledTriggers: mocks.getActiveScheduledTriggers,
  resolveOrganizationBillingOptions: mocks.resolveOrganizationBillingOptions,
}));
vi.mock("./services/execution-retention", () => ({
  maintainLocalExecutionHistory: mocks.maintainLocalExecutionHistory,
}));
vi.mock("./services/cost-ledger-retention", () => ({
  maintainFinishedCostReceipts: mocks.maintainFinishedCostReceipts,
}));
vi.mock("./services/execution-policy", () => ({
  policyStatus: mocks.policyStatus,
}));
vi.mock("./services/collection-event-batches", () => ({
  flushSaviaCollectionEventBatch: mocks.flushSaviaCollectionEventBatch,
}));
vi.mock("./stores/workflow-store", () => ({
  WorkflowStore: class {
    getWithData = mocks.getWithData;
  },
}));
vi.mock("./services/workflow-executor", () => ({
  WorkflowExecutor: { execute: mocks.execute },
}));

import { handleScheduledEvent } from "./scheduled";

const testEnv = env as unknown as typeof env & {
  TEST_MIGRATIONS: D1Migration[];
  DB: D1Database;
};
const bindings = testEnv as unknown as Bindings;
async function workflowFingerprint(data: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(data)),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

const dueTrigger = {
  scheduledTrigger: {
    workflowId: "workflow-123",
    scheduleExpression: "* * * * *",
    active: true,
  },
  workflow: {
    id: "workflow-123",
    name: "Scheduled flow",
    trigger: "scheduled",
    runtime: "worker",
    enabled: true,
    organizationId: "organization-123",
  },
  organizationBilling: {},
};

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  vi.clearAllMocks();
  await bindings.DB.prepare(
    "DELETE FROM savia_scheduled_trigger_occurrences",
  ).run();
  await bindings.DB.prepare(
    "INSERT OR IGNORE INTO organizations (id, name) VALUES (?, ?)",
  )
    .bind("organization-123", "Test organization")
    .run();
  await bindings.DB.prepare(
    `INSERT OR IGNORE INTO workflows (id, name, trigger, organization_id)
     VALUES (?, ?, ?, ?)`,
  )
    .bind("workflow-123", "Scheduled flow", "scheduled", "organization-123")
    .run();
  await bindings.DB.prepare(
    `INSERT OR REPLACE INTO scheduled_triggers
       (workflow_id, schedule_expression, active, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?)`,
  )
    .bind("workflow-123", "* * * * *", Date.now(), Date.now())
    .run();
  mocks.getActiveScheduledTriggers.mockResolvedValue([dueTrigger]);
  mocks.resolveOrganizationBillingOptions.mockReturnValue({
    computeCredits: 0,
  });
  mocks.maintainLocalExecutionHistory.mockResolvedValue({ skipped: true });
  mocks.maintainFinishedCostReceipts.mockResolvedValue(undefined);
  mocks.policyStatus.mockResolvedValue({ executionsEnabled: true });
  mocks.flushSaviaCollectionEventBatch.mockResolvedValue(undefined);
  mocks.getWithData.mockResolvedValue({
    data: { trigger: "scheduled", runtime: "worker", nodes: [], edges: [] },
  });
  mocks.execute.mockResolvedValue({
    executionId: "ea2b8cb2-f7e1-5196-b141-231b7bfd0a94",
    execution: {
      id: "ea2b8cb2-f7e1-5196-b141-231b7bfd0a94",
      status: "completed",
    },
  });
});

describe("scheduled workflow cron dispatch", () => {
  it("dispatches a due occurrence once when two cron invocations overlap", async () => {
    const event = {
      cron: "* * * * *",
      scheduledTime: Date.now(),
      type: "scheduled",
    } as ScheduledEvent;

    await Promise.all([
      handleScheduledEvent(event, bindings, {} as ExecutionContext),
      handleScheduledEvent(event, bindings, {} as ExecutionContext),
    ]);

    expect(mocks.execute).toHaveBeenCalledOnce();
    const options = mocks.execute.mock.calls[0][0];
    expect(options.executionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(options.scheduledTrigger.scheduledTime).toBeLessThanOrEqual(
      Date.now(),
    );
  });

  it("recovers an expired durable Workflow occurrence after its cron minute passed", async () => {
    const currentMinute = Math.floor(Date.now() / 60_000) * 60_000;
    const firstMinute = currentMinute - 6 * 60_000;
    const workflowData = {
      trigger: "scheduled",
      runtime: "workflow",
      nodes: [],
      edges: [],
    };
    const fingerprint = await workflowFingerprint(workflowData);
    mocks.getWithData.mockResolvedValue({ data: workflowData });
    const staleClaim = await claimScheduledTriggerOccurrence(bindings, {
      workflowId: "workflow-123",
      scheduledTime: firstMinute,
      workflowFingerprint: fingerprint,
      now: firstMinute,
      leaseMs: 1_000,
    });
    expect(staleClaim.status).toBe("acquired");
    await markScheduledTriggerOccurrenceDispatched(bindings, {
      workflowId: "workflow-123",
      scheduledTime: firstMinute,
      leaseToken: staleClaim.leaseToken,
      workflowFingerprint: fingerprint,
      runtime: "workflow",
      now: firstMinute,
      leaseMs: 1_000,
    });
    await handleScheduledEvent(
      {
        cron: "* * * * *",
        scheduledTime: Date.now(),
        type: "scheduled",
      } as ScheduledEvent,
      bindings,
      {} as ExecutionContext,
    );

    const dispatchedOccurrences = mocks.execute.mock.calls.map(
      ([options]) => options.scheduledTrigger.scheduledTime,
    );
    expect(dispatchedOccurrences).toContain(firstMinute);
    expect(dispatchedOccurrences).toContain(currentMinute);
    const recovered = mocks.execute.mock.calls.find(
      ([options]) => options.scheduledTrigger.scheduledTime === firstMinute,
    );
    expect(recovered?.[0].executionId).toBe(staleClaim.executionId);
  });

  it("isolates an invalid schedule and continues dispatching other workflows", async () => {
    const invalidTrigger = {
      ...dueTrigger,
      scheduledTrigger: {
        ...dueTrigger.scheduledTrigger,
        workflowId: "invalid-workflow",
        scheduleExpression: "invalid",
      },
      workflow: { ...dueTrigger.workflow, id: "invalid-workflow" },
    };
    mocks.getActiveScheduledTriggers.mockResolvedValue([
      invalidTrigger,
      dueTrigger,
    ]);

    await handleScheduledEvent(
      {
        cron: "* * * * *",
        scheduledTime: Date.now(),
        type: "scheduled",
      } as ScheduledEvent,
      bindings,
      {} as ExecutionContext,
    );

    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.execute.mock.calls[0][0].workflow.id).toBe("workflow-123");
  });
});
