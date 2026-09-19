import { z } from "zod";

const safePart = (part: string) =>
  !["__proto__", "constructor", "prototype"].includes(part);
const key = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,47}$/)
  .refine(safePart);
export const workflowValueSchema = z.union([
  z.string().max(4000),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z
    .object({
      ref: z
        .string()
        .max(250)
        .regex(/^(trigger|before|system|steps)(\.[a-zA-Z0-9_]+)+$/)
        .refine((v) => v.split(".").every(safePart)),
    })
    .strict(),
]);
export type WorkflowValue = z.infer<typeof workflowValueSchema>;
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
};
export const workflowNodeSchema = z.discriminatedUnion("type", [
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
        "empty",
      ]),
      right: workflowValueSchema,
      otherwise: key.optional(),
    })
    .strict(),
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
    .object({ ...base, type: z.literal("create"), collection: key, values })
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
      seconds: z.number().int().min(1).max(31_536_000),
    })
    .strict(),
]);
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
const trigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("created"), collection: key }).strict(),
  z
    .object({
      type: z.literal("updated"),
      collection: key,
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
      for (const next of [
        node.next,
        node.type === "condition" ? node.otherwise : undefined,
      ]) {
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
    if (JSON.stringify(definition).length > 64_000)
      issue("Workflow definition is too large");
  });
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export const workflowDraftSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    definition: workflowDefinitionSchema,
  })
  .strict();
export type WorkflowContext = {
  trigger: Record<string, unknown>;
  before: Record<string, unknown>;
  steps: Record<string, unknown>;
  system: Record<string, unknown>;
};
export function resolveWorkflowValue(
  value: WorkflowValue,
  context: WorkflowContext,
): unknown {
  if (!value || typeof value !== "object") return value;
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
export function evaluateWorkflowCondition(
  node: Extract<WorkflowNode, { type: "condition" }>,
  context: WorkflowContext,
) {
  const left = resolveWorkflowValue(node.left, context),
    right = resolveWorkflowValue(node.right, context);
  switch (node.operator) {
    case "eq":
      return JSON.stringify(left) === JSON.stringify(right);
    case "neq":
      return JSON.stringify(left) !== JSON.stringify(right);
    case "empty":
      return (
        left === null || left === "" || (Array.isArray(left) && !left.length)
      );
    case "contains":
      return (
        typeof left === "string" &&
        typeof right === "string" &&
        left.includes(right)
      );
    default:
      if (typeof left !== "number" || typeof right !== "number")
        throw new Error("Numeric comparisons require two numbers");
      return node.operator === "gt"
        ? left > right
        : node.operator === "gte"
          ? left >= right
          : node.operator === "lt"
            ? left < right
            : left <= right;
  }
}
