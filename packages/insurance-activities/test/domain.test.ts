import { expect, it } from "vitest";
import { validate, priority } from "../src/domain";
const record = {
  name: "Call customer",
  customer: "Client",
  owner: "Adviser",
  due_date: "2026-09-20",
  kind: "call",
  importance: "normal",
  stage: "scheduled",
};
it("requires a responsible person and completion/cancellation outcome", () => {
  expect(validate(record)).toBeNull();
  expect(validate({ ...record, owner: "" })).toBeTruthy();
  expect(validate({ ...record, stage: "completed" })).toBeTruthy();
  expect(
    validate({ ...record, stage: "completed", outcome: "Terms agreed" }),
  ).toBeNull();
  expect(priority({ ...record, stage: "cancelled" }, "2026-09-30")).toBe(
    "closed",
  );
  expect(priority(record, "2026-09-20")).toBe("today");
});
