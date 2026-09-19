import { expect, it } from "vitest";
import { validate, priority } from "../src/domain";
const base = {
  name: "ISS-1",
  customer: "Client",
  owner: "Adviser",
  requested_date: "2026-09-01",
  due_date: "2026-09-10",
  effective_date: "2026-09-05",
  end_date: "2027-09-05",
  premium: 100,
  stage: "requested",
};
it("requires policy and issuance evidence before issuance, then delivery evidence", () => {
  expect(validate(base)).toBeNull();
  expect(validate({ ...base, stage: "issued" })).toBeTruthy();
  const issued = {
    ...base,
    stage: "issued",
    policy_reference: "POL-1",
    issued_date: "2026-09-04",
  };
  expect(validate(issued)).toBeNull();
  expect(priority(issued, "2026-09-11")).toBe("overdue");
  expect(validate({ ...issued, stage: "delivered" })).toBeTruthy();
  expect(
    validate({ ...issued, stage: "delivered", delivered_date: "2026-09-06" }),
  ).toBeNull();
  expect(priority({ ...issued, stage: "delivered" }, "2026-09-11")).toBe(
    "closed",
  );
});
it.each([
  { end_date: "2026-09-05" },
  { due_date: "2026-08-31" },
  { issued_date: "2026-08-31" },
  { issued_date: "2026-09-04", delivered_date: "2026-09-03" },
  { delivered_date: "2026-09-05" },
  { premium: -1 },
  { effective_date: "2026-02-30" },
])("rejects invalid issuance data %j", (patch) =>
  expect(validate({ ...base, ...patch })).toBeTruthy(),
);
it("requires a cancellation reason", () => {
  expect(validate({ ...base, stage: "cancelled" })).toBeTruthy();
  expect(
    validate({ ...base, stage: "cancelled", outcome: "Customer withdrew" }),
  ).toBeNull();
});
