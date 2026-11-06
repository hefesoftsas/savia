import { describe, expect, it } from "vitest";
import { nativeFlowWriteCause, parseFlowCause } from "../src/flow-causation";

describe("shared flow causation", () => {
  it("keeps ancestry when a transactional flow follows a graph flow", () => {
    expect(
      nativeFlowWriteCause({
        workflowId: "native",
        executionId: "run",
        depth: 2,
        cause: JSON.stringify({
          rootEventId: "root",
          workflowIds: ["graph-a", "graph-b"],
          depth: 2,
        }),
      }),
    ).toEqual({
      rootEventId: "root",
      workflowIds: ["graph-a", "graph-b", "native:native"],
      depth: 3,
    });
  });
  it("does not reset depth for older queued runs with opaque execution causes", () => {
    expect(
      nativeFlowWriteCause({
        workflowId: "native",
        executionId: "run",
        depth: 4,
        cause: "old-parent-run",
      }),
    ).toEqual({ rootEventId: "run", workflowIds: ["native:native"], depth: 5 });
    expect(
      nativeFlowWriteCause({
        workflowId: "native",
        executionId: "run",
        depth: 4,
        cause: { rootEventId: "root", workflowIds: [], depth: 2 },
      }).depth,
    ).toBe(5);
  });
  it("rejects malformed ancestry and keeps the global chain bounded", () => {
    for (const value of [
      null,
      "opaque",
      { rootEventId: "root", workflowIds: [42], depth: 1 },
      { rootEventId: "root", workflowIds: [], depth: -1 },
      { rootEventId: "root", workflowIds: [], depth: 9 },
    ])
      expect(parseFlowCause(value)).toBeUndefined();
    expect(() =>
      nativeFlowWriteCause({
        workflowId: "native",
        executionId: "run",
        depth: 8,
      }),
    ).toThrow("chain limit");
  });
});
