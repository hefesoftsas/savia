import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
vi.mock("../src/crm/auto-sync", () => ({
  processCrmSyncJobs: vi.fn(async () => {
    throw new Error("CRM sync unavailable");
  }),
}));
vi.mock("../src/workflows", () => ({
  runScheduledWorkflows: vi.fn(async () => undefined),
}));
import worker from "../src/index";
import { runScheduledWorkflows } from "../src/workflows";
it("continues workflows when the independent CRM synchronization fails", async () => {
  await expect(
    worker.scheduled({} as ScheduledController, env),
  ).rejects.toThrow();
  expect(runScheduledWorkflows).toHaveBeenCalledTimes(1);
  expect(vi.mocked(runScheduledWorkflows).mock.calls[0][0] === env.DB).toBe(
    true,
  );
});
import { processCrmSyncJobs } from "../src/crm/auto-sync";
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
