import { expect, it } from "vitest";
import { validate, priority } from "../src/domain";
const base = {
  name: "Signed application",
  customer: "Client",
  policy_reference: "ISS-1",
  owner: "Adviser",
  requested_date: "2026-09-01",
  due_date: "2026-09-10",
  kind: "application",
  stage: "requested",
};
it("requires receipt evidence and documented review before approval", () => {
  expect(validate(base)).toBeNull();
  expect(validate({ ...base, stage: "received" })).toBeTruthy();
  const received = {
    ...base,
    stage: "received",
    received_date: "2026-09-02",
    evidence_reference: "FILE-1",
  };
  expect(validate(received)).toBeNull();
  expect(validate({ ...received, stage: "approved" })).toBeTruthy();
  const reviewed = {
    ...received,
    stage: "approved",
    reviewed_date: "2026-09-03",
    outcome: "Complete and legible",
  };
  expect(validate(reviewed)).toBeNull();
  expect(priority(reviewed, "2026-09-30")).toBe("closed");
  expect(priority({ ...reviewed, stage: "changes" }, "2026-09-30")).toBe(
    "overdue",
  );
});
it.each([
  { due_date: "2026-08-31" },
  { received_date: "2026-08-31" },
  { received_date: "2026-09-05", reviewed_date: "2026-09-04" },
  { reviewed_date: "2026-09-04" },
  { requested_date: "2026-02-30" },
])("rejects inconsistent document dates %j", (patch) =>
  expect(validate({ ...base, ...patch })).toBeTruthy(),
);
it("waives a requirement only with a reason, without inventing a receipt", () => {
  expect(validate({ ...base, stage: "waived" })).toBeTruthy();
  expect(
    validate({
      ...base,
      stage: "waived",
      outcome: "Not applicable to this product",
    }),
  ).toBeNull();
});
it("reopens expired approvals without discarding their evidence", async () => {
  const { reopenExpired } = await import("../src/domain");
  const record = {
    ...base,
    stage: "approved",
    valid_until: "2026-09-20",
    evidence_reference: "FILE-1",
    reviewed_date: "2026-09-03",
  };
  expect(priority(record, "2026-09-21")).toBe("overdue");
  expect(priority(record, "2026-09-20")).toBe("closed");
  expect(reopenExpired(record, "2026-09-21")).toEqual({
    stage: "changes",
    due_date: "2026-09-21",
  });
  expect(() => reopenExpired(record, "2026-09-19")).toThrow();
  expect(() => reopenExpired(record, "2026-02-30")).toThrow();
  expect(validate({ ...base, valid_until: "2026-02-30" })).toBeTruthy();
});
