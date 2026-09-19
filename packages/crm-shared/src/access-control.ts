import { z } from "zod";

export type AccessScope = "platform" | `tenant:${number}` | `domain:${string}`;
export type AccessAction =
  | "read"
  | "create"
  | "update"
  | "delete"
  | "restore"
  | "import"
  | "export"
  | "execute"
  | "configure"
  | "manage";
export type AccessResource =
  `collection:${string}` | `page:${string}` | `capability:${string}`;
export type Scalar = string | number | boolean | null;
export type Operand =
  { literal: Scalar } | { variable: "principalId" | "tenantId" };
export type AccessPredicate =
  | { all: true }
  | { and: AccessPredicate[] }
  | { or: AccessPredicate[] }
  | { field: string; op: "eq" | "lt" | "lte" | "gt" | "gte"; value: Operand }
  | { field: string; op: "in"; values: Operand[] };
export type AccessGrant = {
  id: string;
  roleId: string;
  resource: AccessResource;
  action: AccessAction;
  predicate: AccessPredicate;
  fields: string[];
};
export type AccessPolicy = {
  principalId: string;
  scope: AccessScope;
  revision: number;
  grants: AccessGrant[];
};
export type AccessRecord = {
  id: string;
  createdBy: string | null;
  values: Record<string, unknown>;
};
export type AccessDecision = {
  allowed: boolean;
  fields: string[];
  grantIds: string[];
};
export const accessActions = [
  "read",
  "create",
  "update",
  "delete",
  "restore",
  "import",
  "export",
  "execute",
  "configure",
  "manage",
] as const;
export const accessActionSchema = z.enum(accessActions);
export const accessScopeSchema = z
  .string()
  .max(100)
  .refine((value) => {
    if (value === "platform") return true;
    if (/^domain:[a-z][a-z0-9_-]{0,47}$/.test(value)) return true;
    const match = /^tenant:([1-9][0-9]*)$/.exec(value);
    return Boolean(match && Number.isSafeInteger(Number(match[1])));
  }, "Invalid access scope")
  .transform((value) => value as AccessScope);
export const accessResourceSchema = z
  .string()
  .regex(/^(collection|page|capability):[a-zA-Z0-9_][a-zA-Z0-9_.:-]{0,127}$/)
  .transform((v) => v as AccessResource);
export const accessFieldSchema = z
  .string()
  .max(128)
  .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
  .refine((v) => !["__proto__", "prototype", "constructor"].includes(v));
const scalarSchema = z.union([
  z.string().max(4096),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const operandSchema: z.ZodType<Operand> = z.union([
  z.object({ literal: scalarSchema }).strict(),
  z.object({ variable: z.enum(["principalId", "tenantId"]) }).strict(),
]);
const predicateFieldSchema = z.union([
  z.literal("$createdBy"),
  accessFieldSchema,
]);
const recursivePredicate: z.ZodType<AccessPredicate> = z.lazy(() =>
  z.union([
    z.object({ all: z.literal(true) }).strict(),
    z.object({ and: z.array(recursivePredicate).min(1).max(200) }).strict(),
    z.object({ or: z.array(recursivePredicate).min(1).max(200) }).strict(),
    z
      .object({
        field: predicateFieldSchema,
        op: z.enum(["eq", "lt", "lte", "gt", "gte"]),
        value: operandSchema,
      })
      .strict(),
    z
      .object({
        field: predicateFieldSchema,
        op: z.literal("in"),
        values: z.array(operandSchema).min(1).max(100),
      })
      .strict(),
  ]),
);
// Bound before recursive parsing, including cyclic/non-JSON programmatic inputs.
export const accessPredicateSchema = z
  .unknown()
  .superRefine((input, context) => {
    const pending: Array<{ value: unknown; depth: number }> = [
      { value: input, depth: 1 },
    ];
    const visited = new Set<object>();
    let nodes = 0;
    while (pending.length) {
      const { value, depth } = pending.pop()!;
      if (++nodes > 200 || depth > 16) {
        context.addIssue({
          code: "custom",
          message: "Predicate complexity exceeded",
        });
        return;
      }
      if (!value || typeof value !== "object") continue;
      if (visited.has(value)) {
        context.addIssue({
          code: "custom",
          message: "Repeated predicate object",
        });
        return;
      }
      visited.add(value);
      for (const key of ["and", "or"]) {
        const children = (value as Record<string, unknown>)[key];
        if (Array.isArray(children)) {
          if (children.length > 200) {
            context.addIssue({
              code: "custom",
              message: "Predicate complexity exceeded",
            });
            return;
          }
          for (const child of children)
            pending.push({ value: child, depth: depth + 1 });
        }
      }
    }
  })
  .pipe(recursivePredicate);
export const accessGrantSchema = z
  .object({
    id: z.string().min(1).max(200),
    roleId: z.string().min(1).max(200),
    resource: accessResourceSchema,
    action: accessActionSchema,
    predicate: accessPredicateSchema,
    fields: z.array(accessFieldSchema).max(500),
  })
  .strict();
export const accessPolicySchema = z
  .object({
    principalId: z.string().min(1).max(200),
    scope: accessScopeSchema,
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    grants: z.array(accessGrantSchema).max(2000),
  })
  .strict();
export const protectedAccessFields = new Set([
  "id",
  "tenant_id",
  "tenantId",
  "agency_id",
  "created_by",
  "createdBy",
  "$createdBy",
  "created_at",
  "updated_at",
  "deleted_at",
  "_version",
  "__proto__",
  "prototype",
  "constructor",
]);
