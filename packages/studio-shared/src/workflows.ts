import { z } from "zod";
import { reservedHeaderName } from "./workflow-webhooks";

function httpsLiteralOk(raw: string): boolean {
  if (!raw || /\s/.test(raw)) return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== "443")
  )
    return false;
  const host = parsed.hostname.toLowerCase();
  return (
    host.includes(".") &&
    !host.endsWith(".") &&
    !host.includes(":") &&
    !/^\d+(\.\d+)*$/.test(host) &&
    !/(^|\.)(localhost|local|internal|test|invalid|example|onion)$/.test(host)
  );
}

const safePart = (part: string) =>
  !["__proto__", "constructor", "prototype"].includes(part);
const key = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,47}$/)
  .refine(safePart);
const scalarWorkflowValueSchema = z.union([
  z.string().max(4000),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z
    .object({
      ref: z
        .string()
        .max(250)
        .regex(/^(trigger|before|system|steps|item)(\.[a-zA-Z0-9_]+)+$/)
        .refine((v) => v.split(".").every(safePart)),
    })
    .strict(),
]);
export type WorkflowValue =
  | z.infer<typeof scalarWorkflowValueSchema>
  | { concat: WorkflowValue[] }
  | { dateOffset: { value: WorkflowValue; days: number } };
function expressionSchema(depth: number): z.ZodType<WorkflowValue> {
  if (depth === 0) return scalarWorkflowValueSchema;
  return z.union([
    scalarWorkflowValueSchema,
    z
      .object({
        concat: z
          .array(expressionSchema(depth - 1))
          .min(1)
          .max(12),
      })
      .strict(),
    z
      .object({
        dateOffset: z
          .object({
            value: expressionSchema(depth - 1),
            days: z.number().int().min(-3660).max(3660),
          })
          .strict(),
      })
      .strict(),
  ]);
}
export const workflowValueSchema = expressionSchema(3);
const values = z
  .unknown()
  .refine(
    (v) => !v || typeof v !== "object" || Object.keys(v).every(safePart),
    "Reserved field name",
  )
  .pipe(z.record(key, workflowValueSchema))
  .refine((v) => Object.keys(v).length <= 50, "At most 50 fields per step");
const base = {
  id: key,
  label: z.string().trim().max(100).optional(),
  next: key.optional(),
  onError: z.enum(["fail", "continue"]).optional(),
  maxAttempts: z.number().int().min(1).max(5).optional(),
};
const switchOperators = z.enum([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "date_after",
]);
const switchCaseSchema = z
  .object({
    operator: switchOperators,
    value: workflowValueSchema,
    next: key.optional(),
  })
  .strict();
const itemsRefSchema = z
  .object({
    ref: z
      .string()
      .max(250)
      .regex(/^(trigger|before|system|steps)(\.[a-zA-Z0-9_]+)+$/)
      .refine((v) => v.split(".").every(safePart)),
  })
  .strict();
