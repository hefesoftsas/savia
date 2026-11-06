import { expect, it } from "vitest";
import type { PublicQuoteReport } from "@savia/studio-shared/public-quote";
import { buildQuoteAnalysisEvidence } from "../src/whatsapp/quote-analysis-evidence";

const sharedRce = {
  label: "Responsabilidad civil (RCE)",
  value: "$4.400.000.000 COP",
  source: "provider" as const,
};
const partialLoss = {
  label: "Deducible por pérdida parcial",
  value: "1 SMLV",
  source: "provider" as const,
};

function report(proposals: PublicQuoteReport["proposals"]): PublicQuoteReport {
  return {
    version: 1,
    reference: "private-reference",
    createdAt: "2026-10-07T12:00:00.000Z",
    proposals,
    analysis: {
      proposals: [],
      suggestion: "Private previous analysis",
      limitations: [],
    },
  };
}

it("deduplicates shared facts and keeps each proposal's distinct fact indices", () => {
  const evidence = buildQuoteAnalysisEvidence(
    report([
      {
        id: "offer-a",
        provider: "Carrier A",
        product: "Basic",
        state: "priced",
        premium: 1_000_000,
        currency: "COP",
        facts: [sharedRce, partialLoss],
      },
      {
        id: "offer-b",
        provider: "Carrier B",
        product: "Full",
        state: "priced",
        premium: 1_100_000,
        currency: "COP",
        facts: [sharedRce],
      },
    ]),
  );

  expect(evidence.verifiedFacts).toEqual([sharedRce, partialLoss]);
  expect(evidence.proposals.map((proposal) => proposal.factIndices)).toEqual([
    [0, 1],
    [0],
  ]);
  expect(JSON.stringify(evidence)).toBe(
    JSON.stringify({
      proposals: [
        {
          id: "offer-a",
          provider: "Carrier A",
          product: "Basic",
          state: "priced",
          premium: 1_000_000,
          currency: "COP",
          factIndices: [0, 1],
        },
        {
          id: "offer-b",
          provider: "Carrier B",
          product: "Full",
          state: "priced",
          premium: 1_100_000,
          currency: "COP",
          factIndices: [0],
        },
      ],
      verifiedFacts: [sharedRce, partialLoss],
      unverifiedProposalCount: 0,
    }),
  );
  expect(JSON.stringify(evidence)).not.toContain("private-reference");
  expect(JSON.stringify(evidence)).not.toContain("Private previous analysis");
});

it("excludes non-priced proposals and reports how many were excluded", () => {
  const evidence = buildQuoteAnalysisEvidence(
    report([
      {
        id: "priced",
        provider: "Carrier",
        product: "Plan",
        state: "priced",
        premium: 1_000_000,
        currency: "COP",
        facts: [sharedRce],
      },
      {
        id: "unpriced",
        provider: "Carrier",
        product: "Unpriced",
        state: "unpriced",
        currency: "COP",
        facts: [partialLoss],
      },
      {
        id: "failed",
        provider: "Carrier",
        product: "Failed",
        state: "failed",
        currency: "COP",
      },
      {
        id: "uncertain",
        provider: "Carrier",
        product: "Uncertain",
        state: "uncertain",
        currency: "COP",
      },
    ]),
  );

  expect(evidence.proposals.map(({ id }) => id)).toEqual(["priced"]);
  expect(evidence.verifiedFacts).toEqual([sharedRce]);
  expect(evidence.unverifiedProposalCount).toBe(3);
});

it("leaves proposals without facts unlinked instead of inheriting another offer's facts", () => {
  const evidence = buildQuoteAnalysisEvidence(
    report([
      {
        id: "with-facts",
        provider: "Carrier A",
        product: "Known",
        state: "priced",
        premium: 1_000_000,
        currency: "COP",
        facts: [sharedRce],
      },
      {
        id: "without-facts",
        provider: "Carrier B",
        product: "Unknown",
        state: "priced",
        premium: 1_100_000,
        currency: "COP",
      },
    ]),
  );

  expect(evidence.proposals.map((proposal) => proposal.factIndices)).toEqual([
    [0],
    [],
  ]);
  expect(evidence.verifiedFacts).toEqual([sharedRce]);
});

it("keeps facts distinct when their verified value or source differs", () => {
  const sameLabel = {
    label: "Responsabilidad civil",
    source: "provider" as const,
  };
  const evidence = buildQuoteAnalysisEvidence(
    report([
      {
        id: "offer-a",
        provider: "Carrier A",
        product: "Plan A",
        state: "priced",
        premium: 1_000_000,
        currency: "COP",
        facts: [
          { ...sameLabel, value: "$1.000.000 COP" },
          { ...sameLabel, value: "$2.000.000 COP" },
          {
            ...sameLabel,
            value: "$2.000.000 COP",
            source: "saved_verified",
          },
        ],
      },
    ]),
  );

  expect(evidence.verifiedFacts).toEqual([
    { ...sameLabel, value: "$1.000.000 COP" },
    { ...sameLabel, value: "$2.000.000 COP" },
    {
      ...sameLabel,
      value: "$2.000.000 COP",
      source: "saved_verified",
    },
  ]);
  expect(evidence.proposals[0].factIndices).toEqual([0, 1, 2]);
});

it("compacts repeated facts across four proposals with canonical indexes", () => {
  const facts = Array.from({ length: 24 }, (_, index) => ({
    label: `Coverage ${index + 1}`,
    value: `Verified limit and deductible ${index + 1} `.repeat(3),
    source: "provider" as const,
  }));
  const input = report(
    Array.from({ length: 4 }, (_, index) => ({
      id: `offer-${index + 1}`,
      provider: `Carrier ${index + 1}`,
      product: `Plan ${index + 1}`,
      state: "priced" as const,
      premium: 1_000_000 + index * 100_000,
      currency: "COP" as const,
      facts,
    })),
  );
  const inputSize = JSON.stringify(input).length;
  const evidence = buildQuoteAnalysisEvidence(input);
  const outputSize = JSON.stringify(evidence).length;

  expect(evidence.verifiedFacts).toEqual(facts);
  expect(evidence.proposals.map((proposal) => proposal.factIndices)).toEqual(
    Array.from({ length: 4 }, () =>
      Array.from({ length: 24 }, (_, index) => index),
    ),
  );
  expect(outputSize).toBeLessThan(inputSize / 2);
});
