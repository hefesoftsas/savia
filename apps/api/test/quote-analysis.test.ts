import { expect, it, vi } from "vitest";
import {
  analyzeQuoteReport,
  createQuoteExplanationWorkflow,
} from "../src/whatsapp/quote-analysis";
import type {
  PublicQuoteReport,
  QuoteAnalysis,
} from "@savia/studio-shared/public-quote";

const report: PublicQuoteReport = {
  version: 1,
  reference: "COT-test",
  createdAt: "2026-10-07T17:00:00.000Z",
  proposals: [
    {
      id: "a",
      provider: "Provider",
      product: "Basic",
      state: "priced",
      premium: 1000,
      currency: "COP",
    },
    {
      id: "b",
      provider: "Provider",
      product: "Full",
      state: "priced",
      premium: 1000,
      currency: "COP",
    },
    {
      id: "c",
      provider: "Other",
      product: "Other",
      state: "uncertain",
      currency: "COP",
    },
  ],
};
const analysis = {
  proposals: [
    { id: "a", explanation: "Prima recibida de $1.000." },
    { id: "b", explanation: "Prima recibida de $1.000; faltan deducibles." },
  ],
  suggestion: "Full is the winner",
  preferredProposalId: "b",
  limitations: [],
};

it("does not choose a coverage winner for equal prices without verified coverage", async () => {
  const value = await analyzeQuoteReport(report, async () =>
    JSON.stringify(analysis),
  );
  expect(value?.preferredProposalId).toBeUndefined();
  expect(value?.suggestion).not.toContain("winner");
  expect(value?.limitations.length).toBeGreaterThan(0);
  expect(value?.proposals).toHaveLength(2);
});

it("rejects analysis omitting received offers or referring to unverified offers", async () => {
  expect(
    await analyzeQuoteReport(report, async () =>
      JSON.stringify({ ...analysis, proposals: [analysis.proposals[0]] }),
    ),
  ).toBeUndefined();
  expect(
    await analyzeQuoteReport(report, async () =>
      JSON.stringify({ ...analysis, preferredProposalId: "c" }),
    ),
  ).toBeUndefined();
});

