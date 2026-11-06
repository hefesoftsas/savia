import { describe, expect, it } from "vitest";

import type { NativeWorkflow } from "@/services/native-workflow-service";
import { filterNativeWorkflows } from "./native-flows-catalog";

const workflows: NativeWorkflow[] = [
  {
    id: "flow-1",
    name: "Nightly invoices",
    revision: 1,
    enabled: 0,
    definition: {
      trigger: {
        type: "schedule",
        intervalMinutes: 1440,
        startAt: "2026-10-12T00:00:00.000Z",
      },
      nodes: [{ id: "step_1", type: "transform", values: {} }],
    },
  },
  {
    id: "flow-2",
    name: "Notify on customer update",
    revision: 3,
    enabled: 1,
    definition: {
      trigger: { type: "created", collection: "customers" },
      nodes: [{ id: "step_1", type: "transform", values: {} }],
    },
  },
];

describe("filterNativeWorkflows", () => {
  it("searches native workflow names and trigger types case-insensitively", () => {
    expect(
      filterNativeWorkflows(workflows, "NIGHTLY").map((flow) => flow.id),
    ).toEqual(["flow-1"]);
    expect(
      filterNativeWorkflows(workflows, "created").map((flow) => flow.id),
    ).toEqual(["flow-2"]);
  });

  it("returns all workflows for an empty query and none for an unmatched query", () => {
    expect(filterNativeWorkflows(workflows, " ")).toEqual(workflows);
    expect(filterNativeWorkflows(workflows, "refunds")).toEqual([]);
  });
});
