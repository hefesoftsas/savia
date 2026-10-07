import { z } from "zod";
import { cronNextOccurrence } from "./workflow-cron";
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
/** Collection or relation-traversal field path such as `status` or `related.customer.status`. */
const fieldPath = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,47}(\.[a-z][a-z0-9_]{0,47}){0,2}$/)
  .refine((value) => value.split(".").every(safePart));
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
      type: z.literal("approval"),
      title: workflowValueSchema,
      assignee: workflowValueSchema,
      description: workflowValueSchema.optional(),
      dueDays: z.number().int().min(0).max(365).default(1),
      otherwise: key.optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("parallel"),
      branches: z.array(key).min(2).max(8),
    })
    .strict()
    .refine((node) => node.next === undefined, {
      message: "Parallel uses branches, not next",
      path: ["next"],
    }),
  z.object({ ...base, type: z.literal("merge") }).strict(),
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
      type: z.literal("email"),
      to: workflowValueSchema,
      subject: workflowValueSchema,
      body: workflowValueSchema,
    })
    .strict()
    .superRefine((node, ctx) => {
      for (const [path, value] of [
        ["to", node.to],
        ["subject", node.subject],
        ["body", node.body],
      ] as const) {
        if (typeof value === "string" && value.length > 4000)
          ctx.addIssue({
            code: "custom",
            path: [path],
            message: "Email fields accept at most 4000 characters",
          });
      }
      if (
        typeof node.to === "string" &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(node.to)
      )
        ctx.addIssue({
          code: "custom",
          path: ["to"],
          message: "Email recipient must be a valid address",
        });
    }),
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
    field: fieldPath,
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
      type: z.literal("validate"),
      ...collectionTrigger,
      changedFields: z.array(key).max(50).default([]),
    })
    .strict()
    .superRefine((trigger, ctx) => {
      if (!trigger.conditions?.length)
        ctx.addIssue({
          code: "custom",
          message: "Validation needs at least one forbidden condition",
        });
    }),
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
      intervalMinutes: z.number().int().min(1).max(525600).optional(),
      cron: z.string().trim().min(1).max(100).optional(),
      startAt: z.iso.datetime(),
    })
    .strict()
    .superRefine((trigger, ctx) => {
      const mode = [
        trigger.intervalMinutes !== undefined,
        trigger.cron !== undefined,
      ].filter(Boolean).length;
      if (mode !== 1)
        ctx.addIssue({
          code: "custom",
          message: "Schedule needs either an interval or a cron expression",
        });
      if (trigger.cron !== undefined) {
        try {
          if (cronNextOccurrence(trigger.cron, Date.now()) === null)
            ctx.addIssue({
              code: "custom",
              message: "Cron expression never occurs",
            });
        } catch {
          ctx.addIssue({ code: "custom", message: "Invalid cron expression" });
        }
      }
    }),
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
      if (node.type === "condition" || node.type === "approval")
        outgoing.push(node.otherwise);
      if (node.type === "switch") {
        for (const entry of node.cases) outgoing.push(entry.next);
        outgoing.push(node.otherwise);
      }
      if (node.type === "loop") outgoing.push(node.body);
      if (node.type === "parallel")
        for (const entry of node.branches) outgoing.push(entry);
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
      const available =
        nodes.get(id)?.type === "merge"
          ? new Set(parents.flatMap((parent) => [...parent]))
          : new Set(parents[0] ?? []);
      if (nodes.get(id)?.type !== "merge")
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
    const parallel = parallelRegions(definition);
    for (const node of definition.nodes) {
      if (node.type !== "merge") continue;
      if (
        ![...parallel.regions.values()].some(
          (region) => region.merge === node.id,
        )
      )
        issue(`Merge ${node.id} does not join any parallel branches`);
    }
    for (const [headId, region] of parallel.regions) {
      for (const error of region.errors) issue(error);
      if (!region.merge) continue;
      for (const parent of predecessors.get(region.merge) ?? []) {
        if (!region.ends.includes(parent))
          issue(`Step ${region.merge} only joins parallel ${headId}`);
      }
      for (const member of region.members) {
        const outsiders = (predecessors.get(member) ?? []).filter(
          (parent) => parent !== headId && !region.members.has(parent),
        );
        if (outsiders.length > 0)
          issue(`Step ${member} jumps into parallel ${headId}`);
      }
    }
    for (const head of definition.nodes) {
      if (head.type !== "loop") continue;
      const body = loopBodyMembers(definition, head.id);
      const looped = new Set([head.id, ...body.members]);
      const clash = [...parallel.owner.keys()].some((id) => looped.has(id));
      const parallelClash = [...parallel.heads.keys()].some(
        (id) =>
          looped.has(id) ||
          (parallel.regions.get(id)?.merge &&
            looped.has(parallel.regions.get(id)!.merge!)),
      );
      if (clash || parallelClash)
        issue(`Loop ${head.id} cannot nest parallel branches`);
    }
    if (JSON.stringify(definition).length > 64_000)
      issue("Workflow definition is too large");
  });
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export type ParallelHead = Extract<
  WorkflowDefinition["nodes"][number],
  { type: "parallel" }
