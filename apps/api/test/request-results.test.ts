import { jsonPointer } from "@savia/studio-shared/collection-operations";
import { describe, expect, it } from "vitest";
import { normalizeResult } from "../src/request-results/normalize";
const run = {
  id: "run",
  flowId: "inventory",
  versionId: null,
  createdAt: "2026-09-12",
  mode: "mock" as const,
  status: "success",
  result: { response: { items: [{ sku: "A", quantity: 4, token: "hidden" }] } },
  steps: [],
};
describe("industry neutral results", () => {
  it("preserves arbitrary structured data with secrets removed", () => {
    const out = normalizeResult(
      { id: "inventory", provider: "SURA", kind: "lookup" },
      run,
    );
    expect(out.type).toBe("request");
    expect(out.status).toBe("success");
    expect(jsonPointer(out, "/data/result/items/0/quantity")).toBe(4);
    expect(jsonPointer(out.data, "/result/items/0/sku")).toBe("A");
    expect(out.data).toEqual({
      result: { items: [{ sku: "A", quantity: 4 }] },
    });
  });
  const selectiveNormalizer = {
    id: "example.normalizer",
    matches: (flow: { id: string }) => flow.id === "example-flow",
    normalize: () => ({
      schemaVersion: "1.0" as const,
      type: "request" as const,
      status: "success" as const,
      data: { result: { normalized: true } },
      errors: [],
      warnings: [],
      metadata: {
        provider: null,
        flowId: "example-flow",
        runId: "run",
        versionId: null,
        createdAt: "2026-09-12",
        simulated: true,
        adapter: "example.normalizer",
        providerFields: {},
      },
    }),
  };
  it("does not infer an extension result from a vendor or generic lookup kind", () => {
    expect(
      normalizeResult(
        { id: "inventory", provider: "SURA", kind: "lookup" },
        run,
        [selectiveNormalizer],
      ).type,
    ).toBe("request");
  });
  it("activates a registered extension adapter only for its recognized flow", () => {
    const flow = { id: "example-flow" };
    expect(normalizeResult(flow, run).type).toBe("request");
    expect(normalizeResult(flow, run, [selectiveNormalizer]).data).toEqual({
      result: { normalized: true },
    });
  });
  it("preserves false and explicit null response values", () => {
    for (const response of [false, null, 0, ""])
      expect(
        normalizeResult(
          { id: "inventory" },
          { ...run, result: { response }, steps: [{ responseJson: "stale" }] },
        ).data,
      ).toEqual({ result: response });
  });
});
