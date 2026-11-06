import { expect, it, vi } from "vitest";
import { cents, csv, day, loadRecords } from "../src/data";
import type { PluginApi } from "@savia/studio-shared/plugin-api";
it("validates currency and date-only values without timezone shifts", () => {
  expect(cents("0.29")).toBe(29);
  expect(cents("1.001")).toBeNull();
  expect(cents(-1)).toBeNull();
  expect(cents(null)).toBeNull();
  expect(day("2026-02-30")).toBeNull();
  expect(day("2024-02-29")).not.toBeNull();
  expect(day("2026-09-19T05:00:00Z")).toBe(day("2026-09-19"));
});
it("escapes CSV quotes, line breaks and spreadsheet formula injection", () => {
  expect(csv([["=SUM(A1)", 'A"B', "line\nbreak", "@cmd"]])).toBe(
    '\uFEFF"\'=SUM(A1)","A""B","line\nbreak","\'@cmd"',
  );
});
it("loads every backend page before exposing totals or filters", async () => {
  const list = vi
    .fn()
    .mockResolvedValueOnce({ data: [{ id: "a" }], total: 2 })
    .mockResolvedValueOnce({ data: [{ id: "b" }], total: 2 });
  const savia = {
    collections: {
      collection: () => ({ describe: async () => ({ name: "items" }), list }),
    },
  } as unknown as PluginApi;
  expect(await loadRecords(savia, "items")).toEqual([{ id: "a" }, { id: "b" }]);
  expect(list).toHaveBeenLastCalledWith({
    page: 2,
    perPage: 100,
    sort: "id",
    order: "ASC",
  });
});
it("rejects a missing collection and incomplete pagination", async () => {
  const collection = {
    describe: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ data: [], total: 1 }),
  };
  const savia = {
    collections: { collection: () => collection },
  } as unknown as PluginApi;
  await expect(loadRecords(savia, "items")).rejects.toThrow("Repara");
  collection.describe.mockResolvedValue({ name: "items" });
  await expect(loadRecords(savia, "items")).rejects.toThrow("Actualiza");
});
it("accepts exact decimal currency values across the supported backend range", () => {
  expect(cents(10000000000.03)).toBe(1000000000003);
  expect(cents("89999999999.99")).toBe(8999999999999);
  expect(cents(90000000000)).toBe(9000000000000);
  expect(cents("90071992547409.92")).toBeNull();
});
it("rejects shifted pagination rather than silently deduplicating incomplete totals", async () => {
  const list = vi
    .fn()
    .mockResolvedValueOnce({ data: [{ id: "b" }, { id: "c" }], total: 4 })
    .mockResolvedValueOnce({
      data: [{ id: "c" }, { id: "d" }, { id: "e" }],
      total: 5,
    });
  const savia = {
    collections: {
      collection: () => ({ describe: async () => ({ name: "items" }), list }),
    },
  } as unknown as PluginApi;
  await expect(loadRecords(savia, "items")).rejects.toThrow("Actualiza");
});
it("rejects repeated records even when a concurrent delete keeps the total stable", async () => {
  const list = vi
    .fn()
    .mockResolvedValueOnce({ data: [{ id: "b" }, { id: "c" }], total: 4 })
    .mockResolvedValueOnce({ data: [{ id: "c" }, { id: "d" }], total: 4 });
  const savia = {
    collections: {
      collection: () => ({ describe: async () => ({ name: "items" }), list }),
    },
  } as unknown as PluginApi;
  await expect(loadRecords(savia, "items")).rejects.toThrow("Actualiza");
});
it("keeps the latest received-payment date when an older receipt is entered later", async () => {
  const { paymentPatch } = await import("../src/financial");
  expect(
    paymentPatch(
      { id: "a", amount: 100, paid: 20, last_payment_date: "2026-09-19" },
      "10",
      "2026-09-18",
    ),
  ).toEqual({ paid: 30, last_payment_date: "2026-09-19" });
  expect(
    paymentPatch(
      { id: "a", amount: 100, paid: 20, last_payment_date: "invalid" },
      "10",
      "2026-09-18",
    ),
  ).toEqual({ paid: 30, last_payment_date: "2026-09-18" });
});
