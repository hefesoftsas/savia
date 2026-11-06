import { it, expect } from "vitest";
import { journal, exportJournal } from "../src/domain";
it("balances each invoice exactly and protects spreadsheet formulas", () => {
  const entries = journal(
    [{ id: "1", name: "=CMD()", amount: "0.29" }],
    "1305",
    "4135",
  );
  expect(entries.reduce((n, e) => n + e.debit - e.credit, 0)).toBe(0);
  expect(exportJournal(entries)).toContain("'=CMD()");
});
it("rejects identical accounts and invalid amounts", () => {
  expect(() => journal([{ id: "1", amount: "1" }], "1", "1")).toThrow();
  expect(() => journal([{ id: "1", amount: "1.001" }], "1", "2")).toThrow();
});
import { stateSchema, addBatch, defaults } from "../src/domain";
it("rejects unbalanced persisted entries and duplicate invoice batches", () => {
  const entries = journal([{ id: "1", amount: "12.30" }], "1", "2");
  expect(() =>
    stateSchema.parse({
      batches: [{ id: "1", createdAt: "2026-01-01", entries: [entries[0]] }],
    }),
  ).toThrow();
  const batch = { id: "b1", createdAt: "2026-01-01", entries };
  expect(() =>
    addBatch(addBatch(defaults, batch), { ...batch, id: "b2" }),
  ).toThrow();
});
