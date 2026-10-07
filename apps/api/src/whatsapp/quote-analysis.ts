import {
  publicQuoteProposalSchema,
  publicQuoteReportSchema,
  quoteAnalysisSchema,
  type PublicQuoteProposal,
  type PublicQuoteReport,
  type QuoteAnalysis,
} from "@savia/studio-shared/public-quote";

const ANALYSIS_TIMEOUT_MS = 8_000;
const BATCH_WINDOW_MS = 250;

async function withinDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs = ANALYSIS_TIMEOUT_MS,
): Promise<T | undefined> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(undefined);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve()
        .then(() => operation(controller.signal))
        .catch(() => undefined),
      timeout,
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

/** Bounded, tool-free model analysis. The caller supplies only approved evidence. */
export async function analyzeQuoteReport(
  report: PublicQuoteReport,
  complete: (report: PublicQuoteReport, signal: AbortSignal) => Promise<string>,
): Promise<QuoteAnalysis | undefined> {
  const evidence = publicQuoteReportSchema.parse(report);
  if (!evidence.proposals.some((proposal) => proposal.state === "priced"))
    return;
  const text = await withinDeadline((signal) => complete(evidence, signal));
  if (!text) return;
  try {
    const parsed = quoteAnalysisSchema.parse(
      JSON.parse(
        text
          .trim()
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/, ""),
      ),
    );
    const priced = evidence.proposals.filter(
      (proposal) => proposal.state === "priced",
    );
    const expected = new Set(priced.map((proposal) => proposal.id));
    if (
      parsed.proposals.length !== expected.size ||
      new Set(parsed.proposals.map((proposal) => proposal.id)).size !==
        expected.size ||
      parsed.proposals.some((proposal) => !expected.has(proposal.id))
    )
      return;
    if (parsed.preferredProposalId && !expected.has(parsed.preferredProposalId))
      return;
    const strings = [
      parsed.suggestion,
      ...parsed.limitations,
      ...parsed.proposals.map((proposal) => proposal.explanation),
    ];
    if (
      strings.some((value) =>
        /https?:\/\/|\b[^\s@]+@[^\s@]+\.[^\s@]+/i.test(value),
      )
    )
      return;
    const coverageMissing = priced.some((proposal) => !proposal.facts?.length);
    if (coverageMissing)
      parsed.limitations = [
        ...new Set([
          ...parsed.limitations,
          "Faltan coberturas o deducibles verificados para comparar la protección integral.",
        ]),
      ].slice(0, 8);
    if (coverageMissing) delete parsed.preferredProposalId;
    const allPricesEqual =
      new Set(priced.map((proposal) => proposal.premium)).size === 1;
    if (coverageMissing && allPricesEqual) {
      delete parsed.preferredProposalId;
      parsed.suggestion =
        "Las ofertas recibidas tienen el mismo precio. Con los datos disponibles no hay una ganadora integral verificada; confirma coberturas y deducibles antes de elegir.";
    }
    if (evidence.proposals.some((proposal) => proposal.state !== "priced"))
      parsed.limitations = [
        ...new Set([
          ...parsed.limitations,
          "La comparación es parcial: hay opciones sin precio verificado.",
        ]),
      ].slice(0, 8);
    return publicQuoteReportSchema.parse({ ...evidence, analysis: parsed })
      .analysis;
  } catch {
    return;
  }
}

type PublishedQuoteLink = { id: string; url: string; expiresAt: string };
type WorkflowDependencies = {
  analyze(
    report: PublicQuoteReport,
    signal: AbortSignal,
  ): Promise<QuoteAnalysis | undefined>;
  emit(eventKey: string, text: string): Promise<void>;
  publish(report: PublicQuoteReport): Promise<PublishedQuoteLink>;
};

