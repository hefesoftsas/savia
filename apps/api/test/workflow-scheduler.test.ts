import { env } from "cloudflare:workers";
import { beforeAll, expect, it, vi } from "vitest";
vi.mock("../src/whatsapp/inbound-processor", () => ({
  drainWhatsappInbox: vi.fn(async () => ({ processed: 0, failed: 0 })),
  processWhatsappInbox: vi.fn(async () => ({ processed: 0, failed: 0 })),
}));
import {
  drainWhatsappInbox,
  processWhatsappInbox,
} from "../src/whatsapp/inbound-processor";
vi.mock("../src/bookings/jobs", () => ({
  runBookingJobs: vi.fn(async () => ({ completed: 0, failed: 0, skipped: 0 })),
}));
import { runBookingJobs } from "../src/bookings/jobs";
vi.mock("../src/workflows", () => ({
  runScheduledWorkflows: vi.fn(async () => undefined),
}));
vi.mock("../src/notifications", () => ({
  runScheduledNotifications: vi.fn(async () => ({
    claimed: 0,
    delivered: 0,
    skipped: 0,
    failed: 0,
    retried: 0,
    recoveredLeases: 0,
  })),
}));
vi.mock("../src/personal-integrations/jira-privacy-runtime", () => ({
  runJiraPrivacyMaintenance: vi.fn(async () => undefined),
}));
vi.mock("../src/whatsapp/channel-cleanup", () => ({
  cleanupChannelState: vi.fn(async () => undefined),
}));
vi.mock("../src/whatsapp/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/whatsapp/queue")>();
  return {
    ...actual,
    recoverWhatsappScopes: vi.fn(async () => []),
    wakeWhatsappScope: vi.fn(async () => undefined),
  };
});
import { cleanupChannelState } from "../src/whatsapp/channel-cleanup";
import { runJiraPrivacyMaintenance } from "../src/personal-integrations/jira-privacy-runtime";
import worker from "../src/index";
import { runScheduledWorkflows } from "../src/workflows";
import {
  recoverWhatsappScopes,
  wakeWhatsappScope,
} from "../src/whatsapp/queue";
beforeAll(async () => {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS studio_audit(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,action TEXT NOT NULL,object_name TEXT NOT NULL,record_id TEXT,detail TEXT NOT NULL,created_at TEXT NOT NULL)",
  ).run();
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS studio_record_history(tenant_id TEXT NOT NULL,object_name TEXT NOT NULL,record_id TEXT NOT NULL,version INTEGER NOT NULL,expires_at TEXT NOT NULL,PRIMARY KEY(tenant_id,object_name,record_id,version))",
  ).run();
});
it("runs scheduled workflows without the legacy CRM synchronization worker", async () => {
  await expect(
    worker.scheduled({} as ScheduledController, env),
  ).resolves.toBeUndefined();
  expect(runBookingJobs).toHaveBeenCalledTimes(1);
  expect(runScheduledWorkflows).toHaveBeenCalledTimes(1);
  expect(vi.mocked(runScheduledWorkflows).mock.calls[0][0] === env.DB).toBe(
    true,
  );
});
it("ticks workflows in preview without activating external CRM synchronization", async () => {
  vi.clearAllMocks();
  await expect(
    worker.scheduled({} as ScheduledController, {
      ...env,
      SAVIA_WORKFLOW_ONLY_SCHEDULE: "true",
    }),
  ).resolves.toBeUndefined();
  expect(runBookingJobs).toHaveBeenCalledTimes(1);
  expect(runScheduledWorkflows).toHaveBeenCalledTimes(1);
});

