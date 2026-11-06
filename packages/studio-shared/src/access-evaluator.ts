import type {
  AccessAction,
  AccessDecision,
  AccessGrant,
  AccessPolicy,
  AccessPredicate,
  AccessRecord,
  AccessResource,
  Operand,
  Scalar,
} from "./access-control";
import { protectedAccessFields } from "./access-control";
const denied = (): AccessDecision => ({
  allowed: false,
  fields: [],
  grantIds: [],
});
const operand = (value: Operand, policy: AccessPolicy): Scalar =>
  "literal" in value
    ? value.literal
    : value.variable === "principalId"
      ? policy.principalId
      : policy.scope.startsWith("tenant:")
        ? Number(policy.scope.slice(7))
        : null;
const compareStrings = (a: string, b: string) => {
  const encoder = new TextEncoder(),
    left = encoder.encode(a),
    right = encoder.encode(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++)
    if (left[i] !== right[i]) return left[i]! - right[i]!;
  return left.length - right.length;
};
export function matchesPredicate(
  predicate: AccessPredicate,
  policy: AccessPolicy,
  record: AccessRecord,
): boolean {
  if ("all" in predicate) return predicate.all === true;
  if ("and" in predicate)
    return (
      predicate.and.length > 0 &&
      predicate.and.every((p) => matchesPredicate(p, policy, record))
    );
  if ("or" in predicate)
    return predicate.or.some((p) => matchesPredicate(p, policy, record));
  const left =
    predicate.field === "$createdBy"
      ? record.createdBy
      : Object.hasOwn(record.values, predicate.field)
        ? (record.values[predicate.field] ?? null)
        : null;
  if (predicate.op === "in")
    return predicate.values.some((v) => left === operand(v, policy));
  const right = operand(predicate.value, policy);
  if (predicate.op === "eq") return left === right;
  if (left === null || right === null || typeof left !== typeof right)
    return false;
  const compared =
    typeof left === "number" && typeof right === "number"
      ? left - right
      : typeof left === "string" && typeof right === "string"
        ? compareStrings(left, right)
        : NaN;
  switch (predicate.op) {
    case "lt":
      return compared < 0;
    case "lte":
      return compared <= 0;
    case "gt":
      return compared > 0;
    case "gte":
      return compared >= 0;
  }
}
function decision(grants: AccessGrant[]): AccessDecision {
  return {
    allowed: grants.length > 0,
    fields: [...new Set(grants.flatMap((g) => g.fields))].sort(),
    grantIds: [...new Set(grants.map((g) => g.id))].sort(),
  };
}
export function decideRecord(
  policy: AccessPolicy,
  resource: AccessResource,
  action: AccessAction,
  record: AccessRecord,
): AccessDecision {
  return decision(
    policy.grants.filter(
      (g) =>
        g.resource === resource &&
        g.action === action &&
        matchesPredicate(g.predicate, policy, record),
    ),
  );
}
export function projectRecord(
  record: AccessRecord,
  access: AccessDecision,
): AccessRecord {
  return {
    id: record.id,
    createdBy: record.createdBy,
    values: Object.fromEntries(
      access.allowed
        ? access.fields
            .filter((f) => Object.hasOwn(record.values, f))
            .map((f) => [f, record.values[f]])
        : [],
    ),
  };
}
export function decideWrite(
  policy: AccessPolicy,
  resource: AccessResource,
  action: "create" | "update",
  before: AccessRecord | null,
  after: AccessRecord,
  changedFields: string[],
): AccessDecision {
  if (
    action === "create"
      ? before !== null || after.createdBy !== policy.principalId
      : !before ||
        before.id !== after.id ||
        before.createdBy !== after.createdBy
  )
    return denied();
  const actual = Object.keys({ ...before?.values, ...after.values }).filter(
    (key) =>
      JSON.stringify(before?.values[key]) !== JSON.stringify(after.values[key]),
  );
  const fields = [...new Set([...changedFields, ...actual])];
  if (fields.some((f) => protectedAccessFields.has(f))) return denied();
  return decision(
    policy.grants.filter(
      (g) =>
        g.resource === resource &&
        g.action === action &&
        fields.every((f) => g.fields.includes(f)) &&
        matchesPredicate(g.predicate, policy, after) &&
        (!before || matchesPredicate(g.predicate, policy, before)),
    ),
  );
}
