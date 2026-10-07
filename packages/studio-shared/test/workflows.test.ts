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

it("routes a switch input across ordered cases with a default branch", () => {
  const flow = {
    trigger: { type: "manual" },
    nodes: [
      {
        id: "route",
        type: "switch",
        input: { ref: "trigger.status" },
        cases: [
          { operator: "eq", value: "approved", next: "fast" },
          { operator: "eq", value: "review" },
        ],
        otherwise: "slow",
      },
      { id: "fast", type: "transform", values: { lane: "fast" } },
      { id: "slow", type: "transform", values: { lane: "slow" } },
    ],
  };
  expect(workflowDefinitionSchema.safeParse(flow).success).toBe(true);
  expect(
    workflowDefinitionSchema.safeParse({
      ...flow,
      nodes: [{ ...flow.nodes[0], next: "fast" }],
    }).success,
  ).toBe(false);
  expect(
    workflowDefinitionSchema.safeParse({
      ...flow,
      nodes: [
        {
          ...flow.nodes[0],
          cases: Array.from({ length: 11 }, () => ({
            operator: "eq",
            value: "x",
            next: "fast",
          })),
        },
        flow.nodes[1],
        flow.nodes[2],
      ],
    }).success,
  ).toBe(false);
});

it("maps and bulk-updates referenced lists with per-item values", () => {
  const flow = {
    trigger: { type: "manual" },
    nodes: [
      {
        id: "each",
        type: "map",
        items: { ref: "trigger.tags" },
        values: { tag: { ref: "item.id" } },
        next: "bulk",
      },
      {
        id: "bulk",
        type: "bulkUpdate",
        collection: "requests",
        items: { ref: "steps.each.items" },
        values: { status: "done" },
      },
    ],
  };
  expect(workflowDefinitionSchema.safeParse(flow).success).toBe(true);
  expect(
    workflowDefinitionSchema.safeParse({
      ...flow,
      nodes: [{ ...flow.nodes[0], items: "trigger.tags" }],
    }).success,
  ).toBe(false);
});

it("rejects item references outside loop steps", () => {
  expect(
    workflowDefinitionSchema.safeParse({
      trigger: { type: "manual" },
      nodes: [
        { id: "plain", type: "transform", values: { v: { ref: "item.id" } } },
      ],
    }).success,
  ).toBe(false);
});

it("loops over a referenced list with an enclosed body", () => {
  const flow = {
    trigger: { type: "manual" },
    nodes: [
      {
        id: "repeat",
        type: "loop",
        items: { ref: "trigger.tags" },
        body: "touch",
        maxIterations: 10,
        next: "done",
      },
      {
        id: "touch",
        type: "transform",
        values: { tag: { ref: "steps.repeat.item" } },
      },
      {
        id: "done",
        type: "transform",
        values: { total: { ref: "steps.repeat.count" } },
      },
    ],
  };
  expect(workflowDefinitionSchema.safeParse(flow).success).toBe(true);
  // Body results are not available on the skip path past the loop.
  expect(
    workflowDefinitionSchema.safeParse({
      ...flow,
      nodes: [
        flow.nodes[0],
        flow.nodes[1],
        {
          id: "done",
          type: "transform",
          values: { tag: { ref: "steps.touch.tag" } },
        },
      ],
    }).success,
  ).toBe(false);
});

it("rejects open loops, nested loops, webhooks and jumps into the body", () => {
  const body = { id: "touch", type: "transform", values: {} };
  const head = {
    id: "repeat",
    type: "loop",
    items: { ref: "trigger.tags" },
    body: "touch",
    next: "done",
  };
  const done = { id: "done", type: "transform", values: {} };
  const base = { trigger: { type: "manual" }, nodes: [head, body, done] };
  expect(workflowDefinitionSchema.safeParse(base).success).toBe(true);
  const cases = [
    { ...head, body: "repeat" },
    { ...head, body: "done" },
    { ...head, next: "touch" },
  ];
  for (const patched of cases)
    expect(
      workflowDefinitionSchema.safeParse({
        ...base,
        nodes: [patched, body, done],
      }).success,
    ).toBe(false);
  expect(
    workflowDefinitionSchema.safeParse({
      ...base,
      nodes: [
        head,
        { ...body, next: "inner" },
        {
          id: "inner",
          type: "loop",
          items: { ref: "trigger.tags" },
          body: "done",
        },
        done,
      ],
    }).success,
  ).toBe(false);
  expect(
    workflowDefinitionSchema.safeParse({
      ...base,
      nodes: [
        head,
        {
          id: "touch",
          type: "webhook",
          destinationId: "a12aa1d0-5393-4a7f-a807-80ad8a7abcde",
          destinationRevision: 1,
          values: {},
        },
        done,
      ],
    }).success,
  ).toBe(false);
  expect(
    workflowDefinitionSchema.safeParse({
      trigger: { type: "manual" },
      nodes: [
        head,
        body,
        { id: "sneak", type: "transform", values: {}, next: "touch" },
        { ...done, next: "sneak" },
      ],
    }).success,
  ).toBe(false);
});