>;
export type ParallelRegion = {
  /** Branch entries in declaration order. */
  branches: string[];
  /** The single merge every branch ends at. Empty when invalid. */
  merge: string | null;
  /** Last node of each branch (whose next is the merge). */
  ends: string[];
  /** Every node enclosed by the branches, entries included. */
  members: Set<string>;
  /** Structural problems; the caller turns them into issues. */
  errors: string[];
};
const BRANCH_MEMBER_TYPES = new Set([
  "transform",
  "map",
  "query",
  "create",
  "update",
  "bulkUpdate",
  "task",
  "notification",
  "email",
  "delay",
  "webhook",
  "http",
  "piece",
  "approval",
  "condition",
  "switch",
  "subflow",
]);
function branchOutgoing(node: WorkflowNode): (string | undefined)[] {
  const outgoing: (string | undefined)[] = [node.next];
  if (node.type === "condition" || node.type === "approval")
    outgoing.push(node.otherwise);
  if (node.type === "switch") {
    for (const entry of node.cases) outgoing.push(entry.next);
    outgoing.push(node.otherwise);
  }
  return outgoing;
}
/**
 * Statically enclosed parallel region: branches from each
 * entry to a common merge. Branch interiors may use conditions, switches
 * and subflows as long as every path reaches the same merge. Always
 * terminates; invalid graphs yield errors instead of members.
 */
export function parallelRegion(
  definition: WorkflowDefinition,
  headId: string,
): ParallelRegion {
  const empty: ParallelRegion = {
    branches: [],
    merge: null,
    ends: [],
    members: new Set(),
    errors: [],
  };
  const head = definition.nodes.find((node) => node.id === headId);
  if (!head || head.type !== "parallel") return empty;
  const byId = new Map<string, WorkflowNode>(
    definition.nodes.map((node) => [node.id, node]),
  );
  const branches = [...new Set(head.branches)];
  if (branches.length !== head.branches.length)
    return { ...empty, errors: [`Parallel ${headId} repeats a branch`] };
  if (branches.some((entry) => entry === headId))
    return { ...empty, errors: [`Parallel ${headId} cannot branch to itself`] };
  const members = new Set<string>(),
    ends: string[] = [];
  let merge: string | null = null;
  for (const entry of branches) {
    const stack: string[] = [entry];
    const seen = new Set<string>();
    const local = new Set<string>();
    let reachedMerge = false;
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      const node: WorkflowNode | undefined = byId.get(current);
      if (!node) {
        return {
          ...empty,
          errors: [`Parallel ${headId} branches must end at the merge`],
        };
      }
      if (node.id === headId) {
        return {
          ...empty,
          errors: [`Parallel ${headId} branches cannot cycle`],
        };
      }
      if (node.type === "merge") {
        if (merge === null) merge = node.id;
        if (node.id !== merge)
          return {
            ...empty,
            errors: [`Parallel ${headId} branches must join at one merge`],
          };
        reachedMerge = true;
        continue;
      }
      if (node.type === "loop" || node.type === "parallel")
        return {
          ...empty,
          errors: [`Step ${node.id} cannot run inside parallel branches yet`],
        };
      if (!BRANCH_MEMBER_TYPES.has(node.type))
        return {
          ...empty,
          errors: [`Step ${node.id} cannot run inside parallel branches yet`],
        };
      if (members.has(node.id))
        return {
          ...empty,
          errors: [`Parallel ${headId} branches must not share steps`],
        };
      local.add(node.id);
      members.add(node.id);
      const outgoing = branchOutgoing(node).filter(
        (next): next is string => next !== undefined,
      );
      if (outgoing.length === 0)
        return {
          ...empty,
          errors: [`Parallel ${headId} branches must end at the merge`],
        };
      for (const next of outgoing) {
        if (next === merge || (merge === null && byId.get(next)?.type === "merge")) {
          if (merge === null) merge = next;
          if (next !== merge)
            return {
              ...empty,
              errors: [`Parallel ${headId} branches must join at one merge`],
            };
          reachedMerge = true;
          if (!ends.includes(node.id)) ends.push(node.id);
          continue;
        }
        stack.push(next);
      }
    }
    if (!reachedMerge || merge === null)
      return {
        ...empty,
        errors: [`Parallel ${headId} branches must end at the merge`],
      };
  }
  return { branches, merge, ends, members, errors: [] };
}
/** All regions by head id. Later heads win overlapping members defensively. */
export function parallelRegions(definition: WorkflowDefinition): {
  heads: Map<string, ParallelHead>;
  regions: Map<string, ParallelRegion>;
  owner: Map<string, string>;
} {
  const heads = new Map<string, ParallelHead>(),
    regions = new Map<string, ParallelRegion>(),
    owner = new Map<string, string>();
  for (const node of definition.nodes) {
    if (node.type !== "parallel") continue;
    heads.set(node.id, node);
    const region = parallelRegion(definition, node.id);
    regions.set(node.id, region);
    for (const member of region.members)
      if (!owner.has(member)) owner.set(member, node.id);
  }
  return { heads, regions, owner };
}

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
    if (node.type === "condition" || node.type === "approval")
      outgoing.push(node.otherwise);
    if (node.type === "parallel")
      for (const entry of node.branches) outgoing.push(entry);
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
  /** Pending parallel branch nodes. Empty or absent means single flow. */
  branches?: string[];
  /** Remaining branch ends per merge barrier. Runtime-managed. */
  merges?: Record<string, number>;
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

