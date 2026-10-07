import { expect, it } from "vitest";
import { publicQuoteReportSchema } from "../src/public-quote";

const report = {
  version: 1,
  reference: "COT-example",
  createdAt: "2026-10-07T17:00:00.000Z",
  proposals: [
    {
      id: "plan-a",
      provider: "Provider",
      product: "Plan A",
      state: "priced",
      premium: 1000,
      currency: "COP",
    },
  ],
};

it("rejects private payloads and catalog coverage masquerading as verified facts", () => {
  expect(
    publicQuoteReportSchema.safeParse({
      ...report,
      applicant: { documentNumber: "123" },
    }).success,
  ).toBe(false);
  expect(
    publicQuoteReportSchema.safeParse({
      ...report,
      proposals: [
        {
          ...report.proposals[0],
          facts: [{ label: "Coverage", value: "Full", source: "catalog" }],
        },
      ],
    }).success,
  ).toBe(false);
  expect(publicQuoteReportSchema.safeParse(report).success).toBe(true);
});

it("requires a verified positive premium for a priced proposal", () => {
  expect(
    publicQuoteReportSchema.safeParse({
      ...report,
      proposals: [{ ...report.proposals[0], premium: undefined }],
    }).success,
  ).toBe(false);
  expect(
    publicQuoteReportSchema.safeParse({
      ...report,
      proposals: [{ ...report.proposals[0], premium: -1 }],
    }).success,
  ).toBe(false);
});

it("rejects duplicate proposal IDs and unrelated analysis recommendations", () => {
  expect(
    publicQuoteReportSchema.safeParse({
      ...report,
      proposals: [report.proposals[0], report.proposals[0]],
    }).success,
  ).toBe(false);
  expect(
    publicQuoteReportSchema.safeParse({
      ...report,
      analysis: {
        proposals: [{ id: "plan-a", explanation: "Price received." }],
        suggestion: "Choose this plan",
        preferredProposalId: "another-plan",
        limitations: [],
      },
    }).success,
  ).toBe(false);
});
