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
  it("accepts combined and deletion events with bounded scalar filters", () => {
    for (const type of [
      "created",
      "updated",
      "created_or_updated",
      "deleted",
    ]) {
      expect(
        workflowDefinitionSchema.safeParse({
          ...definition,
          trigger: {
            type,
            collection: "requests",
            conditionMode: "any",
            conditions: [
              { field: "status", operator: "eq", value: "approved" },
            ],
          },
        }).success,
      ).toBe(true);
    }
  });
  it("rejects invalid trigger conditions before publication", () => {
    for (const condition of [
      { field: "__proto__", operator: "eq", value: 1 },
      { field: "amount", operator: "gt", value: "10" },
      { field: "status", operator: "contains", value: false },
      { field: "status", operator: "eq", value: { ref: "steps.future.id" } },
    ])
      expect(
        workflowDefinitionSchema.safeParse({
          ...definition,
          trigger: {
            type: "created",
            collection: "requests",
            conditions: [condition],
          },
        }).success,
      ).toBe(false);
  });
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

it("accepts incoming and outgoing webhooks with pinned destinations", () => {
  const flow = {
    trigger: { type: "webhook" },
    nodes: [
      {
        id: "send",
        type: "webhook",
        destinationId: "a12aa1d0-5393-4a7f-a807-80ad8a7abcde",
        destinationRevision: 1,
        values: { name: { ref: "trigger.name" } },
      },
    ],
  };
  expect(workflowDefinitionSchema.safeParse(flow).success).toBe(true);
  expect(
    workflowDefinitionSchema.safeParse({
      ...flow,
      nodes: [{ ...flow.nodes[0], destinationRevision: 0 }],
    }).success,
  ).toBe(false);
  expect(
    workflowDefinitionSchema.safeParse({
      ...flow,
      nodes: [{ ...flow.nodes[0], values: { x: { ref: "steps.missing.id" } } }],
    }).success,
  ).toBe(false);
});
