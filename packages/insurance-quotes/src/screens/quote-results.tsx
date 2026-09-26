import { InsuranceNotice } from "../notice";
import { usePluginLocale } from "@savia/studio-shared/plugin-locale-react";
import {
  pluginIntlLocale,
  type PluginLocale,
  type PluginMessageParams,
} from "@savia/studio-shared/plugin-localization";
import { insuranceMessage } from "../messages";
import { useInsuranceMessages } from "../localization";
import { useEffect, useMemo, useState } from "react";
import type { PluginExtensionActionRun } from "@savia/studio-shared/plugin-api";
import { ProviderLogo } from "./provider-logo";
import {
  formatCop as formatLocalizedCop,
  toUnifiedComparisonQuote,
  type UnifiedComparisonQuote,
} from "./unified-quote-model";

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function money(value: unknown, locale: PluginLocale): string | null {
  if (!Number.isFinite(Number(value))) return null;
  return new Intl.NumberFormat(pluginIntlLocale(locale), {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(Number(value));
}

function resultTitle(
  data: RecordValue | null,
  output: RecordValue | null,
  locale: PluginLocale,
): string {
  const t = (message: string, params?: PluginMessageParams) =>
    insuranceMessage(message, locale, params);
  if (output?.type === "vehicle_lookup") return t("Consultar placa");
  const product = text(data?.product);
  if (product) return product;
  const operation = [text(data?.operationId), text(data?.quoteNumber)].find(
    (candidate) => candidate !== null,
  );
  if (operation?.includes("sbs-product-8")) return "SBS · Autos Producto 8";
  if (operation?.includes("sbs-product-10")) return "SBS · Autos Gold";
  if (operation?.includes("sbs-product-11")) return "SBS · Autos Plata";
  const provider = text(output?.provider);
  return provider
    ? t("%{p0} · Cotización", { p0: provider.toUpperCase() })
    : t("Cotización disponible");
}

export type QuoteBatchItem = {
  productId: string;
  flowId: string;
  label: string;
  provider: string;
  status: "pending" | "succeeded" | "failed";
  error?: string;
  errorCode?: string | null;
  runId?: string;
  detailId?: string;
  detailVersion?: number;
  quoteNumber?: string;
  premium?: number;
  /** Tiempo de ejecución del producto en ms (visibilidad de performance). */
  durationMs?: number;
  /** Snapshot normalizado persistido para renderizar el historial sin runs. */
  snapshot?: import("../quote-snapshot").QuoteResultSnapshot;
};

export type VehicleInfo = {
  plate?: string;
  declaredValue?: number;
  productionYear?: number;
  fasecoldaCode?: string;
};

export type HistoricalQuoteSummary = {
  id: string;
  name: string;
  version?: number;
  placa?: string;
  ramo?: string;
  valor_asegurado?: number;
  prima?: number;
  estado?: string;
  created_at?: string;
};

function HistoryDeleteButton({
  deleting,
  onDelete,
  reference,
}: {
  deleting: boolean;
  onDelete: () => void;
  reference?: string;
}) {
  const t = useInsuranceMessages();
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!deleting) setConfirming(false);
  }, [deleting]);
  if (!confirming) {
    return (
      <button
        className="insurance-comparator__btn insurance-history-delete-trigger"
        type="button"
        aria-label={t("Eliminar cotización guardada")}
        disabled={deleting}
        onClick={() => setConfirming(true)}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          aria-hidden="true"
        >
          <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" />
        </svg>
        {t("Eliminar")}
      </button>
    );
  }
  return (
    <div
      className="insurance-history-delete-confirm"
      role="group"
      aria-label={t("Confirmar eliminación")}
    >
      <div className="insurance-history-delete-confirm__copy">
        <strong>{t("¿Eliminar esta cotización y sus detalles?")}</strong>
        {reference ? <p>{reference}</p> : null}
      </div>
      <div className="insurance-history-delete-confirm__actions">
        <button
          className="insurance-comparator__btn insurance-comparator__btn--ghost"
          type="button"
          disabled={deleting}
          onClick={() => setConfirming(false)}
        >
          {t("Cancelar")}
        </button>
        <button
          className="insurance-comparator__btn insurance-history-delete-confirm__danger"
          type="button"
          aria-label={t("Confirmar eliminación")}
          disabled={deleting}
          onClick={onDelete}
        >
          {deleting ? t("Eliminando…") : t("Eliminar")}
        </button>
      </div>
    </div>
  );
}

