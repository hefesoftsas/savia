import { describe, expect, it } from "vitest";

import type { WorkflowDefinition } from "@savia/studio-shared/workflows";
import { workflowDefinitionSchema } from "@savia/studio-shared/workflows";
import {
  canConnectNativeNodes,
  connectNativeNodes,
  disconnectNativeEdge,
  graphEdges,
  removeNativeNode,
  setNativePositions,
} from "./native-graph";

const definition: WorkflowDefinition = {
  trigger: { type: "manual" },
  nodes: [
    {
      id: "check",
      type: "condition",
      left: "trigger.id",
      operator: "eq",
      right: "x",
      next: "yes",
      otherwise: "no",
    },
    { id: "yes", type: "transform", values: {} },
    { id: "no", type: "transform", values: {} },
  ],
};

describe("native workflow graph", () => {
  it("projects condition branches onto true and false handles", () => {
    expect(graphEdges(definition)).toEqual([
      expect.objectContaining({
        id: "check:true:yes",
        source: "check",
        sourceHandle: "true",
        target: "yes",
      }),
      expect.objectContaining({
        id: "check:false:no",
        source: "check",
        sourceHandle: "false",
        target: "no",
      }),
    ]);
  });

  it("reconnects only the selected condition branch", () => {
    const next = connectNativeNodes(definition, {
      source: "check",
      sourceHandle: "false",
      target: "yes",
      targetHandle: null,
    });
    expect(next.nodes[0]).toMatchObject({ next: "yes", otherwise: "yes" });
  });

  it("clears the old branch when reconnecting it to another source", () => {
    const disconnected = disconnectNativeEdge(definition, "check", "false");
    expect(disconnected.nodes[0]).toMatchObject({ next: "yes" });
    expect(disconnected.nodes[0]).not.toHaveProperty("otherwise");
  });

  it("round-trips saved node positions without changing workflow connections", () => {
    const positioned = setNativePositions(definition, {
      check: { x: 240, y: 80 },
      yes: { x: 90, y: 300 },
      no: { x: 390, y: 300 },
    });
    expect(positioned.positions?.check).toEqual({ x: 240, y: 80 });
    expect(graphEdges(positioned)).toEqual(graphEdges(definition));
    expect(workflowDefinitionSchema.parse(positioned).positions).toEqual(
      positioned.positions,
    );
  });

  it("rewires incoming edges to a removed step and promotes a new first entry", () => {
    const linear: WorkflowDefinition = {
      trigger: { type: "manual" },
      nodes: [
        { id: "first", type: "transform", values: {}, next: "middle" },
        { id: "middle", type: "transform", values: {}, next: "last" },
        { id: "last", type: "transform", values: {} },
      ],
    };
    const removed = removeNativeNode(linear, "middle");
    expect(removed?.nodes[0].id).toBe("first");
    expect(removed?.nodes[0].next).toBe("last");
    expect(removeNativeNode(linear, "first")?.nodes[0].id).toBe("middle");
  });

  it("refuses to remove a branching entry condition without losing either route", () => {
    expect(removeNativeNode(definition, "check")).toBeNull();
    expect(graphEdges(definition)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "check:true:yes" }),
        expect.objectContaining({ id: "check:false:no" }),
      ]),
    );
  });

  it("rejects cycles and nonexistent targets before saving an edge", () => {
    expect(
      canConnectNativeNodes(definition, {
        source: "yes",
        sourceHandle: null,
        target: "check",
        targetHandle: null,
      }),
    ).toBe(false);
    expect(
      canConnectNativeNodes(definition, {
        source: "check",
        sourceHandle: "true",
        target: "missing",
        targetHandle: null,
      }),
    ).toBe(false);
  });
});
