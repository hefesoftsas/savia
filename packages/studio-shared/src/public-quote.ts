import { z } from "zod";

/** Only verified facts are published. Catalog examples are not quote evidence. */
export const publicQuoteFactSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    value: z.string().trim().min(1).max(250),
    source: z.enum(["provider", "saved_verified"]),
  })
  .strict();
export const publicQuoteProposalSchema = z
  .object({
    id: z.string().min(1).max(120),
    provider: z.string().trim().min(1).max(100),
    product: z.string().trim().min(1).max(150),
    state: z.enum(["priced", "unpriced", "failed", "uncertain"]),
    premium: z.number().positive().finite().optional(),
    currency: z.literal("COP"),
    facts: z.array(publicQuoteFactSchema).max(20).optional(),
  })
  .strict()
  .superRefine((proposal, context) => {
    if (proposal.state === "priced" && proposal.premium === undefined)
      context.addIssue({
        code: "custom",
        path: ["premium"],
        message: "A priced proposal requires a verified premium",
      });
    if (proposal.state !== "priced" && proposal.premium !== undefined)
      context.addIssue({
        code: "custom",
        path: ["premium"],
        message: "An unverified proposal cannot publish a premium",
      });
  });
export const quoteAnalysisSchema = z
  .object({
    proposals: z
      .array(
        z
          .object({
            id: z.string().min(1).max(120),
            explanation: z.string().trim().min(1).max(900),
          })
          .strict(),
      )
      .max(30),
    suggestion: z.string().trim().min(1).max(1400),
    preferredProposalId: z.string().min(1).max(120).optional(),
    limitations: z.array(z.string().trim().min(1).max(300)).max(8),
  })
  .strict();
export const publicQuoteReportSchema = z
  .object({
    version: z.literal(1),
    reference: z.string().min(1).max(120),
    createdAt: z.string().datetime(),
    proposals: z.array(publicQuoteProposalSchema).max(30),
    analysis: quoteAnalysisSchema.optional(),
  })
  .strict()
  .superRefine((report, context) => {
    const ids = new Set(report.proposals.map((proposal) => proposal.id));
    if (ids.size !== report.proposals.length)
      context.addIssue({
        code: "custom",
        path: ["proposals"],
        message: "Proposal IDs must be unique",
      });
    if (!report.analysis) return;
    const priced = new Set(
      report.proposals
        .filter((proposal) => proposal.state === "priced")
        .map((proposal) => proposal.id),
    );
    const explained = report.analysis.proposals.map((proposal) => proposal.id);
    if (
      new Set(explained).size !== explained.length ||
      explained.some((id) => !priced.has(id))
    )
      context.addIssue({
        code: "custom",
        path: ["analysis", "proposals"],
        message: "Analysis must refer to verified proposals",
      });
    if (
      report.analysis.preferredProposalId &&
      !priced.has(report.analysis.preferredProposalId)
    )
      context.addIssue({
        code: "custom",
        path: ["analysis", "preferredProposalId"],
        message: "Recommendation must refer to a verified proposal",
      });
  });
export type PublicQuoteFact = z.infer<typeof publicQuoteFactSchema>;
export type PublicQuoteProposal = z.infer<typeof publicQuoteProposalSchema>;
export type QuoteAnalysis = z.infer<typeof quoteAnalysisSchema>;
export type PublicQuoteReport = z.infer<typeof publicQuoteReportSchema>;
