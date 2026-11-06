import { it, expect } from "vitest";
import { settle } from "../src/domain";
it("rounds each share in cents and applies signed adjustments", () => {
  const result = settle(
    [{ id: "1", amount: "0.29", paid: "0.29", owner: "Ana" }],
    "50",
    "-0.01",
  );
  expect(result.lines[0].amount).toBe(15);
  expect(result.total).toBe(14);
});
it("rejects a negative payable and excessive rate", () => {
  expect(() =>
    settle([{ id: "1", amount: "1", paid: "1" }], "101", "0"),
  ).toThrow();
  expect(() =>
    settle([{ id: "1", amount: "1", paid: "1" }], "50", "-1"),
  ).toThrow();
});
import { addBatch, defaults } from "../src/domain";
it("rejects repeating a settled commission in a later batch", () => {
  const batch = {
    ...settle([{ id: "1", amount: "100", paid: "100" }], "25", "0"),
    id: "b1",
    createdAt: "2026-01-01",
  };
  expect(() =>
    addBatch(addBatch(defaults, batch), { ...batch, id: "b2" }),
  ).toThrow();
});
it("rejects unpaid and partially collected sources before permanently settling them", () => {
  for (const paid of ["0", "50"]) {
    expect(() =>
      settle([{ id: "partial", amount: "100", paid }], "25", "0"),
    ).toThrow();
  }
});
