import { it, expect } from "vitest";
import {
  accessPolicySchema,
  accessPredicateSchema,
  accessScopeSchema,
} from "../src/access-control";
it("accepts only canonical positive tenant scopes", () => {
  for (const value of [
    "tenant:0",
    "tenant:-1",
    "tenant:01",
    "tenant:1.5",
    "tenant:9007199254740993",
    "domain:",
    "other",
  ])
    expect(accessScopeSchema.safeParse(value).success).toBe(false);
  for (const value of ["platform", "tenant:101", "domain:claims"])
    expect(accessScopeSchema.safeParse(value).success).toBe(true);
});
it("rejects malformed, oversized and executable predicates", () => {
  for (const value of [
    { and: [] },
    { or: [] },
    { sql: "1=1" },
    { field: "name", op: "exec", value: { literal: "x" } },
    { field: "name", op: "eq", value: { variable: "request.header" } },
    { all: true, extra: 1 },
  ])
    expect(accessPredicateSchema.safeParse(value).success).toBe(false);
  let deep: unknown = { all: true };
  for (let n = 0; n < 20; n++) deep = { and: [deep] };
  expect(accessPredicateSchema.safeParse(deep).success).toBe(false);
  expect(
    accessPredicateSchema.safeParse({
      or: Array.from({ length: 201 }, () => ({ all: true })),
    }).success,
  ).toBe(false);
  expect(
    accessPredicateSchema.safeParse({
      field: "id",
      op: "in",
      values: Array.from({ length: 101 }, () => ({ literal: 1 })),
    }).success,
  ).toBe(false);
});
it("rejects malformed scopes, nonfinite values, unknown properties and wildcard fields", () => {
  const p = { principalId: "u", scope: "tenant:101", revision: 0, grants: [] };
  expect(accessPolicySchema.safeParse(p).success).toBe(true);
  expect(accessPolicySchema.safeParse({ ...p, revision: -1 }).success).toBe(
    false,
  );
  expect(accessPolicySchema.safeParse({ ...p, admin: true }).success).toBe(
    false,
  );
  expect(
    accessPredicateSchema.safeParse({
      field: "age",
      op: "eq",
      value: { literal: Infinity },
    }).success,
  ).toBe(false);
  const g = {
    id: "g",
    roleId: "r",
    resource: "collection:clients",
    action: "read",
    predicate: { all: true },
    fields: ["*"],
  };
  expect(accessPolicySchema.safeParse({ ...p, grants: [g] }).success).toBe(
    false,
  );
});
