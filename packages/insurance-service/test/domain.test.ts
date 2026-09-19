import { expect, it } from "vitest";
import { validate, priority } from "../src/domain";
const base = {
  name: "SR-1",
  customer: "Client",
  owner: "Adviser",
  kind: "query",
  channel: "email",
  received_date: "2026-09-01",
  due_date: "2026-09-10",
  stage: "received",
};
it("requires a dated resolution and excludes closed requests from urgency", () => {
  expect(validate(base)).toBeNull();
  expect(
    validate({ ...base, stage: "resolved", outcome: "Answered" }),
  ).toBeTruthy();
  const done = {
    ...base,
    stage: "resolved",
    outcome: "Answered",
    resolved_date: "2026-09-05",
  };
  expect(validate(done)).toBeNull();
  expect(priority(done, "2026-10-01")).toBe("closed");
  expect(priority({ ...base, stage: "waiting" }, "2026-09-11")).toBe("overdue");
});
it.each([
  { due_date: "2026-08-31" },
  { resolved_date: "2026-08-31" },
  { kind: "invalid" },
  { channel: "invalid" },
  { owner: "" },
  { received_date: "2026-02-30" },
])("rejects invalid service data %j", (patch) =>
  expect(validate({ ...base, ...patch })).toBeTruthy(),
);
it("requires a reason to cancel", () => {
  expect(validate({ ...base, stage: "cancelled" })).toBeTruthy();
  expect(
    validate({ ...base, stage: "cancelled", outcome: "Duplicate request" }),
  ).toBeNull();
});
it("validates response and escalation commitments", async () => {
  const { escalate } = await import("../src/domain");
  expect(
    validate({
      ...base,
      escalation_date: "2026-08-31",
      escalation_owner: "Supervisor",
    }),
  ).toBeTruthy();
  expect(validate({ ...base, escalation_date: "2026-09-09" })).toBeTruthy();
  expect(validate({ ...base, response_date: "2026-08-31" })).toBeTruthy();
  expect(
    escalate(
      {
        ...base,
        escalation_date: "2026-09-09",
        escalation_owner: "Supervisor",
      },
      "2026-09-10",
    ),
  ).toEqual({
    owner: "Supervisor",
    stage: "in_progress",
    escalated_date: "2026-09-10",
  });
  expect(() =>
    escalate({ ...base, stage: "resolved" }, "2026-09-10"),
  ).toThrow();
});
