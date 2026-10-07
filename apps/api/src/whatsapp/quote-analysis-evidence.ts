import type {
  PublicQuoteFact,
  PublicQuoteReport,
} from "@savia/studio-shared/public-quote";

export type QuoteAnalysisEvidence = {
  proposals: Array<{
    id: string;
    provider: string;
    product: string;
    state: "priced";
    premium: number;
    currency: "COP";
    factIndices: number[];
  }>;
  verifiedFacts: PublicQuoteFact[];
  unverifiedProposalCount: number;
};

/** Compact model evidence while preserving each priced offer's fact provenance. */
export function buildQuoteAnalysisEvidence(
  report: PublicQuoteReport,
): QuoteAnalysisEvidence {
  const verifiedFacts: PublicQuoteFact[] = [];
  const factIndexByKey = new Map<string, number>();
  const pricedProposals: QuoteAnalysisEvidence["proposals"] = [];

  for (const proposal of report.proposals) {
    if (proposal.state !== "priced" || proposal.premium === undefined) continue;

    const factIndices: number[] = [];
    for (const fact of proposal.facts ?? []) {
      const key = JSON.stringify([fact.label, fact.value, fact.source]);
      let index = factIndexByKey.get(key);
      if (index === undefined) {
        index = verifiedFacts.length;
        factIndexByKey.set(key, index);
        verifiedFacts.push({
          label: fact.label,
          value: fact.value,
          source: fact.source,
        });
      }
      if (!factIndices.includes(index)) factIndices.push(index);
    }

    pricedProposals.push({
      id: proposal.id,
      provider: proposal.provider,
      product: proposal.product,
      state: "priced",
      premium: proposal.premium,
      currency: proposal.currency,
      factIndices,
    });
  }

  return {
    proposals: pricedProposals,
    verifiedFacts,
    unverifiedProposalCount: report.proposals.length - pricedProposals.length,
  };
}