/** Field lookup inside a record snapshot. Dotted paths traverse `related` preloads; missing segments yield undefined. */
export function snapshotFieldValue(
  snapshot: Record<string, unknown>,
  field: string,
): unknown {
  let current: unknown = snapshot;
  for (const part of field.split(".")) {
    if (
      !safePart(part) ||
      current === null ||
      typeof current !== "object" ||
      !Object.hasOwn(current, part)
    )
      return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
const isRecordNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
/**
 * Record-gate comparison with the same semantics as the collection-event
 * SQL dispatch: missing fields satisfy neither equality nor inequality,
 * numbers compare across integer/real, `false` and `0` are distinct, and
 * `empty` matches missing, null or empty text.
 */
export function matchRecordCondition(
  operator: WorkflowTriggerCondition["operator"],
  actual: unknown,
  expected: WorkflowTriggerCondition["value"],
): boolean {
  switch (operator) {
    case "eq":
      if (actual === undefined) return false;
      if (actual === null || expected === null)
        return actual === null && expected === null;
      if (isRecordNumber(actual) && isRecordNumber(expected))
        return actual === expected;
      return typeof actual === typeof expected && actual === expected;
    case "neq":
      if (actual === undefined) return false;
      return !matchRecordCondition("eq", actual, expected);
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      if (!isRecordNumber(actual) || typeof expected !== "number")
        return false;
      return operator === "gt"
        ? actual > expected
        : operator === "gte"
          ? actual >= expected
          : operator === "lt"
            ? actual < expected
            : actual <= expected;
    case "contains":
      return (
        typeof actual === "string" &&
        typeof expected === "string" &&
        actual.includes(expected)
      );
    case "empty":
      return actual === undefined || actual === null || actual === "";
    case "not_empty":
      return !matchRecordCondition("empty", actual, expected);
  }
}
export function recordMatchesConditions(
  conditions: WorkflowTriggerCondition[] | undefined,
  mode: "all" | "any" | undefined,
  snapshot: Record<string, unknown>,
): boolean {
  if (!conditions?.length) return true;
  const results = conditions.map((condition) =>
    matchRecordCondition(
      condition.operator,
      snapshotFieldValue(snapshot, condition.field),
      condition.value,
    ),
  );
  return mode === "any" ? results.some(Boolean) : results.every(Boolean);
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