/** Model batches run alongside provider calls; the provider callback never waits. */
export function createQuoteExplanationWorkflow(
  identity: Pick<PublicQuoteReport, "reference" | "createdAt">,
  dependencies: WorkflowDependencies,
) {
  const proposals = new Map<string, PublicQuoteProposal>();
  const pending = new Set<string>();
  const explanations = new Map<string, string>();
  const emitted = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();
  let closing = false;
  const snapshot = (): PublicQuoteReport =>
    publicQuoteReportSchema.parse({
      version: 1,
      ...identity,
      proposals: [...proposals.values()],
    });
  const explain = async (analysis: QuoteAnalysis) => {
    for (const explanation of analysis.proposals) {
      explanations.set(explanation.id, explanation.explanation);
      if (emitted.has(explanation.id)) continue;
      const proposal = proposals.get(explanation.id);
      if (!proposal || proposal.state !== "priced") continue;
      try {
        await dependencies.emit(
          `explanation:${explanation.id}`,
          `${proposal.product}\n${explanation.explanation}`,
        );
        emitted.add(explanation.id);
      } catch {
        /* The final report retains the explanation even if delivery fails. */
      }
    }
  };
  const flush = () => {
    timer = undefined;
    running = running
      .then(async () => {
        if (closing || !pending.size) return;
        const ids = new Set(pending);
        pending.clear();
        const report = snapshot();
        report.proposals = report.proposals.filter(
          (proposal) => proposal.state !== "priced" || ids.has(proposal.id),
        );
        const analysis = await withinDeadline((signal) =>
          dependencies.analyze(report, signal),
        );
        if (analysis) {
          const validated = publicQuoteReportSchema.safeParse({
            ...report,
            analysis,
          });
          if (validated.success && validated.data.analysis)
            await explain(validated.data.analysis);
        }
      })
      .catch(() => {});
  };
  const record = (value: PublicQuoteProposal) => {
    if (closing) return;
    const proposal = publicQuoteProposalSchema.parse(value);
    proposals.set(proposal.id, proposal);
    if (proposal.state === "priced" && !explanations.has(proposal.id))
      pending.add(proposal.id);
    if (!timer && pending.size) timer = setTimeout(flush, BATCH_WINDOW_MS);
  };
  return {
    record,
    async finish(
      result: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      if (timer) clearTimeout(timer);
      timer = undefined;
      closing = true;
      if (Array.isArray(result.proposals)) {
        for (const value of result.proposals) {
          const parsed = publicQuoteProposalSchema.safeParse(value);
          if (parsed.success) proposals.set(parsed.data.id, parsed.data);
        }
      }
      await running;
      const report = snapshot();
      const generated = await withinDeadline((signal) =>
        dependencies.analyze(report, signal),
      );
      const validated = publicQuoteReportSchema.safeParse({
        ...report,
        ...(generated ? { analysis: generated } : {}),
      });
      const analysis = validated.success ? validated.data.analysis : undefined;
      if (analysis) {
        report.analysis = analysis;
        await explain(analysis);
      } else if (explanations.size) {
        report.analysis = {
          proposals: [...explanations]
            .filter(([id]) => proposals.get(id)?.state === "priced")
            .map(([id, explanation]) => ({ id, explanation })),
          suggestion: "Compara las condiciones verificadas antes de elegir.",
          limitations: [
            "El análisis final automático no estuvo disponible; se conservan las explicaciones recibidas.",
          ],
        };
      }
      const updated: Record<string, unknown> = {
        ...result,
        proposals: report.proposals,
        ...(report.analysis
          ? {
              analysis: report.analysis,
              recommendation: report.analysis.suggestion,
            }
          : { analysisUnavailable: true }),
      };
      try {
        const link = await dependencies.publish(
          publicQuoteReportSchema.parse(report),
        );
        updated.publicUrl = link.url;
        updated.publicLinkId = link.id;
        updated.publicLinkExpiresAt = link.expiresAt;
      } catch {
        updated.persistenceWarnings = [
          ...(Array.isArray(result.persistenceWarnings)
            ? result.persistenceWarnings
            : []),
          "No se pudo crear el enlace público de esta cotización.",
        ];
      }
      return updated;
    },
  };
}
