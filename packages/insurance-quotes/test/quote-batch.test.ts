import { describe, expect, it, vi } from "vitest";
import type { QuoteBatchItem } from "../src/screens/quote-results";
import {
  quoteSummaryPatch,
  resumedQuoteItems,
  persistQuoteSummary,
} from "../src/quote-batch";

const item = (
  id: string,
  premium: number,
  status: QuoteBatchItem["status"] = "succeeded",
): QuoteBatchItem => ({
  productId: id,
  flowId: id,
  label: id,
  provider: "Insurer",
  premium,
  status,
});

describe("quote batch summaries", () => {
  it("keeps the best successful premium when an expensive retry succeeds", () => {
    expect(
      quoteSummaryPatch([
        item("cheap", 100),
        item("retry", 250),
        item("failed", 1, "failed"),
      ]),
    ).toEqual({ estado: "Recibida", prima: 100 });
  });
  it("updates the best premium after a cheaper retry and ignores invalid premiums", () => {
    expect(
      quoteSummaryPatch([
        item("old", 100),
        item("retry", 50),
        item("invalid", NaN),
      ]),
    ).toEqual({ estado: "Recibida", prima: 50 });
    expect(quoteSummaryPatch([item("failed", 100, "failed")])).toEqual({
      estado: "Rechazada",
      prima: null,
    });
  });
  it("replaces a reselected successful flow instead of retaining its previous offer", () => {
    const saved = [
      { ...item("old display label", 100), flowId: "flow-a" },
      item("keep", 200),
    ];
    const selected = [
      { ...item("catalog-id", 0, "pending"), flowId: "flow-a" },
    ];
    expect(resumedQuoteItems(saved, selected)).toEqual([saved[1], selected[0]]);
  });
  it("serializes summary writes and reads the latest version instead of using a history version", async () => {
    let version = 8;
    const handle = {
      get: vi.fn(async () => ({ _version: version })),
      update: vi.fn(
        async (
          _id: string,
          patch: Record<string, unknown>,
          options: { version: number },
        ) => {
          expect(options.version).toBe(version);
          version += 1;
          return { ...patch, _version: version };
        },
      ),
    };
    await Promise.all([
      persistQuoteSummary(handle, "master", () => ({
        estado: "Recibida",
        prima: 200,
      })),
      persistQuoteSummary(handle, "master", () => ({
        estado: "Recibida",
        prima: 100,
      })),
    ]);
    expect(handle.get).toHaveBeenCalledTimes(2);
    expect(handle.update.mock.calls.map((call) => call[2].version)).toEqual([
      8, 9,
    ]);
  });
  it("surfaces conflicts without retrying and permits the next queued update", async () => {
    const handle = {
      get: vi.fn(async () => ({ _version: 2 })),
      update: vi.fn(async () => ({ _version: 3 })),
    };
    handle.update.mockRejectedValueOnce(new Error("Conflict"));
    await expect(
      persistQuoteSummary(handle, "master", () => ({})),
    ).rejects.toThrow("Conflict");
    await persistQuoteSummary(handle, "master", () => ({}));
    expect(handle.update).toHaveBeenCalledTimes(2);
  });
});