it("accepts interval or cron schedules but never both or neither", () => {
  const nodes = [{ id: "tick", type: "transform", values: {} }];
  const startAt = new Date(Date.now() + 60000).toISOString();
  expect(
    workflowDefinitionSchema.safeParse({
      trigger: { type: "schedule", intervalMinutes: 60, startAt },
      nodes,
    }).success,
  ).toBe(true);
  expect(
    workflowDefinitionSchema.safeParse({
      trigger: { type: "schedule", cron: "0 9 * * 1", startAt },
      nodes,
    }).success,
  ).toBe(true);
  for (const trigger of [
    { type: "schedule", startAt },
    { type: "schedule", intervalMinutes: 60, cron: "0 * * * *", startAt },
    { type: "schedule", cron: "nope", startAt },
    { type: "schedule", cron: "0 0 30 2 *", startAt },
  ])
    expect(workflowDefinitionSchema.safeParse({ trigger, nodes }).success).toBe(
      false,
    );
});

it("routes approvals to separate branches like conditions", () => {
  const flow = {
    trigger: { type: "manual" },
    nodes: [
      {
        id: "gate",
        type: "approval",
        title: "Ship it?",
        assignee: { ref: "system.owner" },
        dueDays: 2,
        next: "fast",
        otherwise: "slow",
      },
      { id: "fast", type: "transform", values: {} },
      {
        id: "slow",
        type: "transform",
        values: { verdict: { ref: "steps.gate.decision" } },
      },
    ],
  };
  expect(workflowDefinitionSchema.safeParse(flow).success).toBe(true);
  expect(
    workflowDefinitionSchema.safeParse({
      ...flow,
      nodes: [
        flow.nodes[0],
        flow.nodes[1],
        {
          id: "slow",
          type: "transform",
          values: { verdict: { ref: "steps.fast.skipped" } },
        },
      ],
    }).success,
  ).toBe(false);
});

it("joins straight-line branches and exposes every branch result", () => {
  const flow = {
    trigger: { type: "manual" },
    nodes: [
      { id: "fork", type: "parallel", branches: ["left", "right"] },
      {
        id: "left",
        type: "transform",
        values: { lane: "left" },
        next: "join",
      },
      {
        id: "right",
        type: "transform",
        values: { lane: "right" },
        next: "join",
      },
      { id: "join", type: "merge", next: "done" },
      {
        id: "done",
        type: "transform",
        values: { both: { ref: "steps.join.branches" } },
      },
    ],
  };
  expect(workflowDefinitionSchema.safeParse(flow).success).toBe(true);
  // A branch result is unavailable inside the sibling branch.
  expect(
    workflowDefinitionSchema.safeParse({
      ...flow,
      nodes: [
        flow.nodes[0],
        {
          id: "left",
          type: "transform",
          values: { lane: { ref: "steps.right.lane" } },
          next: "join",
        },
        flow.nodes[2],
        flow.nodes[3],
        flow.nodes[4],
      ],
    }).success,
  ).toBe(false);
});

it("accepts conditions and switches inside parallel branches", () => {
  const flow = {
    trigger: { type: "manual" },
    nodes: [
      { id: "fork", type: "parallel", branches: ["left", "right"] },
      {
        id: "left",
        type: "condition",
        left: { ref: "trigger.flag" },
        operator: "eq",
        right: true,
        next: "left_yes",
        otherwise: "left_no",
      },
      { id: "left_yes", type: "transform", values: { lane: "yes" }, next: "join" },
      { id: "left_no", type: "transform", values: { lane: "no" }, next: "join" },
      {
        id: "right",
        type: "switch",
        input: { ref: "trigger.kind" },
        cases: [{ operator: "eq", value: "a", next: "right_a" }],
        otherwise: "join",
      },
      { id: "right_a", type: "transform", values: { lane: "a" }, next: "join" },
      { id: "join", type: "merge", next: "done" },
      { id: "done", type: "transform", values: {} },
    ],
  };
  expect(workflowDefinitionSchema.safeParse(flow).success).toBe(true);
  // Uneven interiors still fail: one condition path leaves the region.
  expect(
    workflowDefinitionSchema.safeParse({
      trigger: { type: "manual" },
      nodes: [
        { id: "fork", type: "parallel", branches: ["left", "right"] },
        {
          id: "left",
          type: "condition",
          left: "",
          operator: "eq",
          right: "",
          next: "join",
          otherwise: "elsewhere",
        },
        { id: "right", type: "transform", values: {}, next: "join" },
        { id: "join", type: "merge" },
        { id: "elsewhere", type: "transform", values: {} },
      ],
    }).success,
  ).toBe(false);
});

