// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getExecution } from "./execution-service";
import { useWorkflowExecution } from "./workflow-service";

const { makeOrgRequest } = vi.hoisted(() => ({
  makeOrgRequest: vi.fn(),
}));

vi.mock("./utils", () => ({ makeOrgRequest }));
vi.mock("./execution-service", () => ({ getExecution: vi.fn() }));
vi.mock("./workflow-session-service", () => ({
  connectWorkflowExecutionWS: vi.fn(() => ({ disconnect: vi.fn() })),
}));
vi.mock("@/components/auth-context", () => ({ useAuth: () => ({}) }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const completed = (id: string) => ({
  id,
  workflowId: "workflow",
  status: "completed" as const,
  nodeExecutions: [],
});

describe("useWorkflowExecution request generations", () => {
  let root: Root | undefined;

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
      root = undefined;
    }
    makeOrgRequest.mockReset();
  });

  it("does not apply a prior POST response after a newer execution starts", async () => {
    const first = deferred<ReturnType<typeof completed>>();
    const second = deferred<ReturnType<typeof completed>>();
    makeOrgRequest
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const container = document.createElement("div");
    document.body.append(container);
    let hook!: ReturnType<typeof useWorkflowExecution>;
    function Harness() {
      hook = useWorkflowExecution("tenant:101");
      return null;
    }
    root = createRoot(container);
    await act(async () => root?.render(createElement(Harness)));

    const firstUpdate = vi.fn();
    const secondUpdate = vi.fn();
    await act(async () => {
      hook.executeWorkflow("workflow", firstUpdate, [], []);
      hook.executeWorkflow("workflow", secondUpdate, [], []);
    });

    await act(async () => {
      first.resolve(completed("execution-old"));
      await first.promise;
    });
    expect(firstUpdate).not.toHaveBeenCalled();
    expect(secondUpdate).not.toHaveBeenCalled();

    await act(async () => {
      second.resolve(completed("execution-new"));
      await second.promise;
    });
    expect(firstUpdate).not.toHaveBeenCalled();
    expect(secondUpdate).toHaveBeenCalledWith(completed("execution-new"));

    container.remove();
  });
});


describe("useWorkflowExecution status refreshes", () => {
  let root: Root | undefined;

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
      root = undefined;
    }
    makeOrgRequest.mockReset();
    vi.mocked(getExecution).mockReset();
    vi.restoreAllMocks();
  });

  it("keeps the execution live after a focus refresh fails", async () => {
    const running = {
      id: "execution-running",
      workflowId: "workflow",
      status: "executing" as const,
      nodeExecutions: [],
    };
    const finished = completed("execution-running");
    makeOrgRequest.mockResolvedValue(running);
    vi.mocked(getExecution)
      .mockRejectedValueOnce(new Error("temporary read failure"))
      .mockResolvedValueOnce(finished);
    const disconnectSocket = vi.fn();
    const connect = await import("./workflow-session-service");
    vi.mocked(connect.connectWorkflowExecutionWS).mockImplementation(
      () => {
        return { disconnect: disconnectSocket } as never;
      },
    );

    const container = document.createElement("div");
    document.body.append(container);
    let hook!: ReturnType<typeof useWorkflowExecution>;
    function Harness() {
      hook = useWorkflowExecution("tenant:101");
      return null;
    }
    root = createRoot(container);
    await act(async () => root?.render(createElement(Harness)));
    const onExecution = vi.fn();
    await act(async () => {
      hook.executeWorkflow("workflow", onExecution, [], []);
    });

    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(onExecution).toHaveBeenCalledTimes(1);
    expect(onExecution).toHaveBeenCalledWith(running);
    expect(disconnectSocket).not.toHaveBeenCalled();

    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(getExecution).toHaveBeenCalledTimes(2);
    expect(onExecution).toHaveBeenLastCalledWith(finished);
    expect(disconnectSocket).toHaveBeenCalledTimes(1);

    container.remove();
  });

  it("refreshes on socket open and window focus without periodic polling", async () => {
    const running = {
      id: "execution-running",
      workflowId: "workflow",
      status: "executing" as const,
      nodeExecutions: [],
    };
    makeOrgRequest.mockResolvedValue(running);
    vi.mocked(getExecution).mockResolvedValue(running);
    const intervalSpy = vi.spyOn(globalThis, "setInterval");
    let socketOptions: { onConnectionOpen?: () => void } | undefined;
    const connect = await import("./workflow-session-service");
    vi.mocked(connect.connectWorkflowExecutionWS).mockImplementation(
      (_orgId, _workflowId, _executionId, _onUpdate, options) => {
        socketOptions = options;
        return { disconnect: vi.fn() } as never;
      },
    );

    const container = document.createElement("div");
    document.body.append(container);
    let hook!: ReturnType<typeof useWorkflowExecution>;
    function Harness() {
      hook = useWorkflowExecution("tenant:101");
      return null;
    }
    root = createRoot(container);
    await act(async () => root?.render(createElement(Harness)));
    const onExecution = vi.fn();
    await act(async () => {
      hook.executeWorkflow("workflow", onExecution, [], []);
    });

    expect(socketOptions?.onConnectionOpen).toBeTypeOf("function");
    expect(getExecution).not.toHaveBeenCalled();
    await act(async () => socketOptions?.onConnectionOpen?.());
    expect(getExecution).toHaveBeenCalledTimes(1);

    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(getExecution).toHaveBeenCalledTimes(2);
    expect(intervalSpy).not.toHaveBeenCalled();

    container.remove();
  });
});
