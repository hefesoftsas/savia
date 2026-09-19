import { describe, expect, it } from "vitest";
import {
  workflowDefinitionSchema,
  resolveWorkflowValue,
} from "../src/workflows";

const definition = {
  trigger: { type: "manual", collection: "requests" },
  nodes: [
    {
      id: "check",
      type: "condition",
      left: { ref: "trigger.amount" },
      operator: "gt",
      right: 10,
      next: "notify",
      otherwise: "finish",
    },
    {
      id: "notify",
      type: "notification",
      title: "Review requested",
      assignee: { ref: "system.owner" },
      next: "finish",
    },
    { id: "finish", type: "transform", values: { status: "processed" } },
  ],
};
describe("general workflow definitions", () => {
  it("accepts a general collection and a merging branch", () => {
    expect(workflowDefinitionSchema.parse(definition).nodes).toHaveLength(3);
  });
  it("rejects cycles, dangling edges and unreachable steps", () => {
    for (const nodes of [
      [{ id: "a", type: "transform", values: {}, next: "a" }],
      [{ id: "a", type: "transform", values: {}, next: "missing" }],
      [
        { id: "a", type: "transform", values: {} },
        { id: "b", type: "transform", values: {} },
      ],
    ])
      expect(
        workflowDefinitionSchema.safeParse({ ...definition, nodes }).success,
      ).toBe(false);
  });
  it("rejects variables from a branch that may not have executed", () => {
    const bad = structuredClone(definition);
    bad.nodes[2] = {
      id: "finish",
      type: "transform",
      values: { status: { ref: "steps.notify.id" } },
    } as any;
    expect(workflowDefinitionSchema.safeParse(bad).success).toBe(false);
  });
  it("accepts references dominated by their producer and rejects duplicate ids", () => {
    const nodes = [
      { id: "a", type: "transform", values: { count: 3 }, next: "b" },
      {
        id: "b",
        type: "transform",
        values: { count: { ref: "steps.a.count" } },
      },
    ];
    expect(
      workflowDefinitionSchema.safeParse({ ...definition, nodes }).success,
    ).toBe(true);
    nodes[1].id = "a";
    expect(
      workflowDefinitionSchema.safeParse({ ...definition, nodes }).success,
    ).toBe(false);
  });
  it("preserves reference types and fails explicitly for missing or unsafe paths", () => {
    const context = {
      trigger: { amount: 15, approved: false },
      steps: {},
      system: {},
    };
    expect(resolveWorkflowValue({ ref: "trigger.amount" }, context)).toBe(15);
    expect(resolveWorkflowValue({ ref: "trigger.approved" }, context)).toBe(
      false,
    );
    expect(() =>
      resolveWorkflowValue({ ref: "trigger.missing" }, context),
    ).toThrow();
    expect(() =>
      resolveWorkflowValue({ ref: "trigger.__proto__" }, context),
    ).toThrow();
    expect(resolveWorkflowValue("literal", context)).toBe("literal");
  });
  it("bounds schedules, nodes and field mappings", () => {
    expect(
      workflowDefinitionSchema.safeParse({
        ...definition,
        trigger: { type: "schedule", intervalMinutes: 0 },
      }).success,
    ).toBe(false);
    expect(
      workflowDefinitionSchema.safeParse({ ...definition, nodes: [] }).success,
    ).toBe(false);
    expect(
      workflowDefinitionSchema.safeParse({
        ...definition,
        nodes: [
          { id: "a", type: "transform", values: { __proto__: "unsafe" } },
        ],
      }).success,
    ).toBe(true);
    expect(
      workflowDefinitionSchema.safeParse({
        ...definition,
        nodes: [
          {
            id: "a",
            type: "transform",
            values: JSON.parse('{"__proto__":"unsafe"}'),
          },
        ],
      }).success,
    ).toBe(false);
  });
});

it("builds bounded term keys and calendar offsets without evaluating code", () => {
  const context = {
    trigger: { id: "p1", end: "2028-03-01" },
    before: {},
    steps: {},
    system: {},
  };
  expect(
    resolveWorkflowValue(
      { concat: [{ ref: "trigger.id" }, ":", { ref: "trigger.end" }] } as any,
      context,
    ),
  ).toBe("p1:2028-03-01");
  expect(
    resolveWorkflowValue(
      { dateOffset: { value: { ref: "trigger.end" }, days: -1 } } as any,
      context,
    ),
  ).toBe("2028-02-29");
  expect(() =>
    resolveWorkflowValue(
      { dateOffset: { value: "2026-02-30", days: 1 } } as any,
      context,
    ),
  ).toThrow();
  expect(
    workflowDefinitionSchema.safeParse({
      trigger: { type: "manual" },
      nodes: [
        {
          id: "wait",
          type: "delay",
          until: { dateOffset: { value: "2028-03-01", days: -30 } },
        },
      ],
    }).success,
  ).toBe(true);
  expect(
    workflowDefinitionSchema.safeParse({
      trigger: { type: "manual" },
      nodes: [{ id: "wait", type: "delay", seconds: 1, until: "2028-03-01" }],
    }).success,
  ).toBe(false);
});
