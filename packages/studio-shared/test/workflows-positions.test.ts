import { describe, expect, it } from "vitest";
import { workflowDefinitionSchema } from "../src/workflows";

const definition = {
  trigger: { type: "manual" },
  nodes: [{ id: "first", type: "transform", values: {} }],
};

describe("workflow graph positions", () => {
  it("preserves bounded finite optional node positions", () => {
    const parsed = workflowDefinitionSchema.parse({
      ...definition,
      positions: { first: { x: 120, y: -42.5 } },
    });
    expect(parsed.positions).toEqual({ first: { x: 120, y: -42.5 } });
  });

  it("rejects positions for unknown nodes", () => {
    expect(
      workflowDefinitionSchema.safeParse({
        ...definition,
        positions: { missing: { x: 0, y: 0 } },
      }).success,
    ).toBe(false);
  });

  it("rejects positions outside the graph bounds", () => {
    expect(
      workflowDefinitionSchema.safeParse({
        ...definition,
        positions: { first: { x: 100001, y: 0 } },
      }).success,
    ).toBe(false);
  });
});
