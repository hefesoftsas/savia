import { it, expect } from "vitest";
import { blueprint, verifyAccess, requestInput } from "../src/domain";
import { decideRecord, decideWrite } from "@savia/crm-shared/access-evaluator";
const policy = () => ({
  principalId: "u1",
  scope: "tenant:101" as const,
  revision: 1,
  grants: blueprint("customer-a").map((g, i) => ({
    ...g,
    id: String(i),
    roleId: "customer-a",
  })),
});
it("verifies one customer and denies other customer policies in the native evaluator", () => {
  const p = policy();
  expect(verifyAccess(p)).toBe("customer-a");
  expect(
    decideRecord(p, "collection:polizas", "read", {
      id: "1",
      createdBy: null,
      values: { cliente: "customer-a" },
    }).allowed,
  ).toBe(true);
  expect(
    decideRecord(p, "collection:polizas", "read", {
      id: "2",
      createdBy: null,
      values: { cliente: "customer-b" },
    }).allowed,
  ).toBe(false);
});
it("fails closed on broad additive grants or missing capabilities", () => {
  const p = policy();
  p.grants.push({ ...p.grants[0], id: "broad", predicate: { all: true } });
  expect(() => verifyAccess(p)).toThrow();
  expect(() => verifyAccess(null)).toThrow();
  const missing = policy();
  missing.grants.pop();
  expect(() => verifyAccess(missing)).toThrow();
});
it("rejects cross-customer submissions, writes to response and forged completion", () => {
  const p = policy(),
    values = requestInput("customer-a", {
      name: "Help",
      kind: "claim",
      details: "A claim needs review",
      policy_reference: "P1",
    });
  expect(
    decideWrite(
      p,
      "collection:insurance_customer_portal",
      "create",
      null,
      { id: "new", createdBy: "u1", values },
      Object.keys(values),
    ).allowed,
  ).toBe(true);
  for (const patch of [
    { customer_id: "customer-b" },
    { stage: "resolved" },
    { response: "Forged" },
  ]) {
    const changed = { ...values, ...patch };
    expect(
      decideWrite(
        p,
        "collection:insurance_customer_portal",
        "create",
        null,
        { id: "new", createdBy: "u1", values: changed },
        Object.keys(changed),
      ).allowed,
    ).toBe(false);
  }
});
it("keeps customer writes immutable while permitting own attachment action", () => {
  const p = policy(),
    record = {
      id: "r",
      createdBy: "u1",
      values: { customer_id: "customer-a", stage: "received" },
    };
  expect(
    decideRecord(p, "collection:insurance_customer_portal", "update", record)
      .allowed,
  ).toBe(true);
  expect(
    decideWrite(
      p,
      "collection:insurance_customer_portal",
      "update",
      record,
      { ...record, values: { ...record.values, customer_id: "customer-b" } },
      ["customer_id"],
    ).allowed,
  ).toBe(false);
});
