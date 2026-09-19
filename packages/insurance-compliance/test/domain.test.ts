import { expect, it } from "vitest";
import { readiness, validate } from "../src/domain";
it("does not count expired or unevidenced approvals as ready", () => {
  expect(
    readiness(
      [
        { stage: "approved", evidence: "f1", valid_until: "2026-09-18" },
        { stage: "approved", evidence: "", valid_until: "2026-12-01" },
        { stage: "approved", evidence: "f2", valid_until: "2026-12-01" },
      ],
      "2026-09-19",
    ),
  ).toEqual({ ready: 1, total: 3, expired: 1 });
  expect(
    validate({
      name: "Check",
      customer: "Client",
      owner: "A",
      stage: "approved",
      due_date: "2026-10-01",
    }),
  ).toBeTruthy();
});
it("requires review evidence and valid dates for approval", () => {
  const base = {
    name: "Identity",
    customer: "Client",
    owner: "A",
    stage: "approved",
    due_date: "2026-10-01",
    evidence: "file-1",
    reviewed_date: "2026-09-19",
    valid_until: "2027-09-19",
  };
  expect(validate(base)).toBeNull();
  expect(validate({ ...base, reviewed_date: "" })).toBeTruthy();
  expect(validate({ ...base, valid_until: "2026-02-30" })).toBeTruthy();
  expect(validate({ ...base, valid_until: "2026-09-18" })).toBeTruthy();
});
it("generates stable checklist keys scoped by native customer and template revision", async () => {
  const { checklist } = await import("../src/domain");
  const template = {
    name: "Onboarding",
    requirements: ["Identity", "Consent"],
  };
  const a = checklist(
    template,
    1,
    { id: "c1", name: "Client" },
    "Owner",
    "2026-10-01",
  );
  expect(
    checklist(template, 1, { id: "c1", name: "Client" }, "Owner", "2026-10-01"),
  ).toEqual(a);
  expect(
    checklist(
      template,
      2,
      { id: "c1", name: "Client" },
      "Owner",
      "2026-10-01",
    )[0].dossier_key,
  ).not.toBe(a[0].dossier_key);
  expect(() =>
    checklist(
      { ...template, requirements: ["Identity", "Identity"] },
      1,
      { id: "c1", name: "Client" },
      "Owner",
      "2026-10-01",
    ),
  ).toThrow();
});
