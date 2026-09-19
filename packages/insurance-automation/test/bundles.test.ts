import { expect, it } from "vitest";
import { bundles } from "../src/bundles";
import {
  workflowDefinitionSchema,
  evaluateWorkflowCondition,
} from "@savia/crm-shared/workflows";
import { manifest } from "../src/manifest";
import { readFileSync } from "node:fs";
it("ships valid linked workflow graphs and a matching manifest", () => {
  for (const bundle of bundles)
    for (const flow of bundle.workflows)
      expect(
        workflowDefinitionSchema.safeParse(flow.definition).success,
        flow.name,
      ).toBe(true);
  expect(
    JSON.parse(
      readFileSync(new URL("../savia-extension.json", import.meta.url), "utf8"),
    ),
  ).toEqual(manifest);
});
it("compares real calendar dates without lexical or numeric coercion", () => {
  const node = {
    id: "dates",
    type: "condition" as const,
    left: { ref: "trigger.end" },
    operator: "date_after" as const,
    right: { ref: "trigger.start" },
  };
  const check = (start: unknown, end: unknown) =>
    evaluateWorkflowCondition(node, {
      trigger: { start, end },
      before: {},
      steps: {},
      system: {},
    });
  expect(check("2026-09-01", "2027-09-01")).toBe(true);
  expect(check("2026-09-01", "2026-09-01")).toBe(false);
  expect(check("2026-02-30", "2026-09-01")).toBe(false);
  expect(check(null, "2027-09-01")).toBe(false);
});
it("uses per-term idempotency and checks current state after the advance reminder delay", () => {
  const renewal = bundles.find(
    (bundle) => bundle.id === "insurance.policy-renewal",
  )!;
  const create = renewal.workflows[0].definition.nodes.find(
    (node) => node.type === "create",
  )!;
  expect(create).toMatchObject({
    matchField: "term_key",
    values: {
      term_key: {
        concat: [{ ref: "trigger.id" }, ":", { ref: "trigger.fin" }],
      },
    },
  });
  const reminders = bundles.find(
    (bundle) => bundle.id === "insurance.renewal-followup",
  )!;
  expect(reminders.workflows[0].definition.nodes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "delay",
        until: {
          dateOffset: { value: { ref: "trigger.expiry_date" }, days: -30 },
        },
        next: "current",
      }),
      expect.objectContaining({
        id: "current",
        type: "query",
        collection: "insurance_renewals",
      }),
    ]),
  );
});
