import { expect, it } from "vitest";
import { validate, priority } from "../src/domain";
const record = {
  name: "EN-1",
  customer: "Client",
  policy_reference: "P-1",
  kind: "coverage",
  requested_date: "2026-09-01",
  effective_date: "2026-09-20",
  additional_premium: 0,
  refund: 0,
  stage: "requested",
};
it("requires an issuance reference and accepts explicitly recorded retroactive changes", () => {
  expect(validate(record)).toBeNull();
  expect(validate({ ...record, effective_date: "2026-08-20" })).toBeNull();
  expect(validate({ ...record, stage: "issued" })).toBeTruthy();
  expect(
    validate({ ...record, stage: "issued", outcome: "Endorsement A-1" }),
  ).toBeNull();
  expect(validate({ ...record, refund: -1 })).toBeTruthy();
  expect(priority({ ...record, stage: "rejected" }, "2026-10-01")).toBe(
    "closed",
  );
});