it("bounds a stalled model and keeps the verified report usable", async () => {
  vi.useFakeTimers();
  try {
    const pending = analyzeQuoteReport(report, () => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(8001);
    expect(await pending).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});

it("batches received proposal explanations and publishes the same stored final analysis", async () => {
  const messages: Array<{ key: string; text: string }> = [];
  let published: PublicQuoteReport | undefined;
  const workflow = createQuoteExplanationWorkflow(
    { reference: report.reference, createdAt: report.createdAt },
    {
      analyze: async (value) => ({
        proposals: value.proposals
          .filter((p) => p.state === "priced")
          .map((p) => ({
            id: p.id,
            explanation: `Explicación verificada de ${p.product}`,
          })),
        suggestion: "Compare the verified facts.",
        limitations: [],
      }),
      emit: async (key, text) => {
        messages.push({ key, text });
      },
      publish: async (value) => {
        published = value;
        return {
          id: "link",
          url: "https://savia.test/public/quotes/opaque",
          expiresAt: "2026-10-14T17:00:00.000Z",
        };
      },
    },
  );
  for (const proposal of report.proposals) workflow.record(proposal);
  workflow.record(report.proposals[0]);
  const result = await workflow.finish({
    quoteId: "private-id",
    reference: report.reference,
    proposals: report.proposals,
  });
  expect(published?.proposals).toHaveLength(3);
  expect(published?.analysis?.proposals).toHaveLength(2);
  expect(messages.filter((m) => m.key === "explanation:a")).toHaveLength(1);
  expect(messages.find((m) => m.key === "explanation:a")?.text).toContain(
    "Explicación verificada",
  );
  expect(result.publicUrl).toBe("https://savia.test/public/quotes/opaque");
  expect(result.analysis).toEqual(published?.analysis);
  expect(JSON.stringify(published)).not.toContain("private-id");
});

it("preserves quote results when publication or model generation fails", async () => {
  const workflow = createQuoteExplanationWorkflow(
    { reference: report.reference, createdAt: report.createdAt },
    {
      analyze: async () => undefined,
      emit: async () => {},
      publish: async () => {
        throw new Error("DB unavailable");
      },
    },
  );
  const result = await workflow.finish({
    quoteId: "saved-id",
    proposals: report.proposals,
    lowestPremium: 1000,
  });
  expect(result.lowestPremium).toBe(1000);
  expect(result.publicUrl).toBeUndefined();
  expect(result.persistenceWarnings).toContain(
    "No se pudo crear el enlace público de esta cotización.",
  );
});

it("runs explanations while provider results continue without blocking their callback", async () => {
  vi.useFakeTimers();
  try {
    let complete: (value: QuoteAnalysis) => void = () => {};
    const emit = vi.fn(async () => {});
    const analyze = vi.fn(
      () =>
        new Promise<QuoteAnalysis>((resolve) => {
          complete = resolve;
        }),
    );
    const workflow = createQuoteExplanationWorkflow(
      { reference: report.reference, createdAt: report.createdAt },
      {
        analyze,
        emit,
        publish: async () => ({
          id: "link",
          url: "https://savia.test/public/quotes/opaque",
          expiresAt: "2026-10-14T17:00:00.000Z",
        }),
      },
    );
    expect(workflow.record(report.proposals[0])).toBeUndefined();
    await vi.advanceTimersByTimeAsync(251);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(workflow.record(report.proposals[1])).toBeUndefined();
    complete({
      ...analysis,
      proposals: [analysis.proposals[0]],
      preferredProposalId: undefined,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(emit).toHaveBeenCalledWith(
      "explanation:a",
      expect.stringContaining("Prima recibida"),
    );
    const finish = workflow.finish({ proposals: report.proposals });
    await vi.advanceTimersByTimeAsync(8001);
    const result = await finish;
    expect(result.publicUrl).toBeDefined();
  } finally {
    vi.useRealTimers();
  }
});

it("does not highlight an overall winner when unequal prices lack coverage evidence", async () => {
  const value = await analyzeQuoteReport(
    {
      ...report,
      proposals: report.proposals.map((proposal) =>
        proposal.id === "b" ? { ...proposal, premium: 2000 } : proposal,
      ),
    },
    async () => JSON.stringify(analysis),
  );
  expect(value?.preferredProposalId).toBeUndefined();
  expect(value?.limitations).toContain(
    "Faltan coberturas o deducibles verificados para comparar la protección integral.",
  );
});

it("publishes partial explanations with a safe fallback when the final model fails", async () => {
  vi.useFakeTimers();
  try {
    let published: PublicQuoteReport | undefined;
    let calls = 0;
    const workflow = createQuoteExplanationWorkflow(
      { reference: report.reference, createdAt: report.createdAt },
      {
        analyze: async () =>
          ++calls === 1
            ? {
                proposals: [analysis.proposals[0]],
                suggestion: "Partial guidance",
                limitations: [],
              }
            : undefined,
        emit: async () => {},
        publish: async (value) => {
          published = value;
          return {
            id: "link",
            url: "https://savia.test/public/quotes/opaque",
            expiresAt: "2026-10-14T17:00:00.000Z",
          };
        },
      },
    );
    workflow.record(report.proposals[0]);
    await vi.advanceTimersByTimeAsync(251);
    const result = await workflow.finish({
      proposals: report.proposals,
      recommendation:
        "Private contact private@example.test at https://private.test",
    });
    expect(result.publicUrl).toBeDefined();
    expect(published?.analysis?.proposals).toHaveLength(1);
    expect(JSON.stringify(published)).not.toContain("private@example.test");
    expect(published?.analysis?.limitations).toContain(
      "El análisis final automático no estuvo disponible; se conservan las explicaciones recibidas.",
    );
  } finally {
    vi.useRealTimers();
  }
});
