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

export type QuoteAnalysisOutcome =
  | "completed"
  | "no_priced_proposals"
  | "timeout"
  | "truncated_output"
  | "model_error"
  | "missing_output"
  | "invalid_json"
  | "invalid_schema"
  | "proposal_ids_mismatch"
  | "preferred_id_mismatch"
  | "unsafe_output"
  | "invalid_evidence";

type BoundedResult<T> =
  | { status: "completed"; value: T }
  | { status: "timeout" }
  | { status: "failed" };

export type QuoteAnalysisCompletion = {
  text: string;
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
};

export type QuoteAnalysisCompletionMetadata = {
  finishReason?:
    "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other";
  inputTokens?: number;
  outputTokens?: number;
};

export type QuoteAnalysisValidationIssue = {
  field:
    | "root"
    | "proposals"
    | "proposals/[index]"
    | "proposals/[index]/id"
    | "proposals/[index]/explanation"
    | "suggestion"
    | "preferredProposalId"
    | "limitations"
    | "limitations/[index]";
  code:
    | "invalid_type"
    | "too_big"
    | "too_small"
    | "invalid_format"
    | "unrecognized_keys"
    | "invalid_value"
    | "invalid_union"
    | "custom";
};

function safeValidationIssues(
  issues: readonly { path: readonly PropertyKey[]; code: string }[],
): QuoteAnalysisValidationIssue[] {
  const fields = new Set<QuoteAnalysisValidationIssue["field"]>([
    "root",
    "proposals",
    "proposals/[index]",
    "proposals/[index]/id",
    "proposals/[index]/explanation",
    "suggestion",
    "preferredProposalId",
    "limitations",
    "limitations/[index]",
  ]);
  const codes = new Set<QuoteAnalysisValidationIssue["code"]>([
    "invalid_type",
    "too_big",
    "too_small",
    "invalid_format",
    "unrecognized_keys",
    "invalid_value",
    "invalid_union",
    "custom",
  ]);
  const safe: QuoteAnalysisValidationIssue[] = [];
  for (const issue of issues) {
    let field: QuoteAnalysisValidationIssue["field"] = "root";
    const path = issue.path;
    if (path.length === 1 && path[0] === "proposals") field = "proposals";
    else if (
      path.length === 2 &&
      path[0] === "proposals" &&
      typeof path[1] === "number"
    )
      field = "proposals/[index]";
    else if (
      path.length === 3 &&
      path[0] === "proposals" &&
      typeof path[1] === "number" &&
      (path[2] === "id" || path[2] === "explanation")
    )
      field = `proposals/[index]/${path[2]}`;
    else if (path.length === 1 && path[0] === "suggestion")
      field = "suggestion";
    else if (path.length === 1 && path[0] === "preferredProposalId")
      field = "preferredProposalId";
    else if (path.length === 1 && path[0] === "limitations")
      field = "limitations";
    else if (
      path.length === 2 &&
      path[0] === "limitations" &&
      typeof path[1] === "number"
    )
      field = "limitations/[index]";
    if (!fields.has(field)) continue;
    const code = codes.has(issue.code as QuoteAnalysisValidationIssue["code"])
      ? (issue.code as QuoteAnalysisValidationIssue["code"])
      : undefined;
    if (code) safe.push({ field, code });
    if (safe.length === 5) break;
  }
  return safe;
}

async function runBounded<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<BoundedResult<T>> {
  if (externalSignal?.aborted) return { status: "timeout" };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  const timeout = new Promise<BoundedResult<T>>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ status: "timeout" });
    }, timeoutMs);
  });
  const externallyAborted = externalSignal
    ? new Promise<BoundedResult<T>>((resolve) => {
        abortListener = () => {
          controller.abort(externalSignal.reason);
          resolve({ status: "timeout" });
        };
        externalSignal.addEventListener("abort", abortListener, {
          once: true,
        });
      })
    : undefined;
  const result = Promise.resolve()
    .then(() => operation(controller.signal))
    .then<BoundedResult<T>, BoundedResult<T>>(
      (value) => ({ status: "completed", value }),
      () => ({ status: "failed" }),
    );
  try {
    return await Promise.race(
      externallyAborted
        ? [result, timeout, externallyAborted]
        : [result, timeout],
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abortListener)
      externalSignal?.removeEventListener("abort", abortListener);
  }
}