import { createApiRuntime } from "../src/runtime";
it.each(["true", "false"])(
  "recovers durable WhatsApp replies in scheduler mode %s",
  async (mode) => {
    vi.clearAllMocks();
    await worker.scheduled({} as ScheduledController, {
      ...env,
      SAVIA_WORKFLOW_ONLY_SCHEDULE: mode,
      WHATSAPP_PROCESSING_MODE: "scheduled",
      WHATSAPP_META_APP_SECRET: "test-app-secret",
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: "test-verify-token",
    });
    expect(drainWhatsappInbox).toHaveBeenCalledTimes(1);
    expect(processWhatsappInbox).not.toHaveBeenCalled();
  },
);
it("passes the native webhook transport to scheduled workflows", async () => {
  vi.clearAllMocks();
  const workflowFetch = vi.fn<typeof fetch>();
  const runtime = createApiRuntime(
    {
      ...env,
      SAVIA_WORKFLOW_ONLY_SCHEDULE: "true",
      CRM_INTEGRATION_KEY: "test-key",
    },
    { workflowFetch },
  );
  await runtime.scheduled();
  expect(runBookingJobs).toHaveBeenCalledTimes(1);
  expect(runScheduledWorkflows).toHaveBeenCalledTimes(1);
  const call = vi.mocked(runScheduledWorkflows).mock.calls[0];
  expect(call[0] === env.DB).toBe(true);
  expect(call[1]).toBe("test-key");
  expect(call[2] === workflowFetch).toBe(true);
  expect(workflowFetch).not.toHaveBeenCalled();
});

it("prunes domain audit history on the preview scheduled tick", async () => {
  await env.DB.batch(
    Array.from({ length: 201 }, (_, i) =>
      env.DB.prepare(
        "INSERT INTO studio_audit(id,tenant_id,action,object_name,detail,created_at) VALUES (?,?,?,?,?,?)",
      ).bind(
        `scheduled-${String(i).padStart(3, "0")}`,
        "tenant:99004",
        "object.updated",
        "example",
        "{}",
        "2026-09-24T12:00:00.000Z",
      ),
    ),
  );

  await worker.scheduled({} as ScheduledController, {
    ...env,
    SAVIA_WORKFLOW_ONLY_SCHEDULE: "true",
  });

  const count = await env.DB.prepare(
    "SELECT count(*) AS total FROM studio_audit WHERE tenant_id='tenant:99004'",
  ).first<{ total: number }>();
  expect(count?.total).toBe(200);
  expect(
    await env.DB.prepare(
      "SELECT id FROM studio_audit WHERE id='scheduled-000'",
    ).first(),
  ).toBeNull();
});

it.each(["true", "false"])(
  "runs Jira privacy maintenance in schedule mode %s",
  async (mode) => {
    vi.clearAllMocks();
    await worker.scheduled({} as ScheduledController, {
      ...env,
      SAVIA_WORKFLOW_ONLY_SCHEDULE: mode,
      NANGO_JIRA_INTEGRATION_ID: "jira-prod",
      NANGO_JIRA_REPORTING_CONNECTION_ID: "owner-prod",
    });
    expect(runJiraPrivacyMaintenance).toHaveBeenCalledTimes(1);
    const call = vi.mocked(runJiraPrivacyMaintenance).mock.calls[0];
    expect(call[0] === env.DB).toBe(true);
    expect(call[1]).toMatchObject({
      jiraIntegrationId: "jira-prod",
      jiraReportingConnectionId: "owner-prod",
    });
  },
);

it("surfaces Jira maintenance failures while other scheduled jobs still run", async () => {
  vi.clearAllMocks();
  vi.mocked(runJiraPrivacyMaintenance).mockRejectedValueOnce(
    new Error("Jira privacy maintenance failed"),
  );
  await expect(
    worker.scheduled({} as ScheduledController, {
      ...env,
      SAVIA_WORKFLOW_ONLY_SCHEDULE: "true",
    }),
  ).rejects.toThrow("Scheduled jobs failed");
  expect(runBookingJobs).toHaveBeenCalledTimes(1);
  expect(runScheduledWorkflows).toHaveBeenCalledTimes(1);
});

it("surfaces booking job failures while other scheduled jobs still run", async () => {
  vi.clearAllMocks();
  vi.mocked(runBookingJobs).mockRejectedValueOnce(
    new Error("Booking jobs failed"),
  );
  await expect(
    worker.scheduled({} as ScheduledController, {
      ...env,
      SAVIA_WORKFLOW_ONLY_SCHEDULE: "true",
    }),
  ).rejects.toThrow("Scheduled jobs failed");
  expect(runScheduledWorkflows).toHaveBeenCalledTimes(1);
  expect(runJiraPrivacyMaintenance).toHaveBeenCalledTimes(1);
});

