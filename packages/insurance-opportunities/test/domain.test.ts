import { expect, it } from "vitest";
import { validate, weightedPremium, priority } from "../src/domain";
const record = {
  name: "OP-1",
  customer: "Prospect",
  owner: "Adviser",
  target_date: "2026-09-20",
  premium: 1000,
  probability: 25,
  stage: "qualified",
};
it("bounds probability and requires the result when closing a deal", () => {
  expect(validate(record)).toBeNull();
  expect(weightedPremium(record)).toBe(250);
  expect(validate({ ...record, probability: 101 })).toBeTruthy();
  expect(validate({ ...record, stage: "won" })).toBeTruthy();
  expect(validate({ ...record, stage: "won", outcome: "P-2" })).toBeNull();
  expect(priority({ ...record, stage: "lost" }, "2026-09-30")).toBe("closed");
});
