import { describe, it, expect } from "vitest";
import {
  decideRecord,
  decideWrite,
  projectRecord,
  matchesPredicate,
} from "../src/access-evaluator";
import type {
  AccessPolicy,
  AccessGrant,
  AccessRecord,
} from "../src/access-control";
const own = {
  field: "$createdBy",
  op: "eq" as const,
  value: { variable: "principalId" as const },
};
const grant = (patch: Partial<AccessGrant> = {}): AccessGrant => ({
  id: "g1",
  roleId: "r1",
  resource: "collection:clients",
  action: "read",
  predicate: own,
  fields: ["name", "commission"],
  ...patch,
});
const policy = (grants: AccessGrant[]): AccessPolicy => ({
  principalId: "u1",
  scope: "tenant:101",
  revision: 1,
  grants,
});
const record: AccessRecord = {
  id: "c1",
  createdBy: "u2",
  values: { name: "Ada", commission: 12 },
};
describe("scoped record permissions", () => {
  it("does not cross-product fields from a nonmatching role", () => {
    const p = policy([
      grant(),
      grant({
        id: "g2",
        roleId: "r2",
        predicate: { all: true },
        fields: ["name"],
      }),
    ]);
    const d = decideRecord(p, "collection:clients", "read", record);
    expect(d).toEqual({ allowed: true, fields: ["name"], grantIds: ["g2"] });
    expect(projectRecord(record, d).values).toEqual({ name: "Ada" });
  });
  it("denies no grant, wrong action and wrong resource", () => {
    for (const p of [
      policy([]),
      policy([grant({ action: "delete" })]),
      policy([grant({ resource: "collection:other" })]),
    ])
      expect(
        decideRecord(p, "collection:clients", "read", record).allowed,
      ).toBe(false);
  });
  it("allows own records only for a trustworthy creator", () => {
    const p = policy([grant()]);
    expect(
      decideRecord(p, "collection:clients", "read", {
        ...record,
        createdBy: "u1",
      }).allowed,
    ).toBe(true);
    expect(
      decideRecord(p, "collection:clients", "read", {
        ...record,
        createdBy: null,
      }).allowed,
    ).toBe(false);
  });
  it("unions fields only for matching grants and never exposes unlisted keys", () => {
    const p = policy([
      grant({ predicate: { all: true }, fields: ["name"] }),
      grant({ id: "g2", predicate: { all: true }, fields: ["commission"] }),
    ]);
    expect(
      projectRecord(
        record,
        decideRecord(p, "collection:clients", "read", record),
      ).values,
    ).toEqual({ name: "Ada", commission: 12 });
    expect(
      projectRecord(record, {
        allowed: false,
        fields: ["commission"],
        grantIds: [],
      }).values,
    ).toEqual({});
  });
  it("requires one grant to authorize all changed fields and both row states", () => {
    const p = policy([
      grant({ action: "update", predicate: { all: true }, fields: ["name"] }),
      grant({
        id: "g2",
        action: "update",
        predicate: { all: true },
        fields: ["commission"],
      }),
    ]);
    expect(
      decideWrite(
        p,
        "collection:clients",
        "update",
        record,
        { ...record, values: { name: "Grace", commission: 13 } },
        ["name", "commission"],
      ).allowed,
    ).toBe(false);
    expect(
      decideWrite(
        p,
        "collection:clients",
        "update",
        record,
        { ...record, values: { ...record.values, name: "Grace" } },
        ["name"],
      ).allowed,
    ).toBe(true);
    const restricted = policy([
      grant({
        action: "update",
        predicate: { field: "commission", op: "lt", value: { literal: 20 } },
      }),
    ]);
    expect(
      decideWrite(
        restricted,
        "collection:clients",
        "update",
        record,
        { ...record, values: { ...record.values, commission: 21 } },
        ["commission"],
      ).allowed,
    ).toBe(false);
  });
  it("rejects creator, identity and tenant metadata changes", () => {
    const p = policy([
      grant({
        action: "update",
        predicate: { all: true },
        fields: ["name", "tenant_id"],
      }),
    ]);
    expect(
      decideWrite(
        p,
        "collection:clients",
        "update",
        record,
        { ...record, createdBy: "u1" },
        [],
      ).allowed,
    ).toBe(false);
    expect(
      decideWrite(
        p,
        "collection:clients",
        "update",
        record,
        { ...record, id: "other" },
        [],
      ).allowed,
    ).toBe(false);
    expect(
      decideWrite(p, "collection:clients", "update", record, record, [
        "tenant_id",
      ]).allowed,
    ).toBe(false);
  });
  it("authorizes create only with the authenticated creator", () => {
    const p = policy([grant({ action: "create" })]);
    expect(
      decideWrite(
        p,
        "collection:clients",
        "create",
        null,
        { ...record, createdBy: "u1" },
        ["name"],
      ).allowed,
    ).toBe(true);
    expect(
      decideWrite(p, "collection:clients", "create", null, record, ["name"])
        .allowed,
    ).toBe(false);
  });
  it("resolves trusted variables and preserves scalar types", () => {
    const p = policy([]);
    expect(
      matchesPredicate(
        { field: "commission", op: "eq", value: { literal: "12" } },
        p,
        record,
      ),
    ).toBe(false);
    expect(
      matchesPredicate(
        { field: "missing", op: "eq", value: { literal: null } },
        p,
        record,
      ),
    ).toBe(true);
    expect(
      matchesPredicate(
        { field: "commission", op: "in", values: [{ literal: 12 }] },
        p,
        record,
      ),
    ).toBe(true);
    expect(
      matchesPredicate(
        { field: "commission", op: "lt", value: { literal: null } },
        p,
        record,
      ),
    ).toBe(false);
    expect(
      matchesPredicate(
        {
          and: [
            { all: true },
            {
              or: [
                own,
                { field: "commission", op: "gte", value: { literal: 12 } },
              ],
            },
          ],
        },
        p,
        record,
      ),
    ).toBe(true);
  });
  it("does not evaluate inherited object keys", () => {
    expect(
      matchesPredicate(
        { field: "toString", op: "eq", value: { literal: null } },
        policy([]),
        record,
      ),
    ).toBe(true);
  });
});