it("cleans private WhatsApp media even after webhook secrets are removed", async () => {
  vi.clearAllMocks();
  const key = "whatsapp/inbound/2026-09-01/7/expired";
  const documents = {
    list: vi.fn().mockResolvedValue({
      objects: [{ key, uploaded: new Date("2026-09-01T00:00:00Z") }],
    }),
    delete: vi.fn(),
  } as unknown as R2Bucket;
  await worker.scheduled(
    {
      scheduledTime: Date.parse("2026-10-07T12:05:00.000Z"),
    } as ScheduledController,
    {
      ...env,
      WHATSAPP_PROCESSING_MODE: "events",
      DOCUMENTS: documents,
      SAVIA_WORKFLOW_ONLY_SCHEDULE: "true",
      WHATSAPP_META_APP_SECRET: undefined,
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: undefined,
    },
  );
  expect(documents.delete).toHaveBeenCalledWith([key]);
  expect(drainWhatsappInbox).not.toHaveBeenCalled();
});

it("skips WhatsApp media cleanup off the event recovery boundary while running other minute jobs", async () => {
  vi.clearAllMocks();
  const documents = {
    list: vi.fn().mockResolvedValue({ objects: [] }),
    delete: vi.fn(),
  } as unknown as R2Bucket;

  await worker.scheduled(
    {
      scheduledTime: Date.parse("2026-10-07T12:06:00.000Z"),
    } as ScheduledController,
    {
      ...env,
      WHATSAPP_PROCESSING_MODE: "events",
      DOCUMENTS: documents,
      SAVIA_WORKFLOW_ONLY_SCHEDULE: "true",
    },
  );

  expect(documents.list).not.toHaveBeenCalled();
  expect(runBookingJobs).toHaveBeenCalledTimes(1);
  expect(runScheduledWorkflows).toHaveBeenCalledTimes(1);
});

it("recovers event-driven WhatsApp scopes on the five-minute boundary and attempts every wake", async () => {
  vi.clearAllMocks();
  vi.mocked(recoverWhatsappScopes).mockResolvedValueOnce([
    { connectionId: "connection-1", contact: "+15550000001" },
    { connectionId: "connection-1", contact: "+15550000002" },
  ]);
  vi.mocked(wakeWhatsappScope)
    .mockRejectedValueOnce(new Error("dispatcher unavailable"))
    .mockResolvedValueOnce(undefined);

  await expect(
    worker.scheduled(
      {
        scheduledTime: Date.parse("2026-10-07T12:05:00.000Z"),
      } as ScheduledController,
      {
        ...env,
        WHATSAPP_PROCESSING_MODE: "events",
        WHATSAPP_META_APP_SECRET: "test-app-secret",
        WHATSAPP_WEBHOOK_VERIFY_TOKEN: "test-verify-token",
        WHATSAPP_DISPATCHER: {} as DurableObjectNamespace,
        SAVIA_WORKFLOW_ONLY_SCHEDULE: "true",
      },
    ),
  ).rejects.toThrow("Scheduled jobs failed");

  expect(cleanupChannelState).toHaveBeenCalledTimes(1);
  expect(recoverWhatsappScopes).toHaveBeenCalledTimes(1);
  expect(wakeWhatsappScope).toHaveBeenCalledTimes(2);
  expect(runBookingJobs).toHaveBeenCalledTimes(1);
  expect(runScheduledWorkflows).toHaveBeenCalledTimes(1);
});

it("does not recover event-driven WhatsApp scopes off the five-minute boundary", async () => {
  vi.clearAllMocks();

  await worker.scheduled(
    {
      scheduledTime: Date.parse("2026-10-07T12:06:00.000Z"),
    } as ScheduledController,
    {
      ...env,
      WHATSAPP_PROCESSING_MODE: "events",
      WHATSAPP_META_APP_SECRET: "test-app-secret",
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: "test-verify-token",
      WHATSAPP_DISPATCHER: {} as DurableObjectNamespace,
      SAVIA_WORKFLOW_ONLY_SCHEDULE: "true",
    },
  );

  expect(cleanupChannelState).not.toHaveBeenCalled();
  expect(recoverWhatsappScopes).not.toHaveBeenCalled();
  expect(wakeWhatsappScope).not.toHaveBeenCalled();
  expect(runBookingJobs).toHaveBeenCalledTimes(1);
  expect(runScheduledWorkflows).toHaveBeenCalledTimes(1);
});
