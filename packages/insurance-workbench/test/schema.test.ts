import { expect, it } from "vitest";
import { objectRequirement, validateFields } from "../src/schema";
import {
  createExtensionRegistry,
  createExtensionObjectRequirements,
} from "@savia/crm-shared/extension-package";
import type { Field } from "../src/types";
const fields: Field[] = [
  { key: "name", label: "Reference", required: true },
  { key: "amount", label: "Amount", type: "number", min: 0, max: 100 },
  {
    key: "stage",
    label: "Stage",
    type: "select",
    options: [
      { value: "open", label: "Open" },
      { value: "done", label: "Done" },
    ],
    required: true,
  },
  { key: "outcome", label: "Outcome", requiredStages: ["done"] },
];
it("validates conditional closure, numeric bounds and options", () => {
  expect(
    validateFields(fields, { name: "a", amount: 100, stage: "open" }),
  ).toBeNull();
  expect(
    validateFields(fields, { name: "a", amount: 101, stage: "open" }),
  ).toBeTruthy();
  expect(
    validateFields(fields, { name: "a", amount: 1, stage: "done" }),
  ).toBeTruthy();
  expect(
    validateFields(fields, {
      name: "a",
      amount: 1,
      stage: "done",
      outcome: "Issued",
    }),
  ).toBeNull();
  expect(validateFields(fields, { name: "a", stage: "unknown" })).toBeTruthy();
});
it("creates a host-valid collection requirement including backend closure validation", () => {
  const manifest = {
    format: "savia.extension" as const,
    formatVersion: 1 as const,
    id: "insurance.example",
    version: "1.0.0",
    label: "Example",
    description: "",
    requires: [],
    apiVersion: 1 as const,
  };
  const requirement = objectRequirement(manifest, "insurance_example", fields);
  const result = createExtensionObjectRequirements(
    createExtensionRegistry([{ manifest }]),
    [requirement],
  ).get(manifest.id)!;
  expect(result.object.config.fields.outcome.config?.requiredWhen).toEqual({
    field: "stage",
    op: "in",
    value: ["done"],
  });
});
