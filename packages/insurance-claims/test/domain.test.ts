import { expect, it } from "vitest";
import { validate, priority } from "../src/domain";
const record = {
  name: "CL-1",
  customer: "Client",
  policy_reference: "P-1",
  incident_date: "2026-09-01",
  notified_date: "2026-09-02",
  amount: 100,
  paid: 0,
  stage: "reported",
  next_follow_up: "2026-09-19",
};
it("requires ordered incident/notification dates and a documented closure", () => {
  expect(validate(record)).toBeNull();
  expect(validate({ ...record, notified_date: "2026-08-31" })).toBeTruthy();
  expect(validate({ ...record, stage: "closed" })).toBeTruthy();
  expect(
    validate({ ...record, stage: "closed", outcome: "Claim resolved" }),
  ).toBeNull();
  expect(priority({ ...record, stage: "closed" }, "2026-09-30")).toBe("closed");
  expect(priority(record, "2026-09-19")).toBe("today");
});
