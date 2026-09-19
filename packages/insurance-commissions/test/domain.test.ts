import { expect, it } from "vitest";
import { validate, calculatedCommission, priority } from "../src/domain";
const record = {
  name: "CM-1",
  customer: "Client",
  policy_reference: "P-1",
  insurer: "Carrier",
  amount: 100,
  paid: 20,
  seller_share: 30,
  stage: "pending",
  due_date: "2026-09-19",
};
it("calculates commission with decimal-safe rounding and rejects invalid allocation", () => {
  expect(calculatedCommission(1000.5, 12.5)).toBe(125.06);
  expect(calculatedCommission(1000, 101)).toBeNull();
  expect(validate(record)).toBeNull();
  expect(validate({ ...record, seller_share: 101 })).toBeTruthy();
  expect(validate({ ...record, paid: 101 })).toBeTruthy();
  expect(priority({ ...record, paid: 100 }, "2026-09-30")).toBe("closed");
});
