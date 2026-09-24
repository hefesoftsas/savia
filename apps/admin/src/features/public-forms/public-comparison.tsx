import { useAppLocale, useMessages } from "@/i18n/core";
import { publicFormsMessages } from "@/i18n/locales/public-forms";
import { PluginLocaleProvider } from "@savia/studio-shared/plugin-locale-react";
import {
  QuoteResults,
  type QuoteBatchItem,
} from "@savia/release-catalog/public-ui";
import { quoteProjection } from "./public-form-submission";

export type PublicComparisonItem = {
  flowId: string;
  insurer: string;
  product: string;
  premiumTotal: number | null;
  status: "succeeded" | "pending" | "failed";
};

/**
 * The embedded quote comparator reused verbatim in the anonymous context:
 * same cards, provider filter, progress track, compare-select (max 4) and
 * coverage comparison table. Only safe projection data ever reaches it — no quote
 * numbers, runs, history, vehicle info, retry handlers or PDF download —
 * so private sections stay hidden by construction, not by convention.
 */
export function PublicComparison({ items }: { items: PublicComparisonItem[] }) {
  const t = useMessages(publicFormsMessages);
  const locale = useAppLocale();
  const batchItems: QuoteBatchItem[] = items.map((item, index) => ({
    productId: item.flowId || `${item.insurer}-${item.product}-${index}`,
    flowId: item.flowId,
    label: item.product,
    provider: item.insurer,
    status: item.status,
    ...(item.premiumTotal !== null ? { premium: item.premiumTotal } : {}),
    ...(item.status === "failed"
      ? { error: t("Sin respuesta"), errorCode: "service_unavailable" }
      : {}),
  }));
  return (
    <PluginLocaleProvider locale={locale}>
      <div className="public-quote-embedded">
        <QuoteResults
          runs={[]}
          loading={false}
          batchItems={batchItems}
          hasSelectedQuote={batchItems.length > 0}
          planCatalog
          hidePdfDownload
        />
      </div>
    </PluginLocaleProvider>
  );
}

/** Final receipt: projection quotes plus the unavailable note. */
export function PublicReceiptResult({ result }: { result: unknown }) {
  const t = useMessages(publicFormsMessages);
  const projection = quoteProjection.safeParse(result);
  if (!projection.success) return null;
  const { quotes, unavailable } = projection.data;
  return (
    <>
      <PublicComparison
        items={quotes.map((quote) => ({
          flowId: quote.flowId ?? quote.product,
          insurer: quote.insurer,
          product: quote.product,
          premiumTotal: quote.premiumTotal,
          status: "succeeded" as const,
        }))}
      />
      {unavailable > 0 && (
        <p className="public-form-help">
          {t(
            unavailable === 1
              ? "%{count} resultado no está disponible."
              : "%{count} resultados no están disponibles.",
            { count: unavailable },
          )}
        </p>
      )}
    </>
  );
}

/** Defensive parse of the anonymous status endpoint: unknown shapes stay out. */
export function parseStatusItems(value: unknown): PublicComparisonItem[] {
  if (!Array.isArray(value)) return [];
  const items: PublicComparisonItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.flowId !== "string" || !record.flowId) continue;
    if (typeof record.label !== "string" || typeof record.insurer !== "string")
      continue;
    const status =
      record.status === "done" ||
      record.status === "unavailable" ||
      record.status === "quoting"
        ? record.status
        : "waiting";
    const result =
      record.result &&
      typeof record.result === "object" &&
      !Array.isArray(record.result)
        ? (record.result as Record<string, unknown>)
        : undefined;
    const premium =
      result &&
      typeof result.premiumTotal === "number" &&
      result.premiumTotal > 0
        ? result.premiumTotal
        : null;
    items.push({
      flowId: record.flowId,
      insurer: record.insurer,
      product: record.label,
      premiumTotal: status === "done" ? premium : null,
      status:
        status === "done"
          ? "succeeded"
          : status === "unavailable"
            ? "failed"
            : "pending",
    });
  }
  return items;
}
