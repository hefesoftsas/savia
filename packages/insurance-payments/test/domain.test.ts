import { describe, it, expect } from "vitest";
import { importStatement, allocate, parseStatement } from "../src/domain";
describe("bank reconciliation", () => {
  const row = {
    id: "bank:1",
    date: "2026-01-01",
    reference: "P1",
    amount: 10000,
  };
  it("parses cents and rejects duplicate transactions across imports", () => {
    expect(
      parseStatement(
        "id,date,reference,amount\n1,2026-01-01,P1,0.29",
        "bank",
      )[0].amount,
    ).toBe(29);
    expect(() =>
      importStatement({ transactions: [row], allocations: [] }, [row]),
    ).toThrow();
  });
  it("rejects over-allocation and retains exact partial differences", () => {
    const state = { transactions: [row], allocations: [] };
    const next = allocate(
      state,
      row.id,
      { id: "o1", amount: "100", paid: "0" },
      "33.33",
    );
    expect(next.allocations[0].amount).toBe(3333);
    expect(() =>
      allocate(next, row.id, { id: "o1", amount: "100", paid: "0" }, "66.68"),
    ).toThrow();
  });
  it("rejects malformed dates and fractional cents", () => {
    expect(() =>
      parseStatement("id,date,reference,amount\n1,2026-02-30,P1,2", "bank"),
    ).toThrow();
    expect(() =>
      parseStatement("id,date,reference,amount\n1,2026-01-01,P1,0.001", "bank"),
    ).toThrow();
  });
});
import { vi } from "vitest";
import { saveState } from "../src/support";
import type { PluginApi } from "@savia/studio-shared/plugin-api";
it("propagates version conflicts without automatic overwrite", async () => {
  const replace = vi.fn().mockRejectedValue(new Error("version conflict"));
  const api = { settings: { replace } } as unknown as PluginApi;
  await expect(
    saveState(api, { transactions: [], allocations: [] }, 7),
  ).rejects.toThrow("version conflict");
  expect(replace).toHaveBeenCalledExactlyOnceWith(
    { transactions: [], allocations: [] },
    7,
  );
});
it("rejects duplicate IDs inside one import and unsafe money", () => {
  const rows = parseStatement(
    "id,date,reference,amount\n1,2026-01-01,P1,1\n1,2026-01-01,P1,1",
    "bank",
  );
  expect(() =>
    importStatement({ transactions: [], allocations: [] }, rows),
  ).toThrow();
  expect(() =>
    parseStatement(
      "id,date,reference,amount\n1,2026-01-01,P1,9007199254740992",
      "bank",
    ),
  ).toThrow();
});
it("supports escaped CSV references and distinct account scopes", () => {
  const a = parseStatement(
    'id,date,reference,amount\n1,2026-01-01,"Policy, ""A""",1',
    "bank",
  );
  expect(a[0].reference).toBe('Policy, "A"');
  const b = parseStatement(
    "id,date,reference,amount\n1,2026-01-01,P1,1",
    "other",
  );
  expect(
    importStatement({ transactions: a, allocations: [] }, b).transactions,
  ).toHaveLength(2);
});