export const workflowNodeSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...base,
      type: z.literal("webhook"),
      destinationId: z.uuid(),
      destinationRevision: z.number().int().positive(),
      values,
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("condition"),
      left: workflowValueSchema,
      operator: z.enum([
        "eq",
        "neq",
        "gt",
        "gte",
        "lt",
        "lte",
        "contains",
        "date_after",
        "empty",
      ]),
      right: workflowValueSchema,
      otherwise: key.optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("switch"),
      input: workflowValueSchema,
      cases: z.array(switchCaseSchema).min(1).max(10),
      otherwise: key.optional(),
    })
    .strict()
    .refine((node) => node.next === undefined, {
      message: "Switch uses cases and otherwise, not next",
      path: ["next"],
    }),
  z
    .object({
      ...base,
      type: z.literal("map"),
      items: itemsRefSchema,
      values,
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("bulkUpdate"),
      collection: key,
      items: itemsRefSchema,
      values,
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("loop"),
      items: itemsRefSchema,
      body: key,
      maxIterations: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("subflow"),
      workflowId: z.uuid(),
      workflowVersion: z.string().trim().min(1).max(200),
      input: z
        .record(
          z.string().min(1).max(100).refine(safePart),
          workflowValueSchema,
        )
        .refine((input) => Object.keys(input).length <= 50)
        .optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("piece"),
      pieceId: z
        .string()
        .regex(/^[a-z][a-z0-9-]{0,63}$/)
        .refine(safePart),
      pieceVersion: z.number().int().positive(),
      config: z
        .record(key, workflowValueSchema)
        .refine((config) => Object.keys(config).length <= 50)
        .optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("http"),
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
      url: workflowValueSchema,
      headers: z
        .record(
          z
            .string()
            .regex(/^[A-Za-z][A-Za-z0-9-]{0,79}$/)
            .refine((name) => !reservedHeaderName.test(name)),
          workflowValueSchema,
        )
        .refine((headers) => Object.keys(headers).length <= 10)
        .optional(),
      query: z
        .record(
          z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
          workflowValueSchema,
        )
        .refine((query) => Object.keys(query).length <= 20)
        .optional(),
      body: values.optional(),
      destinationId: z.uuid().optional(),
      destinationRevision: z.number().int().positive().optional(),
    })
    .strict()
    .superRefine((node, ctx) => {
      if (
        (node.destinationId === undefined) !==
        (node.destinationRevision === undefined)
      )
        ctx.addIssue({
          code: "custom",
          message: "Credential reference needs both destination and revision",
        });
      if (
        (node.method === "GET" || node.method === "DELETE") &&
        node.body !== undefined
      )
        ctx.addIssue({
          code: "custom",
          message: "GET and DELETE requests cannot carry a JSON body",
        });
      if (typeof node.url === "string" && !httpsLiteralOk(node.url))
        ctx.addIssue({
          code: "custom",
          message: "HTTP URL must be absolute https",
        });
    }),
  z.object({ ...base, type: z.literal("transform"), values }).strict(),
  z
    .object({
      ...base,
      type: z.literal("query"),
      collection: key,
      field: key,
      value: workflowValueSchema,
      limit: z.number().int().min(1).max(100).default(20),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("create"),
      collection: key,
      values,
      matchField: key.optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("update"),
      collection: key,
      recordId: workflowValueSchema,
      values,
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("task"),
      title: workflowValueSchema,
      assignee: workflowValueSchema,
      dueDays: z.number().int().min(0).max(365).default(1),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("notification"),
      title: workflowValueSchema,
      assignee: workflowValueSchema,
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("delay"),
      seconds: z.number().int().min(1).max(31_536_000).optional(),
      until: workflowValueSchema.optional(),
    })
    .strict()
    .refine(
      (node) => (node.seconds === undefined) !== (node.until === undefined),
      "Choose seconds or an absolute date",
    ),
]);
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export const workflowTriggerConditionSchema = z
  .object({
    field: key,
    operator: z.enum([
      "eq",
      "neq",
      "gt",
      "gte",
      "lt",
      "lte",
      "contains",
      "empty",
      "not_empty",
    ]),
    value: z.union([
      z.string().max(4000),
      z.number().finite(),
      z.boolean(),
      z.null(),
    ]),
  })
  .strict()
  .superRefine((condition, ctx) => {
    if (
      ["gt", "gte", "lt", "lte"].includes(condition.operator) &&
      typeof condition.value !== "number"
    )
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "Numeric comparisons require a number",
      });
    if (
      condition.operator === "contains" &&
      typeof condition.value !== "string"
    )
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "Contains requires text",
      });
  });
export type WorkflowTriggerCondition = z.infer<
  typeof workflowTriggerConditionSchema
>;
const collectionTrigger = {
  collection: key,
  conditions: z.array(workflowTriggerConditionSchema).max(20).optional(),
  conditionMode: z.enum(["all", "any"]).optional(),
};
const trigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("webhook") }).strict(),
  z.object({ type: z.literal("created"), ...collectionTrigger }).strict(),
  z.object({ type: z.literal("deleted"), ...collectionTrigger }).strict(),
  z
    .object({
      type: z.literal("created_or_updated"),
      ...collectionTrigger,
      changedFields: z.array(key).max(50).default([]),
    })
    .strict(),
  z
    .object({
      type: z.literal("updated"),
      ...collectionTrigger,
      changedFields: z.array(key).max(50).default([]),
    })
    .strict(),
  z.object({ type: z.literal("manual"), collection: key.optional() }).strict(),
  z
    .object({
      type: z.literal("schedule"),
      intervalMinutes: z.number().int().min(1).max(525600),
      startAt: z.iso.datetime(),
    })
    .strict(),
]);