/** Bounded, tool-free model analysis. The caller supplies only approved evidence. */
export async function analyzeQuoteReport(
  report: PublicQuoteReport,
  complete: (
    report: PublicQuoteReport,
    signal: AbortSignal,
  ) => Promise<string | QuoteAnalysisCompletion>,
  options: {
    signal?: AbortSignal;
    onOutcome?(outcome: QuoteAnalysisOutcome): void;
    onCompletion?(metadata: QuoteAnalysisCompletionMetadata): void;
    onValidationIssue?(issues: readonly QuoteAnalysisValidationIssue[]): void;
  } = {},
): Promise<QuoteAnalysis | undefined> {
  const outcome = (value: QuoteAnalysisOutcome) => {
    try {
      options.onOutcome?.(value);
    } catch {
      // Diagnostics must never affect quote results.
    }
  };
  const evidenceResult = publicQuoteReportSchema.safeParse(report);
  if (!evidenceResult.success) {
    outcome("invalid_evidence");
    return;
  }
  const evidence = evidenceResult.data;
  if (!evidence.proposals.some((proposal) => proposal.state === "priced")) {
    outcome("no_priced_proposals");
    return;
  }
  const completion = await runBounded(
    (signal) => complete(evidence, signal),
    ANALYSIS_TIMEOUT_MS,
    options.signal,
  );
  if (completion.status === "timeout") {
    outcome("timeout");
    return;
  }
  if (completion.status === "failed") {
    outcome("model_error");
    return;
  }
  const output =
    typeof completion.value === "string"
      ? { text: completion.value }
      : completion.value;
  const finishReasons = [
    "stop",
    "length",
    "content-filter",
    "tool-calls",
    "error",
    "other",
  ] as const;
  const metadata: QuoteAnalysisCompletionMetadata = {
    ...(output.finishReason &&
    finishReasons.includes(
      output.finishReason as (typeof finishReasons)[number],
    )
      ? { finishReason: output.finishReason as (typeof finishReasons)[number] }
      : {}),
    ...(Number.isSafeInteger(output.inputTokens) && output.inputTokens! >= 0
      ? { inputTokens: output.inputTokens }
      : {}),
    ...(Number.isSafeInteger(output.outputTokens) && output.outputTokens! >= 0
      ? { outputTokens: output.outputTokens }
      : {}),
  };
  try {
    options.onCompletion?.(metadata);
  } catch {
    // Diagnostics must never affect quote results.
  }
  if (metadata.finishReason === "length") {
    outcome("truncated_output");
    return;
  }
  const text = output.text;
  if (!text.trim()) {
    outcome("missing_output");
    return;
  }
  let json: unknown;
  try {
    json = JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, ""),
    );
  } catch {
    outcome("invalid_json");
    return;
  }
  if (
    json !== null &&
    typeof json === "object" &&
    !Array.isArray(json) &&
    (json as Record<string, unknown>).preferredProposalId === null
  ) {
    const { preferredProposalId: _ignored, ...withoutPreference } =
      json as Record<string, unknown>;
    json = withoutPreference;
  }
  const parsedResult = quoteAnalysisSchema.safeParse(json);
  if (!parsedResult.success) {
    const issues = safeValidationIssues(parsedResult.error.issues);
    if (issues.length) {
      try {
        options.onValidationIssue?.(issues);
      } catch {
        // Diagnostics must never affect quote results.
      }
    }
    outcome("invalid_schema");
    return;
  }
  try {
    const parsed = parsedResult.data;
    const priced = evidence.proposals.filter(
      (proposal) => proposal.state === "priced",
    );
    const expected = new Set(priced.map((proposal) => proposal.id));
    if (
      parsed.proposals.length !== expected.size ||
      new Set(parsed.proposals.map((proposal) => proposal.id)).size !==
        expected.size ||
      parsed.proposals.some((proposal) => !expected.has(proposal.id))
    ) {
      outcome("proposal_ids_mismatch");
      return;
    }
    if (
      parsed.preferredProposalId &&
      !expected.has(parsed.preferredProposalId)
    ) {
      outcome("preferred_id_mismatch");
      return;
    }
    const strings = [
      parsed.suggestion,
      ...parsed.limitations,
      ...parsed.proposals.map((proposal) => proposal.explanation),
    ];
    if (
      strings.some((value) =>
        /https?:\/\/|\b[^\s@]+@[^\s@]+\.[^\s@]+/i.test(value),
      )
    ) {
      outcome("unsafe_output");
      return;
    }
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
    const result = publicQuoteReportSchema.safeParse({
      ...evidence,
      analysis: parsed,
    });
    if (!result.success) {
      outcome("invalid_schema");
      return;
    }
    outcome("completed");
    return result.data.analysis;
  } catch {
    outcome("invalid_schema");
    return;
  }
}

type PublishedQuoteLink = { id: string; url: string; expiresAt: string };
type WorkflowDependencies = {
  analyze(
    report: PublicQuoteReport,
    signal: AbortSignal,
    phase: "batch" | "final",
  ): Promise<QuoteAnalysis | undefined>;
  emit(eventKey: string, text: string): Promise<void>;
  publish(report: PublicQuoteReport): Promise<PublishedQuoteLink>;
  onUnavailable?(
    phase: "batch" | "final",
    reason: "timeout" | "analysis_error",
  ): void;
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
        const bounded = await runBounded(
          (signal) => dependencies.analyze(report, signal, "batch"),
          ANALYSIS_TIMEOUT_MS,
        );
        const analysis =
          bounded.status === "completed" ? bounded.value : undefined;
        if (bounded.status !== "completed")
          dependencies.onUnavailable?.(
            "batch",
            bounded.status === "timeout" ? "timeout" : "analysis_error",
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
      const bounded = await runBounded(
        (signal) => dependencies.analyze(report, signal, "final"),
        ANALYSIS_TIMEOUT_MS,
      );
      const generated =
        bounded.status === "completed" ? bounded.value : undefined;
      if (bounded.status !== "completed")
        dependencies.onUnavailable?.(
          "final",
          bounded.status === "timeout" ? "timeout" : "analysis_error",
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
        updated.publicReference = report.reference;
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
