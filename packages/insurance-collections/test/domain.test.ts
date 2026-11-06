import { describe, expect, it } from "vitest";
import { balance, aging, paymentPatch, validateAccount } from "../src/domain";
const account = {
  id: "a",
  _version: 3,
  name: "AC-01",
  customer: "Example",
  due_date: "2026-09-01",
  amount: 100.3,
  paid: 20.1,
  stage: "pending",
};
describe("collections", () => {
  it("computes balances in cents and ages open debt by calendar date", () => {
    expect(balance(account)).toBe(80.2);
    expect(aging(account, "2026-09-19")).toBe("1-30");
    expect(aging({ ...account, paid: 100.3 }, "2026-09-19")).toBe("settled");
    expect(aging({ ...account, due_date: "2026-09-19" }, "2026-09-19")).toBe(
      "current",
    );
    expect(aging({ ...account, due_date: "2026-02-30" }, "2026-09-19")).toBe(
      "undated",
    );
  });
  it("records partial/full payment without floating point drift", () => {
    expect(paymentPatch(account, "80.20", "2026-09-19")).toEqual({
      paid: 100.3,
      last_payment_date: "2026-09-19",
    });
  });
  it.each(["0", "-1", "80.21", "NaN", "Infinity", "0.001", ""])(
    "rejects invalid payments: %s",
    (value) => {
      expect(() => paymentPatch(account, value, "2026-09-19")).toThrow();
    },
  );
  it("rejects corrupt balances, invalid dates and overpayments", () => {
    expect(() =>
      paymentPatch({ ...account, paid: -10 }, "10", "2026-09-19"),
    ).toThrow();
    expect(() => paymentPatch(account, "10", "2026-02-30")).toThrow();
    expect(validateAccount({ ...account, paid: 101 })).toBeTruthy();
    expect(validateAccount(account)).toBeNull();
  });
});