function references(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  if ("ref" in value && typeof value.ref === "string") return [value.ref];
  return Object.values(value).flatMap(references);
}
export const workflowDefinitionSchema = z
  .object({
    trigger,
    nodes: z.array(workflowNodeSchema).min(1).max(50),
  })
  .strict()
  .superRefine((definition, ctx) => {
    if (!definition.nodes.length) return;
    const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (nodes.size !== definition.nodes.length)
      return issue("Step identifiers must be unique");
    const visiting = new Set<string>(),
      visited = new Set<string>();
    const predecessors = new Map<string, string[]>();
    const order: string[] = [];
    function visit(id: string) {
      if (visiting.has(id)) {
        issue("Workflow cycles are not supported");
        return;
      }
      if (visited.has(id)) return;
      const node = nodes.get(id);
      if (!node) {
        issue(`Missing step: ${id}`);
        return;
      }
      visiting.add(id);
      const outgoing: (string | undefined)[] = [node.next];
      if (node.type === "condition") outgoing.push(node.otherwise);
      if (node.type === "switch") {
        for (const entry of node.cases) outgoing.push(entry.next);
        outgoing.push(node.otherwise);
      }
      if (node.type === "loop") outgoing.push(node.body);
      for (const next of outgoing) {
        if (!next) continue;
        predecessors.set(next, [...(predecessors.get(next) ?? []), id]);
        visit(next);
      }
      visiting.delete(id);
      visited.add(id);
      order.unshift(id);
    }
    visit(definition.nodes[0].id);
    if (visited.size !== nodes.size)
      issue("Every step must be reachable from the first step");
    const dominators = new Map<string, Set<string>>();
    for (const id of order) {
      const parents = (predecessors.get(id) ?? []).map(
        (parent) => new Set([parent, ...(dominators.get(parent) ?? [])]),
      );
      const available = new Set(parents[0] ?? []);
      for (const candidate of available)
        if (!parents.every((p) => p.has(candidate)))
          available.delete(candidate);
      dominators.set(id, available);
      for (const ref of references(nodes.get(id))) {
        if (ref.startsWith("steps.") && !available.has(ref.split(".")[1]))
          issue(
            `Step ${id} references a result unavailable on every incoming path: ${ref}`,
          );
      }
    }
    for (const node of definition.nodes) {
      if (node.type === "map" || node.type === "bulkUpdate") continue;
      if (
        references(node).some(
          (ref) => ref === "item" || ref.startsWith("item."),
        )
      )
        issue(`Step ${node.id} uses item.* outside a loop step`);
    }
    for (const head of definition.nodes) {
      if (head.type !== "loop") continue;
      if (head.next !== undefined && head.body === head.next)
        issue(`Loop ${head.id} needs a body step after its post-loop step`);
      const body = loopBodyMembers(definition, head.id);
      if (body.hitsHead)
        issue(
          `Loop ${head.id} cannot point back to itself; end the body to iterate`,
        );
      for (const nested of body.nested)
        issue(`Loop ${head.id} cannot contain loop ${nested}`);
      for (const webhook of body.webhooks)
        issue(`Step ${webhook} cannot run inside loop ${head.id}`);
      if (!body.hitsHead && body.members.size === 0)
        issue(`Loop ${head.id} needs at least one body step`);
      if (head.next !== undefined && body.members.has(head.next))
        issue(`Step ${head.next} cannot be both body and post-loop`);
      for (const member of body.members) {
        const outsiders = (predecessors.get(member) ?? []).filter(
          (parent) => parent !== head.id && !body.members.has(parent),
        );
        if (outsiders.length > 0)
          issue(`Step ${member} jumps into loop ${head.id}`);
      }
    }
    if (JSON.stringify(definition).length > 64_000)
      issue("Workflow definition is too large");
  });
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export type LoopHead = Extract<
  WorkflowDefinition["nodes"][number],
  { type: "loop" }
>;
export type LoopBodyFacts = {
  members: Set<string>;
  hitsHead: boolean;
  nested: string[];
  webhooks: string[];
};
/**
 * Statically enclosed body of a loop head: nodes reachable from `body`
 * without passing through the head itself, the post-loop step, or another
 * loop. A chain end inside the body iterates; an edge leaving the body
 * breaks out. Never follows more than the reachable graph, so it always
 * terminates even for invalid definitions.
 */
export function loopBodyMembers(
  definition: WorkflowDefinition,
  headId: string,
): LoopBodyFacts {
  const members = new Set<string>(),
    nested: string[] = [],
    webhooks: string[] = [];
  let hitsHead = false;
  const head = definition.nodes.find((node) => node.id === headId);
  if (!head || head.type !== "loop")
    return { members, hitsHead, nested, webhooks };
  const stop = head.next ?? null;
  const seen = new Set<string>(),
    queue = [head.body];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (id === headId) {
      hitsHead = true;
      continue;
    }
    const node = definition.nodes.find((candidate) => candidate.id === id);
    if (!node) continue;
    if (node.type === "loop") {
      if (!nested.includes(id)) nested.push(id);
      continue;
    }
    if (id === stop) continue;
    if (node.type === "webhook" && !webhooks.includes(id)) webhooks.push(id);
    members.add(id);
    const outgoing: (string | undefined)[] = [node.next];
    if (node.type === "condition") outgoing.push(node.otherwise);
    if (node.type === "switch") {
      for (const entry of node.cases) outgoing.push(entry.next);
      outgoing.push(node.otherwise);
    }
    for (const next of outgoing) if (next) queue.push(next);
  }
  return { members, hitsHead, nested, webhooks };
}
export const workflowDraftSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    definition: workflowDefinitionSchema,
  })
  .strict();
