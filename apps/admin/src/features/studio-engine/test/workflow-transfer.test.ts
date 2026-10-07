import { expect, it } from "vitest";
import { makeConfig } from "@savia/studio-shared/metadata";
import { auditWorkflowImport } from "../workflow-transfer";

const objects = [
  {
    name: "orders",
    label: "Orders",
    config: makeConfig({
      amount: { type: "Number", label: "Amount" },
      customer: {
        type: "Textbox",
        label: "Customer",
        config: { relation: "customers" },
      },
    }),
  },
  {
    name: "customers",
    label: "Customers",
    config: makeConfig({ tier: { type: "Textbox", label: "Tier" } }),
  },
] as any;

it("accepts valid related condition paths", () => {
  const audit = auditWorkflowImport(
    {
      trigger: {
        type: "validate",
        collection: "orders",
        conditions: [
          { field: "related.customer.tier", operator: "eq", value: "banned" },
        ],
      },
      nodes: [{ id: "note", type: "transform", values: {} }],
    } as any,
    objects,
  );
  expect(audit.missingCollections).toEqual([]);
  expect(audit.unknownFields).toEqual([]);
});

it("flags unknown related targets and missing relations", () => {
  const audit = auditWorkflowImport(
    {
      trigger: {
        type: "validate",
        collection: "orders",
        conditions: [
          { field: "related.customer.missing", operator: "eq", value: "x" },
          { field: "related.ghost.tier", operator: "eq", value: "x" },
        ],
      },
      nodes: [{ id: "note", type: "transform", values: {} }],
    } as any,
    objects,
  );
  expect(audit.unknownFields).toContain("orders: related.customer.missing");
  expect(audit.missingCollections).toContain("ghost");
});
