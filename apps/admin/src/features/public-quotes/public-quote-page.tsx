import { useEffect, useState } from "react";
import { publicQuoteReportSchema } from "@savia/studio-shared/public-quote";
import type { PublicQuoteReport } from "@savia/studio-shared/public-quote";
import { z } from "zod";

const publicQuoteResponseSchema = z
  .object({
    report: publicQuoteReportSchema,
    expiresAt: z.string().datetime(),
  })
  .strict();

const copy = {
  es: {
    title: "Resultado de cotización",
    reference: "Referencia",
    created: "Preparada",
    expires: "Este enlace vence",
    suggestion: "Orientación para comparar",
    preferred: "Opción destacada",
    limits: "Qué falta por confirmar",
    offers: "Propuestas recibidas",
    noAnalysis:
      "El análisis automático no estuvo disponible. Compara los datos verificados y confirma las condiciones antes de elegir.",
    priced: "Precio confirmado",
    unpriced: "Sin precio",
    failed: "No disponible",
    uncertain: "Resultado sin confirmar",
    noPrice: "No hay un precio verificado para esta propuesta.",
    providerFact: "Dato informado por la aseguradora",
    savedFact: "Dato guardado y verificado",
    retry: "Intentarlo de nuevo",
    unavailable: "Este resultado no está disponible",
    loadError:
      "No se pudo cargar el resultado. Revisa tu conexión e inténtalo de nuevo.",
    invalid: "El enlace no es válido.",
    loading: "Cargando resultado…",
    footer: "Resultado compartido de forma segura por Savia.",
  },
  en: {
    title: "Quote result",
    reference: "Reference",
    created: "Prepared",
    expires: "This link expires",
    suggestion: "Guidance for comparing",
    preferred: "Highlighted option",
    limits: "What still needs confirmation",
    offers: "Proposals received",
    noAnalysis:
      "Automatic analysis was unavailable. Compare the verified facts and confirm the terms before choosing.",
    priced: "Price confirmed",
    unpriced: "Unpriced",
    failed: "Unavailable",
    uncertain: "Result unconfirmed",
    noPrice: "There is no verified price for this proposal.",
    providerFact: "Information provided by the insurer",
    savedFact: "Saved and verified information",
    retry: "Try again",
    unavailable: "This result is unavailable",
    loadError:
      "We couldn't load this result. Check your connection and try again.",
    invalid: "This link is invalid.",
    loading: "Loading result…",
    footer: "Quote result shared securely by Savia.",
  },
  pt: {
    title: "Resultado da cotação",
    reference: "Referência",
    created: "Preparada",
    expires: "Este link expira",
    suggestion: "Orientação para comparar",
    preferred: "Opção em destaque",
    limits: "O que ainda precisa ser confirmado",
    offers: "Propostas recebidas",
    noAnalysis:
      "A análise automática não estava disponível. Compare os dados verificados e confirme as condições antes de escolher.",
    priced: "Preço confirmado",
    unpriced: "Sem preço",
    failed: "Indisponível",
    uncertain: "Resultado não confirmado",
    noPrice: "Não há preço verificado para esta proposta.",
    providerFact: "Informação fornecida pela seguradora",
    savedFact: "Informação salva e verificada",
    retry: "Tentar novamente",
    unavailable: "Este resultado não está disponível",
    loadError:
      "Não foi possível carregar o resultado. Verifique sua conexão e tente novamente.",
    invalid: "Este link é inválido.",
    loading: "Carregando resultado…",
    footer: "Resultado compartilhado com segurança pela Savia.",
  },
} as const;

type Locale = keyof typeof copy;
function localeFromDocument(): Locale {
  const lang = document.documentElement.lang.toLowerCase();
  return lang.startsWith("en") ? "en" : lang.startsWith("pt") ? "pt" : "es";
}

function formatDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(
    locale === "pt" ? "pt-BR" : locale === "es" ? "es-CO" : "en",
    {
      dateStyle: "medium",
      timeStyle: "short",
    },
  ).format(new Date(value));
}

function formatPremium(value: number, locale: Locale) {
  return new Intl.NumberFormat(
    locale === "pt" ? "pt-BR" : locale === "es" ? "es-CO" : "en",
    {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 0,
    },
  ).format(value);
}

function proposalState(
  state: PublicQuoteReport["proposals"][number]["state"],
  locale: Locale,
) {
  const text = copy[locale];
  return state === "priced"
    ? text.priced
    : state === "unpriced"
      ? text.unpriced
      : state === "failed"
        ? text.failed
        : text.uncertain;
}

/** Anonymous, read-only display of the exact verified report in a revocable public link. */
export function PublicQuotePage({ token }: { token: string }) {
  const locale = localeFromDocument();
  const text = copy[locale];
  const [result, setResult] =
    useState<z.infer<typeof publicQuoteResponseSchema>>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const validToken = /^[a-f0-9]{64}$/i.test(token);
  const endpoint = `${(import.meta.env.VITE_SAVIA_API_URL ?? window.location.origin).replace(/\/$/, "")}/api/public/quotes/${encodeURIComponent(token)}`;

  useEffect(() => {
    const controller = new AbortController();
    setResult(undefined);
    setError("");
    setLoading(true);
    if (!validToken) {
      setError(text.invalid);
      setLoading(false);
      return () => controller.abort();
    }
    void fetch(endpoint, {
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(text.unavailable);
        const parsed = publicQuoteResponseSchema.safeParse(
          await response.json(),
        );
        if (!parsed.success) throw new Error(text.unavailable);
        if (new Date(parsed.data.expiresAt).getTime() <= Date.now())
          throw new Error(text.unavailable);
        if (!controller.signal.aborted) setResult(parsed.data);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(
          cause instanceof Error &&
            (cause.message === text.invalid ||
              cause.message === text.unavailable)
            ? cause.message
            : text.loadError,
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [
    attempt,
    endpoint,
    text.invalid,
    text.loadError,
    text.unavailable,
    validToken,
  ]);

  return (
    <main
      lang={locale === "pt" ? "pt-BR" : locale}
      className="min-h-[calc(100vh-4rem)] bg-background px-4 py-8 text-foreground sm:px-8 sm:py-12"
    >
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-10 border-b pb-6 sm:mb-12 sm:pb-8">
          <p className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground">
            Savia · {text.title}
          </p>
          {result ? (
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
              <div>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                  {text.offers}
                </h1>
                <p className="mt-3 text-sm text-muted-foreground">
                  {text.reference}:{" "}
                  <span className="font-medium text-foreground">
                    {result.report.reference}
                  </span>
                </p>
              </div>
              <div className="text-sm leading-6 text-muted-foreground sm:text-right">
                <p>
                  {text.created}: {formatDate(result.report.createdAt, locale)}
                </p>
                <p>
                  {text.expires}: {formatDate(result.expiresAt, locale)}
                </p>
              </div>
            </div>
          ) : (
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {text.title}
            </h1>
          )}
        </header>

        {loading ? (
          <p role="status" className="py-10 text-muted-foreground">
            {text.loading}
          </p>
        ) : error ? (
          <section role="alert" className="max-w-xl py-4">
            <h2 className="text-xl font-semibold">{text.unavailable}</h2>
            <p className="mt-2 text-muted-foreground">{error}</p>
            {validToken && (
              <button
                type="button"
                className="mt-5 rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setAttempt((current) => current + 1)}
              >
                {text.retry}
              </button>
            )}
          </section>
        ) : result ? (
          <>
            {!result.report.analysis && (
              <p className="mb-8 text-muted-foreground">{text.noAnalysis}</p>
            )}
            {result.report.analysis && (
              <section
                aria-labelledby="quote-guidance"
                className="mb-10 grid gap-5 border-b pb-8 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,0.75fr)] sm:gap-10"
              >
                <div>
                  <h2 id="quote-guidance" className="text-lg font-semibold">
                    {text.suggestion}
                  </h2>
                  <p className="mt-3 max-w-3xl leading-7 text-foreground/85">
                    {result.report.analysis.suggestion}
                  </p>
                </div>
                {result.report.analysis.preferredProposalId &&
                  result.report.proposals.some(
                    (proposal) =>
                      proposal.id ===
                      result.report.analysis?.preferredProposalId,
                  ) && (
                    <div className="sm:border-l sm:pl-6">
                      <p className="text-sm font-semibold text-muted-foreground">
                        {text.preferred}
                      </p>
                      <p className="mt-2 text-lg font-medium">
                        {
                          result.report.proposals.find(
                            (proposal) =>
                              proposal.id ===
                              result.report.analysis?.preferredProposalId,
                          )?.provider
                        }
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {
                          result.report.proposals.find(
                            (proposal) =>
                              proposal.id ===
                              result.report.analysis?.preferredProposalId,
                          )?.product
                        }
                      </p>
                    </div>
                  )}
              </section>
            )}

            <section aria-label={text.offers} className="divide-y">
              {result.report.proposals.map((proposal) => {
                const explanation = result.report.analysis?.proposals.find(
                  (item) => item.id === proposal.id,
                )?.explanation;
                const preferred =
                  result.report.analysis?.preferredProposalId === proposal.id;
                return (
                  <article
                    key={proposal.id}
                    className="grid gap-4 py-7 sm:grid-cols-[minmax(0,1fr)_13rem] sm:gap-8 sm:py-8"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <h2 className="text-xl font-semibold">
                          {proposal.product}
                        </h2>
                        <span className="rounded-full border px-2.5 py-1 text-xs font-medium">
                          {proposalState(proposal.state, locale)}
                        </span>
                        {preferred && (
                          <span className="text-sm font-medium text-primary">
                            {text.preferred}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {proposal.provider}
                      </p>
                      {explanation && (
                        <p className="mt-4 max-w-3xl leading-7 text-foreground/85">
                          {explanation}
                        </p>
                      )}
                      {proposal.facts && proposal.facts.length > 0 && (
                        <dl className="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                          {proposal.facts.map((fact, index) => (
                            <div key={`${fact.label}-${index}`}>
                              <dt className="text-sm font-medium">
                                {fact.label}
                              </dt>
                              <dd className="mt-1 text-sm text-muted-foreground">
                                {fact.value}
                                <span className="sr-only">
                                  {" "}
                                  —{" "}
                                  {fact.source === "provider"
                                    ? text.providerFact
                                    : text.savedFact}
                                </span>
                              </dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </div>
                    <div className="sm:text-right">
                      {proposal.state === "priced" &&
                      proposal.premium !== undefined ? (
                        <p className="text-2xl font-semibold tabular-nums">
                          {formatPremium(proposal.premium, locale)}
                        </p>
                      ) : (
                        <p className="max-w-xs text-sm leading-6 text-muted-foreground sm:ml-auto">
                          {text.noPrice}
                        </p>
                      )}
                    </div>
                  </article>
                );
              })}
            </section>

            {!!result.report.analysis?.limitations.length && (
              <section
                aria-labelledby="quote-limitations"
                className="mt-8 border-t pt-6"
              >
                <h2 id="quote-limitations" className="text-base font-semibold">
                  {text.limits}
                </h2>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
                  {result.report.analysis.limitations.map(
                    (limitation, index) => (
                      <li key={`${limitation}-${index}`}>{limitation}</li>
                    ),
                  )}
                </ul>
              </section>
            )}
            <footer className="mt-10 border-t pt-5 text-sm text-muted-foreground">
              {text.footer}
            </footer>
          </>
        ) : null}
      </div>
    </main>
  );
}