export type WorkflowCall = {
  child: string;
  version: string;
  returnNode: string;
  saved: WorkflowContext;
};
export type WorkflowContext = {
  trigger: Record<string, unknown>;
  before: Record<string, unknown>;
  steps: Record<string, unknown>;
  system: Record<string, unknown>;
  /** Current list element. Only present while a loop step maps its items. */
  item?: unknown;
  /** Active multi-step loop frames by head id. Runtime-managed. */
  loops?: Record<string, { index: number; delayed?: boolean }>;
  /** Pending subflow calls, innermost last. Runtime-managed. */
  calls?: WorkflowCall[];
  /** Completed subflow results awaiting pickup. Runtime-managed. */
  returned?: Record<string, unknown>;
};
export function resolveWorkflowValue(
  value: WorkflowValue,
  context: WorkflowContext,
): unknown {
  if (!value || typeof value !== "object") return value;
  if ("concat" in value) {
    const parts = value.concat.map((part) =>
      resolveWorkflowValue(part, context),
    );
    if (
      parts.some((part) => typeof part !== "string" && typeof part !== "number")
    )
      throw new Error("Concatenation requires text or numbers");
    const result = parts.join("");
    if (result.length > 4000)
      throw new Error("Expression exceeds 4000 characters");
    return result;
  }
  if ("dateOffset" in value) {
    const raw = resolveWorkflowValue(value.dateOffset.value, context);
    if (
      typeof raw !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(raw) ||
      !Number.isFinite(Date.parse(raw)) ||
      new Date(raw).toISOString().slice(0, 10) !== raw
    )
      throw new Error("Date offset requires a valid calendar date");
    return new Date(Date.parse(raw) + value.dateOffset.days * 86400000)
      .toISOString()
      .slice(0, 10);
  }
  let result: unknown = context;
  for (const part of value.ref.split(".")) {
    if (
      !safePart(part) ||
      result === null ||
      typeof result !== "object" ||
      !Object.hasOwn(result, part)
    )
      throw new Error(`Variable unavailable: ${value.ref}`);
    result = (result as Record<string, unknown>)[part];
  }
  return result;
}
function compareWorkflowValues(
  operator: string,
  left: unknown,
  right: unknown,
): boolean {
  switch (operator) {
    case "eq":
      return JSON.stringify(left) === JSON.stringify(right);
    case "neq":
      return JSON.stringify(left) !== JSON.stringify(right);
    case "empty":
      return (
        left === null || left === "" || (Array.isArray(left) && !left.length)
      );
    case "date_after": {
      const date = (v: unknown) =>
        typeof v === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(v) &&
        !Number.isNaN(Date.parse(v)) &&
        new Date(v).toISOString().slice(0, 10) === v
          ? Date.parse(v)
          : null;
      const a = date(left),
        b = date(right);
      return a !== null && b !== null && a > b;
    }
    case "contains":
      return (
        typeof left === "string" &&
        typeof right === "string" &&
        left.includes(right)
      );
    default:
      if (typeof left !== "number" || typeof right !== "number")
        throw new Error("Numeric comparisons require two numbers");
      return operator === "gt"
        ? left > right
        : operator === "gte"
          ? left >= right
          : operator === "lt"
            ? left < right
            : left <= right;
  }
}
export function evaluateWorkflowCondition(
  node: Extract<WorkflowNode, { type: "condition" }>,
  context: WorkflowContext,
) {
  const left = resolveWorkflowValue(node.left, context),
    right = resolveWorkflowValue(node.right, context);
  return compareWorkflowValues(node.operator, left, right);
}
export function matchWorkflowSwitchCase(
  operator: Extract<
    WorkflowNode,
    { type: "switch" }
  >["cases"][number]["operator"],
  left: unknown,
  right: unknown,
): boolean {
  return compareWorkflowValues(operator, left, right);
}

export function workflowResumeAt(
  node: Extract<WorkflowNode, { type: "delay" }>,
  context: WorkflowContext,
  now: number,
): number {
  if (node.seconds !== undefined) return now + node.seconds * 1000;
  const raw = resolveWorkflowValue(node.until!, context);
  if (
    typeof raw !== "string" ||
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/.test(raw) ||
    !Number.isFinite(Date.parse(raw)) ||
    new Date(raw).toISOString().slice(0, 10) !== raw.slice(0, 10)
  )
    throw new Error("Delay requires an ISO UTC date");
  return Math.max(now, Date.parse(raw));
}
