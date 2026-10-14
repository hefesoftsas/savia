import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWithData: vi.fn(),
  createWorkerRuntime: vi.fn(),
  stampOnboardingStage: vi.fn(),
}));

vi.mock("../runtime/cloudflare-execution-store", () => ({
  CloudflareExecutionStore: class {
    getWithData = mocks.getWithData;
  },
}));
vi.mock("../runtime/cloudflare-worker-runtime", () => ({
  createWorkerRuntime: mocks.createWorkerRuntime,
}));
vi.mock("../db", () => ({
  createDatabase: vi.fn(() => ({})),
  stampOnboardingStage: mocks.stampOnboardingStage,
}));
vi.mock("../durable-objects/agent-utils", () => ({
  getWorkflowAgentByName: vi.fn(),
}));

import { WorkflowExecutor } from "./workflow-executor";
import type { Bindings } from "../context";
import type { WorkflowExecution } from "@savia/flows-types";

const workflow = {
  id: "workflow-1",
  name: "Worker workflow",
  trigger: "savia_collection_event",
  runtime: "worker" as const,
  nodes: [],
  edges: [],
};

const storedExecution: WorkflowExecution = {
  id: "savia-event-execution",
  workflowId: workflow.id,
  status: "completed",
  nodeExecutions: [{ nodeId: "side-effect", status: "completed", usage: 0 }],
};

describe("WorkflowExecutor deterministic Worker retries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWithData.mockResolvedValue({ data: storedExecution });
    mocks.createWorkerRuntime.mockReturnValue({ execute: vi.fn() });
    mocks.stampOnboardingStage.mockResolvedValue(undefined);
  });

  it("returns a persisted terminal execution without executing nodes again", async () => {
    const result = await WorkflowExecutor.execute({
      workflow,
      userId: "user-1",
      organizationId: "tenant:1",
      computeCredits: 0,
      executionId: storedExecution.id,
      env: {} as Bindings,
    });

    expect(result).toEqual({
      executionId: storedExecution.id,
      execution: storedExecution,
    });
    expect(mocks.getWithData).toHaveBeenCalledWith(
      storedExecution.id,
      "tenant:1",
    );
    expect(mocks.createWorkerRuntime).not.toHaveBeenCalled();
  });

  it("keeps manual Worker executions independent and randomly identified", async () => {
    const execution = {
      ...storedExecution,
      id: "random-worker-execution",
      status: "completed" as const,
    };
    const execute = vi.fn().mockResolvedValue(execution);
    mocks.createWorkerRuntime.mockReturnValue({ execute });

    const result = await WorkflowExecutor.execute({
      workflow,
      userId: "user-1",
      organizationId: "tenant:1",
      computeCredits: 0,
      env: {} as Bindings,
    });

    expect(result.executionId).toBe(execution.id);
    expect(execute).toHaveBeenCalledOnce();
    expect(mocks.getWithData).not.toHaveBeenCalled();
  });
});