export function QuoteResults({
  runs,
  loading,
  productErrors = [],
  batchItems = [],
  onRetrySingle,
  onRetryAll,
  retryingIds = [],
  quoteReference,
  masterQuoteId,
  vehicleInfo,
  historyQuotes = [],
  selectedHistoryQuoteId,
  onSelectHistoryQuote,
  hasSelectedQuote,
  onGoToForm,
  onResumeHistoryQuote,
  showHistorySelector = false,
  planCatalog = false,
  hidePdfDownload = false,
  hideProgress = false,
  historyLoading = false,
  historyError = null,
  onDeleteHistoryQuote,
  deletingHistory = false,
}: {
  runs: readonly PluginExtensionActionRun[];
  loading: boolean;
  productErrors?: readonly string[];
  batchItems?: readonly QuoteBatchItem[];
  onRetrySingle?: (productId: string) => Promise<void> | void;
  onRetryAll?: () => Promise<void> | void;
  retryingIds?: readonly string[];
  quoteReference?: string;
  masterQuoteId?: string;
  vehicleInfo?: VehicleInfo;
  historyQuotes?: readonly HistoricalQuoteSummary[];
  selectedHistoryQuoteId?: string | null;
  onSelectHistoryQuote?: (quoteId: string | null) => void;
  hasSelectedQuote?: boolean;
  onGoToForm?: () => void;
  onResumeHistoryQuote?: () => void;
  showHistorySelector?: boolean;
  /**
   * Enrich non-simulated quotes with static plan-catalog data (badges,
   * highlights, coverages, score) while keeping the live premium. Used by
   * anonymous surfaces that never receive run receipts; embedded callers
   * keep the default honest sparse view.
   */
  planCatalog?: boolean;
  /** Hide the pdf-lib download action (anonymous pages use print instead). */
  hidePdfDownload?: boolean;
  hideProgress?: boolean;
  /** Loading state while the selected quote's details load. */
  historyLoading?: boolean;
  /** Error state if the history read fails (never render empty as success). */
  historyError?: string | null;
  /** Delete action for the selected saved quote (with confirmation in UI). */
  onDeleteHistoryQuote?: (quoteId: string) => Promise<void> | void;
  deletingHistory?: boolean;
  /** Legacy diagnostics input; intentionally not rendered in customer results. */
  timings?: {
    setupMs?: number;
    crmMs?: number;
    products?: Record<string, number>;
  } | null;
}) {
  const t = useInsuranceMessages();
  const locale = usePluginLocale();
  const formatCop = (amount: number) => formatLocalizedCop(amount, locale);

  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [selectedQuoteIds, setSelectedQuoteIds] = useState<string[] | null>(
    null,
  );
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyHighlight, setHistoryHighlight] = useState(0);

  const filteredHistoryQuotes = useMemo(() => {
    const query = historyQuery
      .trim()
      .toLocaleLowerCase(pluginIntlLocale(locale));
    if (!query) return historyQuotes;
    return historyQuotes.filter((quote) =>
      [quote.name, quote.placa, quote.estado, quote.ramo]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase(pluginIntlLocale(locale))
        .includes(query),
    );
  }, [historyQuotes, historyQuery, locale]);

  const selectedHistoryQuote = useMemo(
    () =>
      historyQuotes.find((quote) => quote.id === selectedHistoryQuoteId) ??
      null,
    [historyQuotes, selectedHistoryQuoteId],
  );

  const historyListId = "insurance-quote-history-listbox";
  const visibleHistoryQuotes = filteredHistoryQuotes.slice(0, 30);
  const hiddenHistoryCount =
    filteredHistoryQuotes.length - visibleHistoryQuotes.length;

  const chooseHistoryQuote = (quoteId: string | null) => {
    onSelectHistoryQuote?.(quoteId);
    setHistoryQuery("");
    setHistoryHighlight(0);
    setHistoryOpen(false);
  };

  useEffect(() => {
    setHistoryQuery("");
    setHistoryOpen(false);
    setHistoryHighlight(0);
  }, [showHistorySelector]);

  useEffect(() => {
    setHistoryHighlight(0);
  }, [historyQuery]);

  // Derive batch items from runs only if batchItems is empty AND runs is a small test set (e.g. <= 5)
  const effectiveBatchItems: readonly QuoteBatchItem[] = useMemo(() => {
    if (batchItems.length > 0) return batchItems;
    if (!selectedHistoryQuoteId && runs.length > 0 && runs.length <= 5) {
      return runs
        .filter((r) => r.actionId === "quote")
        .map((r) => {
          const output = record(r.output);
          const data = record(output?.data);
          const isFailed =
            r.status !== "succeeded" ||
            output?.status === "error" ||
            output?.status === "failed" ||
            typeof data?.errorCode === "string";
          const errorCode =
            text(data?.errorCode) ?? text(output?.errorCode) ?? r.errorCode;
          const errorMsg = isFailed
            ? errorCode
              ? t("No se completó: %{p0}.", { p0: errorCode })
              : t("La ejecución no se completó.")
            : undefined;
          const label = resultTitle(data, output, locale);
          return {
            productId: r.runId,
            flowId: String(data?.operationId ?? r.runId),
            label,
            provider: String(output?.provider ?? "Seguros"),
            status: isFailed ? ("failed" as const) : ("succeeded" as const),
            error: errorMsg,
            errorCode,
            runId: r.runId,
            quoteNumber: text(data?.quoteNumber) ?? undefined,
            premium:
              typeof data?.premiumTotal === "number"
                ? data.premiumTotal
                : undefined,
          };
        });
    }
    return [];
  }, [batchItems, runs, selectedHistoryQuoteId]);

  const isQuoteActive =
    hasSelectedQuote ??
    Boolean(
      selectedHistoryQuoteId ||
      masterQuoteId ||
      quoteReference ||
      (effectiveBatchItems.length > 0 &&
        effectiveBatchItems.some(
          (b) => b.quoteNumber || (b.premium != null && b.premium > 0),
        )),
    );

  const failedCount = effectiveBatchItems.filter(
    (item) => item.status === "failed",
  ).length;
  const succeededCount = effectiveBatchItems.filter(
    (item) => item.status === "succeeded",
  ).length;
  const pendingCount = effectiveBatchItems.filter(
    (item) => item.status === "pending" || retryingIds.includes(item.productId),
  ).length;
  const totalCount = effectiveBatchItems.length;
  const completedCount = succeededCount + failedCount;
  const progressPercent =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  // Build unified comparison quotes from effectiveBatchItems ONLY if a quote is active
  const unifiedQuotes: UnifiedComparisonQuote[] = useMemo(() => {
    if (!isQuoteActive) return [];
    const succeeded = effectiveBatchItems.filter(
      (b) => b.status === "succeeded",
    );
    if (succeeded.length > 0) {
      return succeeded.map((item) => {
        const matchingRun = runs.find((r) => r.runId === item.runId);
        return toUnifiedComparisonQuote(item, matchingRun, locale, planCatalog);
      });
    }
    return [];
  }, [isQuoteActive, effectiveBatchItems, runs, locale, planCatalog]);

  const uniqueProviders = useMemo(() => {
    const list: string[] = [];
    unifiedQuotes.forEach((q) => {
      if (q.provider && !list.includes(q.provider)) {
        list.push(q.provider);
      }
    });
    return list;
  }, [unifiedQuotes]);

  const rankedQuotes = useMemo(
    () =>
      [...unifiedQuotes].sort(
        (a, b) => b.score - a.score || a.premium - b.premium,
      ),
    [unifiedQuotes],
  );

  useEffect(() => {
    setSelectedQuoteIds(null);
    setSelectedProvider(null);
    setActionNotice("");
  }, [masterQuoteId, selectedHistoryQuoteId]);

  const filteredQuotes = useMemo(() => {
    let result = [...rankedQuotes];
    if (selectedProvider) {
      result = result.filter((q) => q.provider === selectedProvider);
    }
    return result;
  }, [rankedQuotes, selectedProvider]);

  const defaultComparedQuoteIds = useMemo(
    () => rankedQuotes.slice(0, 4).map((quote) => quote.id),
    [rankedQuotes],
  );

  const comparedQuoteIds = selectedQuoteIds ?? defaultComparedQuoteIds;

  const comparedQuotesList = useMemo(() => {
    const byId = new Map(rankedQuotes.map((quote) => [quote.id, quote]));
    return comparedQuoteIds.flatMap((id) => {
      const quote = byId.get(id);
      return quote ? [quote] : [];
    });
  }, [comparedQuoteIds, rankedQuotes]);

  const toggleSelectedQuote = (id: string) => {
    setSelectedQuoteIds((current) => {
      const currentIds = current ?? defaultComparedQuoteIds;
      if (currentIds.includes(id)) {
        return currentIds.filter((item) => item !== id);
      }
      if (currentIds.length >= 4) {
        setActionNotice(t("Puedes comparar hasta cuatro ofertas a la vez."));
        return currentIds;
      }
      return [...currentIds, id];
    });
  };

  return (
    <section
      aria-label={t("Comparador de cotizaciones")}
      className="insurance-results"
    >
      {loading ? <p role="status">{t("Actualizando resultados…")}</p> : null}
      {/* 0. SELECTOR DE COTIZACIÓN ANTERIOR */}
      {showHistorySelector && historyQuotes.length > 0 ? (
        <div
          className="insurance-history-selector-bar"
          role="region"
          aria-label={t("Historial de cotizaciones")}
        >
          <div className="insurance-history-selector-inner">
            <div
              className="insurance-history-combobox"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setHistoryOpen(false);
                }
              }}
            >
              <div className="insurance-history-combobox-field">
                <svg
                  aria-hidden="true"
                  className="insurance-history-search-icon"
                  fill="none"
                  height="15"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  width="15"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" x2="16.65" y1="21" y2="16.65" />
                </svg>
                <input
                  aria-activedescendant={
                    historyOpen && visibleHistoryQuotes[historyHighlight]
                      ? `history-option-${visibleHistoryQuotes[historyHighlight].id}`
                      : undefined
                  }
                  aria-autocomplete="list"
                  aria-controls={historyListId}
                  aria-expanded={historyOpen}
                  aria-label={t("Seleccionar cotización anterior")}
                  autoComplete="off"
                  className="insurance-history-combobox-input"
                  id="insurance-quote-history-select"
                  onChange={(event) => {
                    setHistoryQuery(event.target.value);
                    setHistoryOpen(true);
                  }}
                  onFocus={() => setHistoryOpen(true)}
                  onClick={() => setHistoryOpen(true)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setHistoryOpen(true);
                      setHistoryHighlight((current) =>
                        Math.min(
                          current + 1,
                          Math.max(0, visibleHistoryQuotes.length - 1),
                        ),
                      );
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setHistoryHighlight((current) =>
                        Math.max(0, current - 1),
                      );
                    } else if (event.key === "Enter") {
                      const target = visibleHistoryQuotes[historyHighlight];
                      if (historyOpen && target) {
                        event.preventDefault();
                        chooseHistoryQuote(target.id);
                      }
                    } else if (event.key === "Escape") {
                      setHistoryOpen(false);
                    }
                  }}
                  placeholder={
                    selectedHistoryQuote
                      ? `${selectedHistoryQuote.name}${selectedHistoryQuote.placa ? ` · ${selectedHistoryQuote.placa}` : ""}`
                      : t("Buscar por placa, referencia o estado…")
                  }
                  role="combobox"
                  type="text"
                  value={
                    historyOpen
                      ? historyQuery
                      : selectedHistoryQuote
                        ? `${selectedHistoryQuote.name}${selectedHistoryQuote.placa ? ` · ${selectedHistoryQuote.placa}` : ""}`
                        : historyQuery
                  }
                />
                {selectedHistoryQuote || historyQuery ? (
                  <button
                    aria-label={
                      selectedHistoryQuote
                        ? t("Quitar cotización seleccionada")
                        : t("Limpiar búsqueda")
                    }
                    className="insurance-history-search-clear"
                    onClick={() => chooseHistoryQuote(null)}
                    onMouseDown={(event) => event.preventDefault()}
                    type="button"
                  >
                    <svg
                      aria-hidden="true"
                      fill="none"
                      height="13"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.2"
                      viewBox="0 0 24 24"
                      width="13"
                    >
                      <line x1="18" x2="6" y1="6" y2="18" />
                      <line x1="6" x2="18" y1="6" y2="18" />
                    </svg>
                  </button>
                ) : (
                  <button
                    aria-label={
                      historyOpen
                        ? t("Cerrar opciones")
                        : t("Abrir opciones de cotización")
                    }
                    className="insurance-history-combobox-toggle"
                    onClick={() => setHistoryOpen((current) => !current)}
                    onMouseDown={(event) => event.preventDefault()}
                    type="button"
                  >
                    <svg
                      aria-hidden="true"
                      className={
                        historyOpen
                          ? "insurance-history-combobox-chevron is-open"
                          : "insurance-history-combobox-chevron"
                      }
                      fill="none"
                      height="16"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                      width="16"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                )}
              </div>
              {historyOpen ? (
                <ul
                  className="insurance-history-combobox-list"
                  id={historyListId}
                  role="listbox"
                  aria-label={t("Cotizaciones disponibles")}
                >
                  {visibleHistoryQuotes.map((quote, index) => {
                    const isSelected = quote.id === selectedHistoryQuoteId;
                    return (
                      <li
                        aria-selected={isSelected}
                        className={`insurance-history-combobox-option${isSelected ? " is-selected" : ""}${index === historyHighlight ? " is-highlighted" : ""}`.trim()}
                        id={`history-option-${quote.id}`}
                        key={quote.id}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => chooseHistoryQuote(quote.id)}
                        onMouseEnter={() => setHistoryHighlight(index)}
                        role="option"
                      >
                        <span className="insurance-history-combobox-option-main">
                          <strong>{quote.name}</strong>
                          {quote.placa ? (
                            <span className="insurance-history-combobox-plate">
                              {quote.placa}
                            </span>
                          ) : null}
                        </span>
                        <span className="insurance-history-combobox-option-meta">
                          {quote.valor_asegurado
                            ? formatCop(quote.valor_asegurado)
                            : null}
                          {quote.valor_asegurado && quote.estado ? " · " : null}
                          {quote.estado ? quote.estado : null}
                        </span>
                      </li>
                    );
                  })}
                  {visibleHistoryQuotes.length === 0 ? (
                    <li
                      className="insurance-history-combobox-empty"
                      role="presentation"
                    >
                      {t("Sin resultados para “")}
                      {historyQuery.trim()}”.{" "}
                      <button
                        type="button"
                        className="insurance-history-no-results-clear"
                        onClick={() => {
                          setHistoryQuery("");
                          setHistoryHighlight(0);
                        }}
                        onMouseDown={(event) => event.preventDefault()}
                      >
                        {t("Ver todas")}{" "}
                      </button>
                    </li>
                  ) : null}
                  {hiddenHistoryCount > 0 ? (
                    <li
                      className="insurance-history-combobox-more"
                      role="presentation"
                    >
                      {t("…y")} {hiddenHistoryCount}{" "}
                      {t("más · refina la búsqueda")}{" "}
                    </li>
                  ) : null}
                </ul>
              ) : null}
              <p className="insurance-history-combobox-count" role="status">
                {historyQuery
                  ? t("%{p0} de %{p1}", {
                      p0: filteredHistoryQuotes.length,
                      p1: historyQuotes.length,
                    })
                  : selectedHistoryQuote
                    ? t("1 seleccionada")
                    : `${historyQuotes.length} ${historyQuotes.length === 1 ? t("disponible") : t("disponibles")}`}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {historyLoading && selectedHistoryQuoteId ? (
        <p role="status" className="insurance-quote__notice">
          {t("Cargando cotización guardada…")}
        </p>
      ) : null}
      {historyError && selectedHistoryQuoteId && !historyLoading ? (
        <p role="alert" className="insurance-quote__notice">
          <InsuranceNotice message={historyError} />
        </p>
      ) : null}
      {selectedHistoryQuoteId ? (
        <div className="insurance-history-actions">
          {onResumeHistoryQuote && failedCount > 0 ? (
            <button
              className="insurance-comparator__btn insurance-comparator__btn--ghost"
              type="button"
              onClick={onResumeHistoryQuote}
            >
              {t("Reintentar esta cotización")}
            </button>
          ) : null}
          {selectedHistoryQuoteId && onDeleteHistoryQuote ? (
            <HistoryDeleteButton
              key={selectedHistoryQuoteId}
              reference={
                historyQuotes.find(
                  (quote) => quote.id === selectedHistoryQuoteId,
                )?.name
              }
              deleting={deletingHistory}
              onDelete={() => onDeleteHistoryQuote(selectedHistoryQuoteId)}
            />
          ) : null}
        </div>
      ) : null}

      {/* 1. MASTER QUOTE HEADER & VEHICLE CONTEXT (Only if quote is active) */}
      {isQuoteActive &&
      (quoteReference || masterQuoteId || vehicleInfo?.plate) ? (
        <header className="insurance-master-header">
          <div className="insurance-master-header__main">
            <div className="insurance-master-header__badge-wrap">
              <span className="insurance-master-badge">
                {t("Cotización Maestra")}
              </span>
              <strong className="insurance-master-reference">
                {quoteReference ?? masterQuoteId ?? "Ref: General"}
              </strong>
              {masterQuoteId && quoteReference ? (
                <span
                  className="insurance-master-id"
                  title={t("ID de Base de Datos")}
                >
                  (ID: {masterQuoteId})
                </span>
              ) : null}
            </div>
            <div className="insurance-master-facts">
              {vehicleInfo?.plate ? (
                <span className="insurance-fact-item">
                  <strong>{t("Placa:")}</strong> {vehicleInfo.plate}
                </span>
              ) : null}
              {vehicleInfo?.declaredValue ? (
                <span className="insurance-fact-item">
                  <strong>{t("Valor Asegurado:")}</strong>{" "}
                  {formatCop(vehicleInfo.declaredValue)}
                </span>
              ) : null}
              <span className="insurance-fact-item">
                <strong>{t("Ramo:")}</strong> {t("Automóviles Livianos")}{" "}
              </span>
              <span className="insurance-fact-status">
                {succeededCount > 0
                  ? t("✓ Recibida")
                  : pendingCount > 0
                    ? selectedHistoryQuoteId
                      ? t("Pendiente")
                      : t("↻ Solicitada…")
                    : failedCount > 0
                      ? t("✕ Rechazada")
                      : "Solicitada"}
              </span>
            </div>
          </div>
          <div className="insurance-master-header__side">
            <span className="insurance-master-count">
              {unifiedQuotes.length}{" "}
              {unifiedQuotes.length === 1
                ? t("opción cotejada")
                : t("opciones cotejadas")}
            </span>
          </div>
        </header>
      ) : null}

      {selectedHistoryQuoteId && !historyLoading ? (
        <div className="insurance-quote__notice">
          {pendingCount > 0 ? (
            <p>
              {t("Esta cotización tiene resultados pendientes de guardar.")}
            </p>
          ) : null}
          <button
            type="button"
            className="insurance-comparator__btn"
            onClick={() => onSelectHistoryQuote?.(selectedHistoryQuoteId)}
          >
            {t("Actualizar cotización guardada")}
          </button>
        </div>
      ) : null}

      {/* Indicador de progreso en vivo */}
      {!hideProgress &&
      isQuoteActive &&
      !selectedHistoryQuoteId &&
      pendingCount > 0 ? (
        <div
          aria-live="polite"
          className="insurance-busy-indicator"
          role="status"
          style={{ marginBottom: "20px" }}
        >
          <div className="insurance-busy-indicator__header">
            <div className="insurance-busy-indicator__icon-wrap">
              <span
                aria-hidden="true"
                className="insurance-spinner insurance-spinner--md"
              />
            </div>
            <div className="insurance-busy-indicator__content">
              <strong className="insurance-busy-indicator__title">
                {t("Cotizando con aseguradoras en vivo… (")}
                {completedCount} {t("de")} {totalCount} {t("recibidas)")}{" "}
              </strong>
              <span className="insurance-busy-indicator__subtitle">
                {succeededCount > 0
                  ? t(
                      "Las ofertas recibidas ya están disponibles abajo. Esperando respuestas adicionales…",
                    )
                  : t(
                      "Consultando tarifas y coberturas oficiales. Cada oferta aparecerá tan pronto responda su aseguradora.",
                    )}
              </span>
            </div>
          </div>
          <div aria-hidden="true" className="insurance-progress-track">
            {totalCount > 0 && completedCount > 0 ? (
              <div
                style={{
                  background: "var(--primary)",
                  height: "100%",
                  width: "100%",
                  transform: `scaleX(${progressPercent / 100})`,
                  transformOrigin: "left",
                  transition: "transform 300ms ease",
                }}
              />
            ) : (
              <div className="insurance-progress-bar--indeterminate" />
            )}
          </div>
        </div>
      ) : null}

      {/* Skeletons cuando está cotizando pero aún no ha llegado la primera oferta */}
      {isQuoteActive &&
      !selectedHistoryQuoteId &&
      unifiedQuotes.length === 0 &&
      pendingCount > 0 ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "20px",
            marginTop: "16px",
            marginBottom: "24px",
          }}
        >
          {effectiveBatchItems
            .filter(
              (item) =>
                item.status === "pending" ||
                retryingIds.includes(item.productId),
            )
            .map((item) => (
              <div
                key={item.productId}
                style={{
                  borderRadius: "12px",
                  border: "1px solid var(--border)",
                  padding: "20px",
                  background: "var(--card, #ffffff)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <strong style={{ fontSize: "0.875rem" }}>{item.label}</strong>
                  <span className="insurance-status-badge insurance-status-badge--pending">
                    {selectedHistoryQuoteId
                      ? t("Pendiente")
                      : t("↻ En progreso")}{" "}
                  </span>
                </div>
                <div
                  className="quote-skeleton"
                  style={{ height: "16px", width: "60%" }}
                />
                <div
                  className="quote-skeleton"
                  style={{ height: "32px", width: "45%", borderRadius: "6px" }}
                />
                <div
                  className="quote-skeleton"
                  style={{ height: "12px", width: "80%" }}
                />
              </div>
            ))}
        </div>
      ) : null}

      {/* 2. COMPARATOR CARDS & COMPARISON */}
      {isQuoteActive && unifiedQuotes.length > 0 ? (
        <section
          aria-label={t("Comparador de pólizas de seguro")}
          className="insurance-comparator"
        >
          {/* Top Filter Chips by Provider (only if multiple providers exist) */}
          {uniqueProviders.length > 1 ? (
            <div className="insurance-comparator__filter-bar">
              <div className="insurance-comparator__chips" role="tablist">
                <button
                  className={`insurance-comparator__chip ${
                    selectedProvider === null ? "is-active" : ""
                  }`}
                  onClick={() => setSelectedProvider(null)}
                  type="button"
                >
                  {t("Todas las aseguradoras (")}
                  {unifiedQuotes.length})
                </button>
                {uniqueProviders.map((prov) => (
                  <button
                    className={`insurance-comparator__chip ${
                      selectedProvider === prov ? "is-active" : ""
                    }`}
                    key={prov}
                    onClick={() => setSelectedProvider(prov)}
                    type="button"
                  >
                    {prov} (
                    {unifiedQuotes.filter((q) => q.provider === prov).length})
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div
            className="insurance-comparator__selection-bar"
            aria-label={t("Ofertas seleccionadas para comparar")}
          >
            <span
              className="insurance-comparator__selection-count"
              role="status"
            >
              <svg
                aria-hidden="true"
                fill="none"
                height="15"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.2"
                viewBox="0 0 24 24"
                width="15"
              >
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
              {comparedQuotesList.length}{" "}
              {comparedQuotesList.length === 1
                ? t("oferta seleccionada")
                : t("ofertas seleccionadas")}{" "}
              <span className="insurance-comparator__selection-max">
                {t("de 4")}
              </span>
            </span>
            <div className="insurance-comparator__selection-actions">
              <button
                aria-label={t("Limpiar")}
                className="insurance-comparator__btn insurance-comparator__btn--ghost insurance-comparator__btn--icon"
                disabled={!comparedQuotesList.length}
                onClick={() => setSelectedQuoteIds([])}
                title={t("Quitar las 4 ofertas del comparador")}
                type="button"
              >
                <svg
                  aria-hidden="true"
                  fill="none"
                  height="16"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  width="16"
                >
                  <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
                  <path d="M22 21H7" />
                  <path d="m5 11 9 9" />
                </svg>
              </button>
              {hidePdfDownload ? null : (
                <button
                  aria-label={t("Descargar PDF")}
                  className="insurance-comparator__btn insurance-comparator__btn--primary insurance-comparator__btn--icon"
                  disabled={!comparedQuotesList.length}
                  onClick={() => {
                    void import("./quote-comparison-pdf")
                      .then(({ downloadQuoteComparisonPdf }) =>
                        downloadQuoteComparisonPdf({
                          quoteReference,
                          quotes: comparedQuotesList,
                          vehicleInfo,
                        }),
                      )
                      .catch(() =>
                        setActionNotice(
                          t("No se pudo generar el PDF. Inténtalo de nuevo."),
                        ),
                      );
                  }}
                  title={
                    comparedQuotesList.length
                      ? t("Descargar PDF con %{p0} %{p1}", {
                          p0: comparedQuotesList.length,
                          p1:
                            comparedQuotesList.length === 1
                              ? t("oferta")
                              : t("ofertas"),
                        })
                      : t("Selecciona al menos una oferta")
                  }
                  type="button"
                >
                  <svg
                    aria-hidden="true"
                    fill="none"
                    height="16"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    width="16"
                  >
                    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
                    <path d="M12 18v-6" />
                    <path d="m9 15 3 3 3-3" />
                  </svg>
                  {comparedQuotesList.length > 0 ? (
                    <span
                      aria-hidden="true"
                      className="insurance-comparator__btn-count insurance-comparator__btn-count--float"
                    >
                      {comparedQuotesList.length}
                    </span>
                  ) : null}
                </button>
              )}
            </div>
          </div>

          {/* Top Product Cards Grid */}
          <div className="insurance-comparator__cards">
            {filteredQuotes.map((quote, idx) => {
              const isRecommended = idx === 0 && quote.score >= 9.2;
              const isCompared = comparedQuoteIds.includes(quote.id);
              const compareOrder = comparedQuoteIds.indexOf(quote.id) + 1;
              const selectionLimitReached =
                !isCompared && comparedQuoteIds.length >= 4;
              return (
                <article
                  className={`insurance-card ${isRecommended ? "insurance-card--recommended" : ""} ${isCompared ? "is-compared" : ""}`}
                  key={quote.id}
                >
                  {isRecommended ? (
                    <div className="insurance-card__ribbon">
                      <span className="insurance-card__ribbon-tag">
                        {t("★ Mejor relación cobertura/precio")}{" "}
                      </span>
                    </div>
                  ) : (
                    <div className="insurance-card__meta-bar">
                      <span className="insurance-card__pill">
                        {quote.badges[0] ?? "Cotización oficial"}
                      </span>
                    </div>
                  )}

                  <div className="insurance-card__header">
                    <div className="insurance-card__brand">
                      <ProviderLogo provider={quote.provider} />
                      <div>
                        <h3 className="insurance-card__provider">
                          {quote.provider}
                        </h3>
                        <p className="insurance-card__product-name">
                          {quote.productName}
                        </p>
                      </div>
                    </div>
                  </div>

                  {quote.quoteNumber ? (
                    <div className="insurance-card__quote-num">
                      <span>{t("Cotización:")}</span>{" "}
                      <code>{quote.quoteNumber}</code>
                    </div>
                  ) : null}

                  <div className="insurance-card__price-row">
                    <strong className="insurance-card__price">
                      {quote.premium > 0
                        ? formatCop(quote.premium)
                        : "Consultar"}
                    </strong>
                    {quote.premium > 0 ? (
                      <span className="insurance-card__period">
                        {t("COP / año")}
                      </span>
                    ) : null}
                  </div>

                  {quote.highlights.length > 0 ? (
                    <ul className="insurance-card__bullets">
                      {quote.highlights.map((bullet, bIdx) => (
                        <li key={bIdx}>
                          <svg
                            aria-hidden="true"
                            className="insurance-card__check-icon"
                            fill="none"
                            height="14"
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2.5"
                            viewBox="0 0 24 24"
                            width="14"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          <span>{bullet}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <div className="insurance-card__action-wrap">
                    <button
                      aria-label={
                        isCompared
                          ? t("Quitar %{p0} %{p1} del comparador", {
                              p0: quote.provider,
                              p1: quote.productName,
                            })
                          : t("Añadir %{p0} %{p1} al comparador", {
                              p0: quote.provider,
                              p1: quote.productName,
                            })
                      }
                      aria-pressed={isCompared}
                      className={`insurance-card__compare-btn ${isCompared ? "is-selected" : ""}`}
                      disabled={selectionLimitReached}
                      onClick={() => toggleSelectedQuote(quote.id)}
                      type="button"
                    >
                      <svg
                        aria-hidden="true"
                        fill="none"
                        height="14"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2.2"
                        viewBox="0 0 24 24"
                        width="14"
                      >
                        {isCompared ? (
                          <polyline points="20 6 9 17 4 12" />
                        ) : (
                          <path d="M12 5v14M5 12h14" />
                        )}
                      </svg>
                      {isCompared
                        ? t("Comparando · %{p0}/4", { p0: compareOrder })
                        : t("Comparar")}
                    </button>
                    <button
                      className="insurance-card__copy-btn"
                      aria-label={
                        copiedId === quote.id
                          ? t("Datos de cotización copiados")
                          : t("Copiar datos de cotización")
                      }
                      onClick={async () => {
                        const info = [
                          t("Aseguradora: %{p0}", { p0: quote.provider }),
                          t("Producto: %{p0}", { p0: quote.productName }),
                          quote.quoteNumber
                            ? t("Número de cotización: %{p0}", {
                                p0: quote.quoteNumber,
                              })
                            : null,
                          quote.premium > 0
                            ? t("Prima total: %{p0} COP", {
                                p0: formatCop(quote.premium),
                              })
                            : null,
                          vehicleInfo?.plate
                            ? t("Placa: %{p0}", { p0: vehicleInfo.plate })
                            : null,
                          quoteReference
                            ? t("Referencia Savia: %{p0}", {
                                p0: quoteReference,
                              })
                            : null,
                        ]
                          .filter(Boolean)
                          .join("\n");
                        try {
                          await navigator.clipboard.writeText(info);
                          setCopiedId(quote.id);
                          setTimeout(() => setCopiedId(null), 2500);
                        } catch {
                          setActionNotice(
                            t("Datos de %{p0} listos.", { p0: quote.provider }),
                          );
                        }
                      }}
                      title={
                        copiedId === quote.id
                          ? t("Datos de cotización copiados")
                          : t("Copiar datos de cotización")
                      }
                      type="button"
                    >
                      {copiedId === quote.id ? (
                        <svg
                          aria-hidden="true"
                          fill="none"
                          height="16"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2.25"
                          viewBox="0 0 24 24"
                          width="16"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <svg
                          aria-hidden="true"
                          fill="none"
                          height="16"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.8"
                          viewBox="0 0 24 24"
                          width="16"
                        >
                          <rect height="14" rx="2" width="12" x="8" y="7" />
                          <path d="M16 7V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2" />
                        </svg>
                      )}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Matriz Detallada de Coberturas Frente a Frente */}
          {comparedQuotesList.some(
            (q) =>
              q.coverages.rce &&
              !q.coverages.rce.includes(t("Según condiciones")) &&
              q.coverages.rce !== t("No informado por la aseguradora"),
          ) ? (
            <div className="insurance-comparison">
              <div className="insurance-comparison__header">
                <div>
                  <h3 className="insurance-comparison__title">
                    {t("Matriz Detallada de Coberturas Frente a Frente")}{" "}
                  </h3>
                  <p className="insurance-comparison__subtitle">
                    {t(
                      "Comparativa técnica cláusula por cláusula para asesoría fiduciaria al cliente",
                    )}{" "}
                  </p>
                </div>
                <span className="insurance-comparison__badge">
                  {comparedQuotesList.length} {t("de")} {unifiedQuotes.length}{" "}
                  {t("Pólizas cotejadas")}{" "}
                </span>
              </div>

              <div className="insurance-comparison__table-container">
                <table className="insurance-comparison__table">
                  <thead>
                    <tr>
                      <th className="insurance-comparison__th-feature">
                        {t("DETALLE DE COBERTURA")}{" "}
                      </th>
                      {comparedQuotesList.map((q, idx) => (
                        <th
                          className={`insurance-comparison__th-plan ${
                            idx === 0
                              ? "insurance-comparison__th-plan--highlight"
                              : ""
                          }`}
                          key={q.id}
                        >
                          <div className="insurance-comparison__plan-header">
                            <div className="insurance-comparison__plan-brand">
                              <ProviderLogo
                                compact
                                decorative
                                provider={q.provider}
                              />
                              <span className="insurance-comparison__plan-tag">
                                {idx === 0 ? t("★ Recomendado") : q.provider}
                              </span>
                            </div>
                            <strong className="insurance-comparison__plan-title">
                              {q.productName}
                            </strong>
                            <span className="insurance-comparison__plan-price">
                              {q.premium > 0
                                ? formatCop(q.premium)
                                : "Consultar"}
                            </span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="insurance-comparison__td-label">
                        <strong>
                          {t(
                            "Responsabilidad Civil Extracontractual (RCE)",
                          )}{" "}
                        </strong>
                      </td>
                      {comparedQuotesList.map((q, idx) => (
                        <td
                          className={`insurance-comparison__td-val ${
                            idx === 0
                              ? "insurance-comparison__td-val--highlight"
                              : ""
                          }`}
                          key={q.id}
                        >
                          <span className="insurance-comparison__val-accent">
                            {q.coverages.rce}
                          </span>
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="insurance-comparison__td-label">
                        <strong>
                          {t("Deducible Pérdida Parcial (Daños/Hurto)")}
                        </strong>
                      </td>
                      {comparedQuotesList.map((q, idx) => (
                        <td
                          className={`insurance-comparison__td-val ${
                            idx === 0
                              ? "insurance-comparison__td-val--highlight"
                              : ""
                          }`}
                          key={q.id}
                        >
                          {q.coverages.partialLossDeductible}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="insurance-comparison__td-label">
                        <strong>{t("Deducible Pérdida Total")}</strong>
                      </td>
                      {comparedQuotesList.map((q, idx) => (
                        <td
                          className={`insurance-comparison__td-val ${
                            idx === 0
                              ? "insurance-comparison__td-val--highlight"
                              : ""
                          }`}
                          key={q.id}
                        >
                          {q.coverages.totalLossDeductible.includes(
                            t("Sin Deducible"),
                          ) ||
                          q.coverages.totalLossDeductible.includes("0%") ? (
                            <span className="insurance-val-badge--good">
                              ✓ {q.coverages.totalLossDeductible}
                            </span>
                          ) : (
                            q.coverages.totalLossDeductible
                          )}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="insurance-comparison__td-label">
                        <strong>{t("Auto de Reemplazo / Sustituto")}</strong>
                      </td>
                      {comparedQuotesList.map((q, idx) => (
                        <td
                          className={`insurance-comparison__td-val ${
                            idx === 0
                              ? "insurance-comparison__td-val--highlight"
                              : ""
                          }`}
                          key={q.id}
                        >
                          {q.coverages.replacementCar ===
                          "No informado por la aseguradora" ? (
                            <span className="insurance-val-badge--neutral">
                              {q.coverages.replacementCar}
                            </span>
                          ) : q.coverages.replacementCar.includes(
                              t("No amparada"),
                            ) ? (
                            <span className="insurance-val-badge--neutral">
                              {t("✕ No amparada")}{" "}
                            </span>
                          ) : (
                            <span className="insurance-val-badge--good">
                              ✓ {q.coverages.replacementCar}
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="insurance-comparison__td-label">
                        <strong>{t("Grúa y Asistencia en Viaje")}</strong>
                      </td>
                      {comparedQuotesList.map((q, idx) => (
                        <td
                          className={`insurance-comparison__td-val ${
                            idx === 0
                              ? "insurance-comparison__td-val--highlight"
                              : ""
                          }`}
                          key={q.id}
                        >
                          {q.coverages.craneAssistance}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="insurance-comparison__td-label">
                        <strong>{t("Conductor Elegido")}</strong>
                      </td>
                      {comparedQuotesList.map((q, idx) => (
                        <td
                          className={`insurance-comparison__td-val ${
                            idx === 0
                              ? "insurance-comparison__td-val--highlight"
                              : ""
                          }`}
                          key={q.id}
                        >
                          {q.coverages.designatedDriver.includes(
                            t("No incluido"),
                          ) ? (
                            <span className="insurance-val-badge--neutral">
                              {t("No incluido")}{" "}
                            </span>
                          ) : (
                            q.coverages.designatedDriver
                          )}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="insurance-comparison__td-label">
                        <strong>
                          {t("Amparo Patrimonial & Gastos Médicos")}
                        </strong>
                      </td>
                      {comparedQuotesList.map((q, idx) => (
                        <td
                          className={`insurance-comparison__td-val ${
                            idx === 0
                              ? "insurance-comparison__td-val--highlight"
                              : ""
                          }`}
                          key={q.id}
                        >
                          {q.coverages.medicalExpenses}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="insurance-comparison__td-label">
                        <strong>
                          {t("Asistencia Jurídica en Sitio 24/7")}
                        </strong>
                      </td>
                      {comparedQuotesList.map((q, idx) => (
                        <td
                          className={`insurance-comparison__td-val ${
                            idx === 0
                              ? "insurance-comparison__td-val--highlight"
                              : ""
                          }`}
                          key={q.id}
                        >
                          {q.coverages.legalAssistance}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {/* Bottom Notice */}
          <footer className="insurance-comparator__footer">
            <div className="insurance-comparator__footer-notice">
              <span className="insurance-info-icon" aria-hidden="true">
                ℹ
              </span>
              <span>
                {t(
                  "Valores expresados en Pesos Colombianos (COP) según la respuesta oficial emitida por cada aseguradora en la cotización.",
                )}{" "}
              </span>
            </div>
          </footer>
          {actionNotice ? (
            <p className="insurance-action-toast" role="status">
              {actionNotice}
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Empty State when no quote is active */}
      {!isQuoteActive ? (
        <div
          className="insurance-results-empty"
          role="region"
          aria-label={t("Sin cotización seleccionada")}
        >
          <span aria-hidden="true" className="insurance-results-empty__glow" />
          <div className="insurance-results-empty__icon-wrap">
            <svg
              aria-hidden="true"
              className="insurance-results-empty__icon"
              fill="none"
              height="34"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
              viewBox="0 0 24 24"
              width="34"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" x2="8" y1="13" y2="13" />
              <line x1="16" x2="8" y1="17" y2="17" />
            </svg>
            <span
              aria-hidden="true"
              className="insurance-results-empty__icon-dot"
            />
          </div>
          <p className="insurance-results-empty__eyebrow">
            {showHistorySelector ? t("Historial") : t("Cotizaciones")}
          </p>
          <h3 className="insurance-results-empty__title">
            {t("Ninguna cotización seleccionada")}{" "}
          </h3>
          <p className="insurance-results-empty__desc">
            {showHistorySelector && historyQuotes.length > 0
              ? t(
                  "Selecciona una cotización anterior en el menú desplegable para consultar sus ofertas cotejadas, o prepara una nueva desde el formulario.",
                )
              : t(
                  "Aún no se ha generado ninguna cotización. Completa el formulario de vehículo y tomador para consultar aseguradoras en línea.",
                )}
          </p>
          {onGoToForm ? (
            <button
              type="button"
              className="insurance-results-empty__action"
              onClick={onGoToForm}
            >
              {t("Preparar nueva cotización")}{" "}
              <svg
                aria-hidden="true"
                fill="none"
                height="16"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.2"
                viewBox="0 0 24 24"
                width="16"
              >
                <line x1="5" x2="19" y1="12" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          ) : null}
          <ol
            aria-label={t("Cómo empezar")}
            className="insurance-results-empty__steps"
          >
            <li>
              <span aria-hidden="true">1</span>
              {showHistorySelector
                ? t("Elige anterior")
                : t("Completa vehículo")}
            </li>
            <li>
              <span aria-hidden="true">2</span>
              {t("Datos del tomador")}{" "}
            </li>
            <li>
              <span aria-hidden="true">3</span>
              {t("Compara ofertas")}{" "}
            </li>
          </ol>
        </div>
      ) : null}

      {/* 3. TECHNICAL REQUESTS & RETRIES PANEL (ACCESSIBLE TO USER AND AUTOMATED TESTS) */}
      {effectiveBatchItems.length > 0 ? (
        <details className="insurance-batch-disclosure">
          <summary className="insurance-batch-disclosure__summary">
            <span>
              <h2 className="insurance-batch-panel__title">
                {t("Solicitudes de cotización")}{" "}
              </h2>
              <span className="insurance-batch-disclosure__meta">
                {quoteReference ? `Ref: ${quoteReference} · ` : ""}
                {succeededCount} {t("completadas ·")} {failedCount}{" "}
                {t("fallidas de")} {effectiveBatchItems.length}{" "}
                {t("productos")}{" "}
              </span>
            </span>
            <span
              aria-hidden="true"
              className="insurance-batch-disclosure__indicator"
            />
          </summary>
          <section
            aria-label={t("Estado de solicitudes de cotización")}
            className="insurance-batch-panel"
          >
            <div className="insurance-batch-panel__header">
              {failedCount > 0 && onRetryAll ? (
                <button
                  className="insurance-button-retry-all"
                  disabled={retryingIds.length > 0}
                  onClick={() => void onRetryAll?.()}
                  type="button"
                >
                  {retryingIds.length > 0
                    ? "Reintentando..."
                    : t("Reintentar fallidos (%{p0})", { p0: failedCount })}
                </button>
              ) : null}
            </div>

            <div className="insurance-batch-table-container">
              <table className="insurance-batch-table">
                <thead>
                  <tr>
                    <th>{t("Aseguradora / Producto")}</th>
                    <th>{t("Estado")}</th>
                    <th>{t("Detalle")}</th>
                    <th className="insurance-batch-table__th--action">
                      {t("Acción")}{" "}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {effectiveBatchItems.map((item) => {
                    const isRetrying = retryingIds.includes(item.productId);
                    return (
                      <tr
                        className={`insurance-batch-row--${item.status}`}
                        key={item.productId}
                      >
                        <td className="insurance-batch-table__product">
                          <strong>{item.label}</strong>
                        </td>
                        <td>
                          {item.status === "succeeded" ? (
                            <span className="insurance-status-badge insurance-status-badge--success">
                              {t("✓ Completado")}{" "}
                            </span>
                          ) : item.status === "pending" || isRetrying ? (
                            <span className="insurance-status-badge insurance-status-badge--pending">
                              {selectedHistoryQuoteId
                                ? t("Pendiente")
                                : t("↻ En progreso")}{" "}
                            </span>
                          ) : (
                            <span className="insurance-status-badge insurance-status-badge--failed">
                              {t("✕ Falló")}{" "}
                            </span>
                          )}
                        </td>
                        <td className="insurance-batch-table__detail">
                          {item.error ? (
                            <span
                              className="insurance-batch-error-text"
                              title={item.error}
                            >
                              <InsuranceNotice
                                message={item.error}
                                code={item.errorCode}
                              />
                            </span>
                          ) : item.status === "succeeded" ? (
                            <span className="insurance-batch-success-text">
                              {item.quoteNumber
                                ? t("Cotización: %{p0}%{p1}", {
                                    p0: item.quoteNumber,
                                    p1:
                                      typeof item.premium === "number"
                                        ? ` · ${money(item.premium, locale)}`
                                        : "",
                                  })
                                : t("Cotización generada")}
                            </span>
                          ) : (
                            <span className="insurance-batch-pending-text">
                              {selectedHistoryQuoteId
                                ? t("Sin respuesta guardada")
                                : t("Consultando proveedor…")}{" "}
                            </span>
                          )}
                        </td>
                        <td className="insurance-batch-table__action">
                          {item.status === "failed" && onRetrySingle ? (
                            <button
                              className="insurance-button-retry"
                              disabled={isRetrying || retryingIds.length > 0}
                              onClick={() =>
                                void onRetrySingle?.(item.productId)
                              }
                              type="button"
                            >
                              {isRetrying
                                ? t("Reintentando…")
                                : t("Reintentar")}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </details>
      ) : (
        productErrors.map((error) => (
          <p className="insurance-quote__error" key={error} role="alert">
            <InsuranceNotice message={error} />
          </p>
        ))
      )}

      {isQuoteActive &&
      !effectiveBatchItems.length &&
      !productErrors.length &&
      !unifiedQuotes.length ? (
        <p className="insurance-quote__empty">
          {t(
            "Aún no hay resultados. Completa una cotización para explorarlos aquí.",
          )}{" "}
        </p>
      ) : null}
    </section>
  );
}
