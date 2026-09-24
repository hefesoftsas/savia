import { env } from "cloudflare:workers";
import { beforeAll, expect, it, vi } from "vitest";
vi.mock("../src/external-crm/auto-sync", () => ({
  processCrmSyncJobs: vi.fn(async () => {
    throw new Error("CRM sync unavailable");
  }),
}));
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
import worker from "../src/index";
import { runScheduledWorkflows } from "../src/workflows";
beforeAll(async () => {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS studio_audit(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,action TEXT NOT NULL,object_name TEXT NOT NULL,record_id TEXT,detail TEXT NOT NULL,created_at TEXT NOT NULL)",
  ).run();
});
it("continues workflows when the independent CRM synchronization fails", async () => {
  await expect(
    worker.scheduled({} as ScheduledController, env),
  ).rejects.toThrow();
  expect(runScheduledWorkflows).toHaveBeenCalledTimes(1);
  expect(vi.mocked(runScheduledWorkflows).mock.calls[0][0] === env.DB).toBe(
    true,
  );
});
import { processCrmSyncJobs } from "../src/external-crm/auto-sync";
it("ticks workflows in preview without activating external CRM synchronization", async () => {
  vi.clearAllMocks();
  await expect(
    worker.scheduled({} as ScheduledController, {
      ...env,
      SAVIA_WORKFLOW_ONLY_SCHEDULE: "true",
    }),
  ).resolves.toBeUndefined();
  expect(runScheduledWorkflows).toHaveBeenCalledTimes(1);
  expect(processCrmSyncJobs).not.toHaveBeenCalled();
});

import { createApiRuntime } from "../src/runtime";
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
        "domain:scheduled-test",
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
    "SELECT count(*) AS total FROM studio_audit WHERE tenant_id='domain:scheduled-test'",
  ).first<{ total: number }>();
  expect(count?.total).toBe(200);
  expect(
    await env.DB.prepare(
      "SELECT id FROM studio_audit WHERE id='scheduled-000'",
    ).first(),
  ).toBeNull();
});
