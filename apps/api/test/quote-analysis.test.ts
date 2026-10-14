import { expect, it, vi } from "vitest";
import {
  analyzeQuoteReport,
  createQuoteExplanationWorkflow,
  type QuoteAnalysisOutcome,
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

it("treats a null preferred proposal as no preference", async () => {
  const result = await analyzeQuoteReport(report, async () =>
    JSON.stringify({ ...analysis, preferredProposalId: null }),
  );

  expect(result?.proposals).toHaveLength(2);
  expect(result?.preferredProposalId).toBeUndefined();
});

it("reports bounded validation paths and codes without model-provided keys or values", async () => {
  const validationIssues: Array<{ field: string; code: string }> = [];
  const unsafeContact = "private@example.test";
  const invalid = {
    proposals: [
      { id: "a", explanation: 42 },
      { id: "b", explanation: "Valid", extra: unsafeContact },
    ],
    suggestion: 42,
    preferredProposalId: null,
    limitations: [42],
    extra: unsafeContact,
  };

  const result = await analyzeQuoteReport(
    report,
    async () => JSON.stringify(invalid),
    {
      onValidationIssue: (issues) => validationIssues.push(...issues),
    },
  );

  expect(result).toBeUndefined();
  expect(validationIssues.length).toBeGreaterThan(0);
  expect(validationIssues.length).toBeLessThanOrEqual(5);
  expect(validationIssues).toContainEqual({
    field: "proposals/[index]/explanation",
    code: "invalid_type",
  });
  expect(validationIssues).toContainEqual({
    field: "suggestion",
    code: "invalid_type",
  });
  expect(validationIssues).toContainEqual({
    field: "limitations/[index]",
    code: "invalid_type",
  });
  expect(validationIssues).not.toContainEqual(
    expect.objectContaining({ field: expect.stringContaining("extra") }),
  );
  expect(JSON.stringify(validationIssues)).not.toContain(unsafeContact);
  expect(
    validationIssues.every(({ code }) => /^[a-z_]{1,40}$/.test(code)),
  ).toBe(true);
});

it("reports safe reason codes for missing, malformed, schema-invalid, and mismatched analysis", async () => {
  const outcomes: QuoteAnalysisOutcome[] = [];
  const observe = {
    onOutcome: (outcome: QuoteAnalysisOutcome) => {
      outcomes.push(outcome);
    },
  };

  await analyzeQuoteReport(report, async () => "", observe);
  await analyzeQuoteReport(report, async () => "not-json", observe);
  await analyzeQuoteReport(
    report,
    async () => JSON.stringify({ ...analysis, unexpected: true }),
    observe,
  );
  await analyzeQuoteReport(
    report,
    async () =>
      JSON.stringify({ ...analysis, proposals: [analysis.proposals[0]] }),
    observe,
  );
  await analyzeQuoteReport(
    report,
    async () => {
      throw new Error("model provider details are private");
    },
    observe,
  );
  await analyzeQuoteReport(
    {
      ...report,
      proposals: report.proposals.map((proposal) => ({
        ...proposal,
        state: "failed" as const,
        premium: undefined,
      })),
    },
    async () => "should-not-run",
    observe,
  );

  expect(outcomes).toEqual([
    "missing_output",
    "invalid_json",
    "invalid_schema",
    "proposal_ids_mismatch",
    "model_error",
    "no_priced_proposals",
  ]);
});

it("classifies output-token truncation and reports only bounded token metadata", async () => {
  let outcome: QuoteAnalysisOutcome | undefined;
  let metadata: unknown;
  const result = await analyzeQuoteReport(
    report,
    async () => ({
      text: '{"proposals":[',
      finishReason: "length",
      inputTokens: 800,
      outputTokens: 980,
    }),
    {
      onOutcome: (value) => {
        outcome = value;
      },
      onCompletion: (value) => {
        metadata = value;
      },
    },
  );

  expect(result).toBeUndefined();
  expect(outcome).toBe("truncated_output");
  expect(metadata).toEqual({
    finishReason: "length",
    inputTokens: 800,
    outputTokens: 980,
  });
});

it("accepts a valid structured response after the former eight-second cutoff", async () => {
  vi.useFakeTimers();
  try {
    const onOutcome = vi.fn();
    const pending = analyzeQuoteReport(
      report,
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(JSON.stringify(analysis)), 15_600);
        }),
      { onOutcome },
    );
    await vi.advanceTimersByTimeAsync(15_601);
    expect(await pending).toMatchObject({ proposals: analysis.proposals });
    expect(onOutcome).toHaveBeenCalledWith("completed");
  } finally {
    vi.useRealTimers();
  }
});

it("bounds a stalled model and keeps the verified report usable", async () => {
  vi.useFakeTimers();
  try {
    let outcome: QuoteAnalysisOutcome | undefined;
    const pending = analyzeQuoteReport(report, () => new Promise(() => {}), {
      onOutcome: (value) => {
        outcome = value;
      },
    });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(outcome).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2);
    expect(await pending).toBeUndefined();
    expect(outcome).toBe("timeout");
  } finally {
    vi.useRealTimers();
  }
});

it("classifies an enclosing batch or final deadline as a timeout", async () => {
  vi.useFakeTimers();
  try {
    const controller = new AbortController();
    let outcome: QuoteAnalysisOutcome | undefined;
    const pending = analyzeQuoteReport(
      report,
      (_value, signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
      {
        signal: controller.signal,
        onOutcome: (value) => {
          outcome = value;
        },
      },
    );
    await vi.advanceTimersByTimeAsync(100);
    controller.abort(new Error("outer workflow deadline"));

    expect(await pending).toBeUndefined();
    expect(outcome).toBe("timeout");
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
    await vi.advanceTimersByTimeAsync(20_001);
    const result = await finish;
    expect(result.publicUrl).toBeDefined();
  } finally {
    vi.useRealTimers();
  }
});

it("labels batch and final model analyses separately for timeout diagnosis", async () => {
  vi.useFakeTimers();
  try {
    const phases: Array<"batch" | "final"> = [];
    const workflow = createQuoteExplanationWorkflow(
      { reference: report.reference, createdAt: report.createdAt },
      {
        analyze: async (_value, _signal, phase) => {
          phases.push(phase);
          return undefined;
        },
        emit: async () => {},
        publish: async () => ({
          id: "link",
          url: "https://savia.test/public/quotes/opaque",
          expiresAt: "2026-10-14T17:00:00.000Z",
        }),
      },
    );
    workflow.record(report.proposals[0]);
    await vi.advanceTimersByTimeAsync(251);
    await workflow.finish({ proposals: report.proposals });
    expect(phases).toEqual(["batch", "final"]);
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
