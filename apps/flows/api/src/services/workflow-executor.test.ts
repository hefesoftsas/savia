import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWithData: vi.fn(),
  createWorkerRuntime: vi.fn(),
  stampOnboardingStage: vi.fn(),
  agentExecuteWorkflow: vi.fn(),
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
  getWorkflowAgentByName: vi.fn(async () => ({
    executeWorkflow: mocks.agentExecuteWorkflow,
  })),
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
    mocks.agentExecuteWorkflow.mockResolvedValue(storedExecution.id);
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

  it("forwards a stable scheduled ID and occurrence context to Worker runtime", async () => {
    mocks.getWithData.mockResolvedValue(null);
    const execution = { ...storedExecution, status: "completed" as const };
    const execute = vi.fn().mockResolvedValue(execution);
    mocks.createWorkerRuntime.mockReturnValue({ execute });
    const scheduledTrigger = {
      timestamp: 1_730_000_001_000,
      scheduledTime: 1_730_000_000_000,
      scheduleExpression: "0 * * * *",
    };

    await WorkflowExecutor.execute({
      workflow: { ...workflow, trigger: "scheduled" },
      userId: "scheduled_trigger",
      organizationId: "tenant:1",
      computeCredits: 0,
      executionId: "ea2b8cb2-f7e1-5196-b141-231b7bfd0a94",
      scheduledTrigger,
      env: {} as Bindings,
    });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledTrigger }),
      "ea2b8cb2-f7e1-5196-b141-231b7bfd0a94",
    );
    expect(execute.mock.calls[0][0]).not.toHaveProperty("httpRequest");
  });

  it("forwards the same stable scheduled ID and context to durable Workflow runtime", async () => {
    const scheduledTrigger = {
      timestamp: 1_730_000_001_000,
      scheduledTime: 1_730_000_000_000,
      scheduleExpression: "0 * * * *",
    };
    const executionId = "ea2b8cb2-f7e1-5196-b141-231b7bfd0a94";

    await WorkflowExecutor.execute({
      workflow: { ...workflow, runtime: "workflow", trigger: "scheduled" },
      userId: "scheduled_trigger",
      organizationId: "tenant:1",
      computeCredits: 0,
      executionId,
      scheduledTrigger,
      env: {} as Bindings,
    });

    expect(mocks.agentExecuteWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledTrigger }),
      executionId,
    );
  });
});
