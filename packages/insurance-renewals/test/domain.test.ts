import { describe, expect, it } from "vitest";
import { priority, validateRenewal, summarize } from "../src/domain";
const item = {
  id: "r",
  name: "RN-01",
  customer: "Example",
  policy_reference: "POL-01",
  expiry_date: "2026-09-25",
  premium: 100,
  stage: "pending",
};
describe("renewals", () => {
  it("prioritizes upcoming dates and keeps closed cases out of urgency", () => {
    expect(priority(item, "2026-09-19")).toBe("week");
    expect(priority({ ...item, expiry_date: "2026-09-18" }, "2026-09-19")).toBe(
      "overdue",
    );
    expect(priority({ ...item, stage: "renewed" }, "2026-09-19")).toBe(
      "closed",
    );
    expect(priority({ ...item, stage: "lost" }, "2026-09-19")).toBe("closed");
    expect(priority({ ...item, expiry_date: "2026-02-30" }, "2026-09-19")).toBe(
      "undated",
    );
  });
  it("requires a policy reference for renewed cases and a reason for losses", () => {
    expect(validateRenewal({ ...item, stage: "renewed" })).toBeTruthy();
    expect(validateRenewal({ ...item, stage: "lost" })).toBeTruthy();
    expect(
      validateRenewal({ ...item, stage: "renewed", outcome: "POL-02" }),
    ).toBeNull();
    expect(
      validateRenewal({ ...item, stage: "lost", outcome: "Customer declined" }),
    ).toBeNull();
  });
  it("summarizes open premium and separates closed outcomes", () => {
    expect(
      summarize(
        [item, { ...item, stage: "renewed" }, { ...item, stage: "lost" }],
        "2026-09-19",
      ),
    ).toMatchObject({ open: 1, urgent: 1, renewed: 1, lost: 1, premium: 100 });
  });
});
it("plans distinct terms with a validated advance contact date", async () => {
  const { planRenewal } = await import("../src/domain");
  const policy = {
    id: "p1",
    name: "P-1",
    fin: "2027-03-01",
    prima: 100,
    estado: "Vigente",
    cliente: "c1",
  };
  expect(planRenewal(policy, "Client", 30)).toMatchObject({
    term_key: "p1:2027-03-01",
    next_follow_up: "2027-01-30",
  });
  expect(
    planRenewal({ ...policy, fin: "2028-03-01" }, "Client", 30).term_key,
  ).not.toBe(planRenewal(policy, "Client", 30).term_key);
  expect(() =>
    planRenewal({ ...policy, fin: "2027-02-30" }, "Client", 30),
  ).toThrow();
  expect(() => planRenewal(policy, "Client", -1)).toThrow();
});