it("rejects open, uneven and nested parallel regions", () => {
  const join = { id: "join", type: "merge" };
  const end = (id: string, next = "join") => ({
    id,
    type: "transform",
    values: {},
    next,
  });
  const fork = (branches: string[]) => ({
    id: "fork",
    type: "parallel",
    branches,
  });
  const base = (nodes: unknown[]) => ({ trigger: { type: "manual" }, nodes });
  expect(
    workflowDefinitionSchema.safeParse(
      base([fork(["left", "right"]), end("left"), end("right"), join]),
    ).success,
  ).toBe(true);
  const cases: unknown[][] = [
    [fork(["left"]), end("left"), join],
    [
      fork(["left", "right"]),
      end("left"),
      end("right", "elsewhere"),
      join,
      { id: "elsewhere", type: "transform", values: {} },
    ],
    [
      fork(["shared", "other"]),
      end("shared"),
      { ...end("other"), next: "shared" },
      join,
    ],
    [
      fork(["left", "right"]),
      end("left"),
      {
        id: "right",
        type: "loop",
        items: { ref: "trigger.tags" },
        body: "join",
        next: "join",
      },
      join,
    ],
    [
      fork(["left", "right"]),
      end("left"),
      end("right"),
      { ...join, next: "join" },
    ],
  ];
  for (const nodes of cases)
    expect(workflowDefinitionSchema.safeParse(base(nodes)).success).toBe(false);
  expect(
    workflowDefinitionSchema.safeParse(
      base([
        {
          id: "repeat",
          type: "loop",
          items: { ref: "trigger.tags" },
          body: "fork",
          next: "join",
        },
        fork(["left", "right"]),
        end("left"),
        end("right"),
        join,
      ]),
    ).success,
  ).toBe(false);
});

it("accepts pinned subflow calls with mapped inputs", () => {
  const node = {
    id: "child",
    type: "subflow",
    workflowId: "a12aa1d0-5393-4a7f-a807-80ad8a7abcde",
    workflowVersion: "a12aa1d0-5393-4a7f-a807-80ad8a7abcde:3",
    input: { name: { ref: "trigger.name" } },
    next: "done",
  };
  expect(
    workflowDefinitionSchema.safeParse({
      trigger: { type: "manual" },
      nodes: [node, { id: "done", type: "transform", values: {} }],
    }).success,
  ).toBe(true);
  for (const patch of [
    { workflowId: "not-a-uuid" },
    { input: JSON.parse('{"__proto__":"x"}') },
  ])
    expect(
      workflowDefinitionSchema.safeParse({
        trigger: { type: "manual" },
        nodes: [{ ...node, ...patch }],
      }).success,
    ).toBe(false);
});

it("accepts generic HTTPS steps with bounded mappings", () => {
  const node = {
    id: "call",
    type: "http",
    method: "POST",
    url: "https://api.example.com/v1/records",
    headers: { "X-Source": "savia" },
    query: { limit: 10 },
    body: { name: { ref: "trigger.name" } },
  };
  expect(
    workflowDefinitionSchema.safeParse({
      trigger: { type: "manual" },
      nodes: [node],
    }).success,
  ).toBe(true);
  for (const patch of [
    { method: "FETCH" },
    { url: "http://api.example.com/v1" },
    { url: "https://192.0.2.1/x" },
    { url: "https://internal/x" },
    { headers: { authorization: "secret" } },
    { body: { name: "x" }, method: "GET" },
    { destinationId: "a12aa1d0-5393-4a7f-a807-80ad8a7abcde" },
  ])
    expect(
      workflowDefinitionSchema.safeParse({
        trigger: { type: "manual" },
        nodes: [{ ...node, ...patch }],
      }).success,
    ).toBe(false);
  expect(
    workflowDefinitionSchema.safeParse({
      trigger: { type: "manual" },
      nodes: [
        {
          ...node,
          url: { ref: "trigger.url" },
          method: "GET",
          body: undefined,
        },
      ],
    }).success,
  ).toBe(true);
});

it("accepts per-step error policies with bounded attempts", () => {
  const node = {
    id: "risky",
    type: "transform",
    values: {},
    onError: "continue",
    maxAttempts: 1,
  };
  expect(
    workflowDefinitionSchema.safeParse({
      trigger: { type: "manual" },
      nodes: [node],
    }).success,
  ).toBe(true);
  for (const patch of [
    { maxAttempts: 0 },
    { maxAttempts: 6 },
    { onError: "branch" },
  ])
    expect(
      workflowDefinitionSchema.safeParse({
        trigger: { type: "manual" },
        nodes: [{ ...node, ...patch }],
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
