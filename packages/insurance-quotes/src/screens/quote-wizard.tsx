import {
  quoteSummaryPatch,
  resumedQuoteItems,
  persistQuoteSummary,
} from "../quote-batch";
import { persistQuoteDetail } from "../quote-persistence";
import { InsuranceNotice } from "../notice";
import { usePluginLocale } from "@savia/studio-shared/plugin-locale-react";
import {
  pluginIntlLocale,
  type PluginLocale,
  type PluginMessageParams,
} from "@savia/studio-shared/plugin-localization";
import { insuranceMessage } from "../messages";
import { useInsuranceMessages } from "../localization";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  PluginApi,
  PluginExtensionActionRun,
} from "@savia/studio-shared/plugin-api";
import {
  insuranceQuoteProductCatalog,
  type InsurancePackageSettings,
} from "../configuration";
import {
  applyClientRecord,
  fetchClientByMatch,
  matchSourceKey,
  upsertQuoteClient,
} from "../client-mapping";
import {
  QuoteResults,
  type QuoteBatchItem,
  type HistoricalQuoteSummary,
} from "./quote-results";
import {
  deleteQuoteHistory,
  fetchDetailsForQuote,
  mapDetailToBatchItem,
} from "../quote-history";
import { buildResultSnapshot, serializeSnapshot } from "../quote-snapshot";
import { toUnifiedComparisonQuote } from "./unified-quote-model";
import {
  applyVehicleLookup,
  defaultQuoteFormValues,
  quoteSteps,
  toAutoLightQuoteInput,
  updateQuoteValue,
  validateQuote,
  validateQuoteStep,
  type QuoteFormValues,
  type QuoteInputErrors,
} from "./quote-input";

type QuoteEntry = "direct" | "wizard";

type QuoteWizardProps = {
  savia: PluginApi;
  settings: InsurancePackageSettings;
  entry: QuoteEntry;
};

const productById = new Map(
  insuranceQuoteProductCatalog.map((product) => [product.id, product]),
);

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function runFromResponse(
  run: { runId: string; status: string },
  output: unknown,
): PluginExtensionActionRun {
  const now = new Date().toISOString();
  const failed =
    output &&
    typeof output === "object" &&
    !Array.isArray(output) &&
    (output as { status?: unknown }).status === "error";
  return {
    runId: run.runId,
    actionId: "quote",
    connectionId: "simulation",
    status: failed
      ? "failed"
      : run.status === "pending" ||
          run.status === "succeeded" ||
          run.status === "failed" ||
          run.status === "expired"
        ? run.status
        : "succeeded",
    output,
    errorCode: failed ? "FLOW_EXECUTION_FAILED" : null,
    createdAt: now,
    updatedAt: now,
  };
}

function generateQuoteReference(): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `COT-${dateStr}-${randomSuffix}`;
}

function extractQuoteData(output: unknown): {
  quoteNumber?: string;
  premium?: number;
} {
  if (!output || typeof output !== "object" || Array.isArray(output)) return {};
  const data = (output as Record<string, unknown>).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const rec = data as Record<string, unknown>;

  let quoteNumber: string | undefined =
    typeof rec.quoteNumber === "string" ? rec.quoteNumber : undefined;
  let premium: number | undefined =
    typeof rec.premiumTotal === "number"
      ? rec.premiumTotal
      : typeof rec.premium === "number"
        ? rec.premium
        : undefined;

  const resp =
    rec.response && typeof rec.response === "object"
      ? (rec.response as Record<string, unknown>)
      : null;
  if (resp) {
    const sim = resp.simulacion as Record<string, unknown> | undefined;
    if (
      !quoteNumber &&
      sim &&
      (typeof sim.codigo === "string" || typeof sim.codigo === "number")
    ) {
      quoteNumber = String(sim.codigo);
    }
    const econ = resp.datosEconomicos as Record<string, unknown> | undefined;
    if (premium === undefined && econ) {
      const tot = Number(econ.total ?? econ.primaAnual);
      if (Number.isFinite(tot)) premium = tot;
    }
  }

  return { quoteNumber, premium };
}

function recordVersion(value: unknown): number | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const version = (value as Record<string, unknown>)._version;
  return typeof version === "number" && Number.isInteger(version) && version > 0
    ? version
    : undefined;
}

function calculateAge(dateStr: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const birth = new Date(dateStr);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age >= 0 ? age : null;
}

function birthDateFromAge(age: number): string {
  const today = new Date();
  const year = today.getFullYear() - age;
  return `${year}-06-15`;
}

function formatCurrencyNumber(val: string, locale: PluginLocale): string {
  const clean = val.replace(/\D/g, "");
  if (!clean) return "";
  return Number(clean).toLocaleString(pluginIntlLocale(locale));
}

function QuoteField({
  label,
  error,
  badge,
  children,
}: {
  label: React.ReactNode;
  error?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useInsuranceMessages();
  return (
    <label className={`insurance-field ${error ? "has-error" : ""}`.trim()}>
      <span className="insurance-field__label-row">
        <span>{label}</span>
        {badge}
      </span>
      {children}
      {error ? <small role="alert">{t(error)}</small> : null}
    </label>
  );
}

type DaneCityOption = {
  code: string;
  city: string;
  department: string;
};

function CitySelectorField({
  label,
  testLabel,
  error,
  value,
  onChange,
  placeholder = "Buscar ciudad (ej. Bogotá, Medellín, Cali)...",
}: {
  label: React.ReactNode;
  testLabel?: string;
  error?: string;
  value: string;
  onChange: (code: string) => void;
  placeholder?: string;
}) {
  const t = useInsuranceMessages();

  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<DaneCityOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [lookupError, setLookupError] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [resolvedCity, setResolvedCity] = useState<DaneCityOption | null>(null);
  const isInteractingRef = useRef(false);

  useEffect(() => {
    if (!value) {
      setResolvedCity(null);
      if (!isInteractingRef.current) {
        setQuery("");
      }
      return;
    }

    if (resolvedCity && resolvedCity.code === value) {
      if (!isInteractingRef.current) {
        setQuery(`${resolvedCity.city} (${resolvedCity.department})`);
      }
      return;
    }

    let active = true;
    const fetchCity = async () => {
      try {
        const res = await fetch(
          `/api/lookups/dane?${new URLSearchParams({ city: value.trim() })}`,
        );
        if (res.ok && active) {
          const data = (await res.json()) as {
            status: string;
            matches?: DaneCityOption[];
          };
          if (Array.isArray(data.matches) && data.matches.length > 0) {
            const exact =
              data.matches.find(
                (m) =>
                  m.code === value.trim() ||
                  m.city.toLowerCase() === value.trim().toLowerCase(),
              ) ?? data.matches[0];
            setResolvedCity(exact);
            if (!isInteractingRef.current) {
              setQuery(`${exact.city} (${exact.department})`);
            }
          }
        }
      } catch {
        // Fallback gracefully
      }
    };
    void fetchCity();
    return () => {
      active = false;
    };
  }, [value, resolvedCity]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setLookupError(false);
      return;
    }

    if (
      resolvedCity &&
      (trimmed.toLowerCase() ===
        `${resolvedCity.city} (${resolvedCity.department})`.toLowerCase() ||
        trimmed.toLowerCase() === resolvedCity.city.toLowerCase() ||
        trimmed === resolvedCity.code)
    ) {
      setSuggestions([]);
      setLookupError(false);
      return;
    }

    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      setLookupError(false);
      try {
        const res = await fetch(
          `/api/lookups/dane?${new URLSearchParams({ city: trimmed })}`,
        );
        if (!res.ok) throw new Error(`City lookup failed: ${res.status}`);
        const data = (await res.json()) as {
          status: string;
          matches?: DaneCityOption[];
        };
        if (active) {
          setSuggestions(Array.isArray(data.matches) ? data.matches : []);
        }
      } catch {
        if (active) {
          setSuggestions([]);
          setLookupError(true);
        }
      } finally {
        if (active) setLoading(false);
      }
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, resolvedCity]);

  const selectCity = (item: DaneCityOption) => {
    isInteractingRef.current = false;
    setResolvedCity(item);
    setQuery(`${item.city} (${item.department})`);
    onChange(item.code);
    setShowDropdown(false);
    setSuggestions([]);
    setLookupError(false);
  };

  const handleClear = () => {
    isInteractingRef.current = false;
    setResolvedCity(null);
    setQuery("");
    onChange("");
    setSuggestions([]);
    setLookupError(false);
    setShowDropdown(false);
  };

  const badge = loading ? (
    <span className="insurance-field-syncing">
      <span
        aria-hidden="true"
        className="insurance-spinner insurance-spinner--xs"
      />{" "}
      {t("Consultando…")}{" "}
    </span>
  ) : resolvedCity ? (
    <span
      className="insurance-field-synced"
      title={t("Código DANE: %{p0}", { p0: resolvedCity.code })}
    >
      {t("✓ DANE:")} {resolvedCity.code}
    </span>
  ) : undefined;

  return (
    <QuoteField
      badge={badge}
      error={
        error ??
        (lookupError ? t("No se pudieron consultar las ciudades.") : undefined)
      }
      label={
        <span>
          {label}
          {testLabel ? (
            <span className="insurance-sr-only"> {testLabel}</span>
          ) : null}
        </span>
      }
    >
      <div className="insurance-city-autocomplete-wrap">
        <input
          aria-autocomplete="list"
          aria-expanded={showDropdown && suggestions.length > 0}
          aria-label={
            testLabel ?? (typeof label === "string" ? label : undefined)
          }
          onBlur={() => {
            setTimeout(() => {
              isInteractingRef.current = false;
              setShowDropdown(false);
              if (!resolvedCity && suggestions.length === 1 && suggestions[0]) {
                selectCity(suggestions[0]);
              }
            }, 200);
          }}
          onChange={(event) => {
            isInteractingRef.current = true;
            const next = event.target.value;
            setQuery(next);
            const trimmed = next.trim();
            if (/^\d{5}$/.test(trimmed)) {
              onChange(trimmed);
            } else if (!trimmed) {
              onChange("");
              setResolvedCity(null);
            } else if (
              resolvedCity &&
              trimmed.toLowerCase() !==
                `${resolvedCity.city} (${resolvedCity.department})`.toLowerCase() &&
              trimmed.toLowerCase() !== resolvedCity.city.toLowerCase()
            ) {
              setResolvedCity(null);
              onChange("");
            }
            setShowDropdown(true);
          }}
          onFocus={() => {
            if (suggestions.length > 0) setShowDropdown(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setShowDropdown(false);
            } else if (
              event.key === "Enter" &&
              suggestions.length > 0 &&
              suggestions[0]
            ) {
              event.preventDefault();
              selectCity(suggestions[0]);
            }
          }}
          placeholder={placeholder ? t(placeholder) : undefined}
          value={query}
        />
        <div className="insurance-city-actions">
          {query ? (
            <button
              aria-label={t("Limpiar ciudad seleccionada")}
              className="insurance-city-clear-btn"
              onClick={handleClear}
              title={t("Limpiar")}
              type="button"
            >
              ×
            </button>
          ) : null}
          {loading ? (
            <span className="insurance-city-loading-spinner" aria-hidden="true">
              <span className="insurance-spinner insurance-spinner--xs" />
            </span>
          ) : null}
        </div>
        {showDropdown && suggestions.length > 0 ? (
          <ul className="insurance-city-dropdown" role="listbox">
            {suggestions.map((item) => (
              <li key={item.code} role="presentation">
                <button
                  className="insurance-city-dropdown__item"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectCity(item);
                  }}
                  type="button"
                >
                  <span className="insurance-city-dropdown__info">
                    <strong className="insurance-city-dropdown__city">
                      {item.city}
                    </strong>
                    <span className="insurance-city-dropdown__dept">
                      {item.department}
                    </span>
                  </span>
                  <span className="insurance-city-dropdown__code">
                    {item.code}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </QuoteField>
  );
}

export function InsuranceQuoteWizard({
  savia,
  settings,
  entry,
}: QuoteWizardProps) {
  const t = useInsuranceMessages();
  const locale = usePluginLocale();
  const masterCollection = useMemo(
    () => savia.collections.collection("cotizaciones"),
    [savia],
  );
  const detailCollection = useMemo(
    () => savia.collections.collection("cotizaciones_detalle"),
    [savia],
  );
  const persistDetail: typeof detailCollection.update = async (
    id,
    patch,
    options,
  ) => {
    try {
      const { record, omittedFields } = await persistQuoteDetail(
        detailCollection,
        id,
        patch,
        options,
      );
      if (omittedFields.includes("resultado_snapshot")) {
        setPersistenceNotice(
          (current) =>
            current ||
            t(
              "La oferta se guardó, pero este historial aún no admite el detalle de coberturas.",
            ),
        );
      }
      return record;
    } catch (error) {
      setPersistenceNotice(
        t(
          "No se pudo guardar un resultado en el historial. Conserva esta pantalla y vuelve a intentarlo.",
        ),
      );
      throw error;
    }
  };

  const [surface, setSurface] = useState<"form" | "results" | "history">(
    "form",
  );
  const [activeStep, setActiveStep] = useState(0);
  const [values, setValues] = useState<QuoteFormValues>(defaultQuoteFormValues);
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [errors, setErrors] = useState<QuoteInputErrors>({});
  const [notice, setNotice] = useState("");
  const [persistenceNotice, setPersistenceNotice] = useState("");
  const [lookingUpPlate, setLookingUpPlate] = useState(false);
  const [lastLookedUpPlate, setLastLookedUpPlate] = useState<string | null>(
    null,
  );
  const [lastClientLookup, setLastClientLookup] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState<
    Array<{ label: string; value: string }>
  >([]);
  const [loadingAddress, setLoadingAddress] = useState(false);
  const [showAddressDropdown, setShowAddressDropdown] = useState(false);
  const [declaredValueFocused, setDeclaredValueFocused] = useState(false);
  const [accessoriesValueFocused, setAccessoriesValueFocused] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [runs, setRuns] = useState<PluginExtensionActionRun[]>([]);
  const [productErrors, setProductErrors] = useState<string[]>([]);
  const [batchItems, setBatchItemsState] = useState<QuoteBatchItem[]>([]);
  const batchItemsRef = useRef<QuoteBatchItem[]>([]);
  // Provider promises may settle before React renders. Summary writes must see
  // all completed results, including completions in the same render batch.
  const setBatchItems = (
    next: QuoteBatchItem[] | ((current: QuoteBatchItem[]) => QuoteBatchItem[]),
  ) => {
    const items =
      typeof next === "function" ? next(batchItemsRef.current) : next;
    batchItemsRef.current = items;
    setBatchItemsState(items);
  };
  const [retryingIds, setRetryingIds] = useState<string[]>([]);
  const busy = lookingUpPlate || quoting || retryingIds.length > 0;
  const [quoteReference, setQuoteReference] = useState<string | null>(null);
  const [masterQuoteId, setMasterQuoteId] = useState<string | null>(null);
  const [historyQuotes, setHistoryQuotes] = useState<HistoricalQuoteSummary[]>(
    [],
  );
  const [selectedHistoryQuoteId, setSelectedHistoryQuoteId] = useState<
    string | null
  >(null);
  const [historicalBatchItems, setHistoricalBatchItems] = useState<
    QuoteBatchItem[] | null
  >(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [deletingHistory, setDeletingHistory] = useState(false);
  const [quoteTimings, setQuoteTimings] = useState<{
    setupMs?: number;
    crmMs?: number;
    products?: Record<string, number>;
  } | null>(null);
  const [resumeQuote, setResumeQuote] = useState<{
    summary: HistoricalQuoteSummary;
    items: QuoteBatchItem[];
  } | null>(null);

  const products = useMemo(
    () =>
      settings.products
        .filter((product) => product.enabled)
        .sort((left, right) => left.rank - right.rank)
        .flatMap((product) => {
          const catalog = productById.get(product.id);
          return catalog ? [{ ...product, ...catalog }] : [];
        }),
    [settings.products],
  );
  const currentStep = quoteSteps[activeStep];
  const currentErrors = validateQuoteStep(values, currentStep.id);
  const pageEnabled =
    entry === "direct"
      ? settings.quotePages.direct
      : settings.quotePages.wizard;

  useEffect(() => {
    setSelectedProducts((current) => {
      const valid = current.filter((id) =>
        products.some((product) => product.id === id),
      );
      return valid.length ? valid : products.map((product) => product.id);
    });
  }, [products]);

  const refreshHistoricalQuotes = useCallback(async () => {
    try {
      const coll = savia.collections?.collection?.("cotizaciones");
      if (coll?.list) {
        const perPage = 200;
        const first = await coll.list({ page: 1, perPage });
        const records = [
          ...((first?.data ?? []) as Array<Record<string, unknown>>),
        ];
        const total =
          typeof first?.total === "number" ? first.total : records.length;
        const pages = Math.max(1, Math.ceil(total / perPage));
        if (pages > 1) {
          const rest = await Promise.all(
            Array.from({ length: Math.min(pages - 1, 9) }, (_, index) =>
              coll.list({ page: index + 2, perPage }),
            ),
          );
          for (const chunk of rest) {
            records.push(
              ...((chunk?.data ?? []) as Array<Record<string, unknown>>),
            );
          }
        }
        const parsed: HistoricalQuoteSummary[] = records.map((r) => ({
          id: String(r.id),
          name: String(r.name || r.id),
          version: recordVersion(r),
          placa: typeof r.placa === "string" ? r.placa : undefined,
          ramo: typeof r.ramo === "string" ? r.ramo : undefined,
          valor_asegurado:
            typeof r.valor_asegurado === "number"
              ? r.valor_asegurado
              : undefined,
          prima: typeof r.prima === "number" ? r.prima : undefined,
          estado: typeof r.estado === "string" ? r.estado : undefined,
          created_at:
            typeof r.created_at === "string" ? r.created_at : undefined,
        }));
        setHistoryQuotes(parsed.reverse());
      }
    } catch {
      // ignore
    }
  }, [savia]);

  useEffect(() => {
    void refreshHistoricalQuotes();
  }, [refreshHistoricalQuotes]);

  const historyRequest = useRef(0);
  const historySelection = useRef(selectedHistoryQuoteId);
  historySelection.current = selectedHistoryQuoteId;
  const currentMaster = useRef(masterQuoteId);
  currentMaster.current = masterQuoteId;
  useEffect(
    () => () => {
      historyRequest.current += 1;
    },
    [],
  );

  const handleSelectHistoryQuote = async (
    quoteId: string | null,
    explicitReference?: string,
  ) => {
    const request = ++historyRequest.current;
    setNotice("");
    if (!quoteId || quoteId === "current") {
      setHistoryLoading(false);
      setSelectedHistoryQuoteId(null);
      setHistoricalBatchItems(null);
      setHistoryError(null);
      setResumeQuote(null);
      return;
    }
    // Solo lecturas: nunca invoca acciones de cotización ni lookups.
    setSelectedHistoryQuoteId(quoteId);
    setResumeQuote(null);
    setHistoricalBatchItems(null);
    setHistoryError(null);
    setHistoryLoading(true);
    try {
      const detailColl = savia.collections?.collection?.(
        "cotizaciones_detalle",
      );
      if (detailColl) {
        const quoteReference =
          explicitReference ??
          historyQuotes.find((quote) => quote.id === quoteId)?.name;
        const details = await fetchDetailsForQuote(
          detailColl as unknown as Parameters<typeof fetchDetailsForQuote>[0],
          quoteId,
          quoteReference,
        );
        if (request !== historyRequest.current) return;
        if (!details.length) {
          // No presentar un vacío como éxito: el usuario reporta que los
          // detalles "no llegan" y el borrado posterior falla por relaciones.
          setHistoricalBatchItems([]);
          const emptyMessage = t(
            "No se encontraron detalles para esta cotización. Es posible que aún se esté sincronizando; reintenta en unos segundos.",
          );
          setHistoryError(emptyMessage);
          setNotice(emptyMessage);
          return;
        }
        const mapped: QuoteBatchItem[] = details.map((d) =>
          mapDetailToBatchItem(d, t("La ejecución no se completó.")),
        );
        setHistoricalBatchItems(mapped);
      } else {
        setHistoricalBatchItems([]);
      }
    } catch {
      if (request !== historyRequest.current) return;
      // No presentar un resultado vacío como carga exitosa.
      setHistoricalBatchItems(null);
      setHistoryError(
        t("No se pudo cargar la cotización guardada. Inténtalo de nuevo."),
      );
      setNotice(
        t("No se pudo cargar la cotización guardada. Inténtalo de nuevo."),
      );
    } finally {
      if (request === historyRequest.current) setHistoryLoading(false);
    }
  };

  const handleDeleteHistoryQuote = async (quoteId: string) => {
    if (deletingHistory || (busy && quoteId === masterQuoteId)) return;
    const summary = historyQuotes.find((quote) => quote.id === quoteId);
    if (!summary) return;
    setDeletingHistory(true);
    try {
      const detailColl = savia.collections?.collection?.(
        "cotizaciones_detalle",
      );
      const masterColl = savia.collections?.collection?.("cotizaciones");
      if (!detailColl || !masterColl) {
        setNotice(t("No se pudo eliminar la cotización guardada."));
        return;
      }
      const masterVersion = summary.version;
      const result = await deleteQuoteHistory(
        detailColl as unknown as Parameters<typeof deleteQuoteHistory>[0],
        masterColl as unknown as Parameters<typeof deleteQuoteHistory>[1],
        quoteId,
        masterVersion,
        summary.name,
      );
      if (!result.ok) {
        // Si falla un hijo, se conserva el master para recuperación.
        // Muestra el motivo real (relaciones, versión, permisos) en vez de
        // un genérico para poder diagnosticar en preview.
        const reason =
          result.error && !/No se pudo eliminar/i.test(result.error)
            ? ` ${result.error}`
            : "";
        const message = t(
          "No se pudo eliminar la cotización guardada. Inténtalo de nuevo.",
        );
        setNotice(`${message}${reason ? ` (${reason.trim()})` : ""}`);
        // Releer por si se eliminaron hijos aunque el master sobrevivió.
        const [hashPath, hashQuery = ""] = window.location.hash.split("?");
        const params = new URLSearchParams(hashQuery);
        if (params.get("quote") === quoteId) {
          params.delete("quote");
          const query = params.toString();
          window.history.replaceState(
            window.history.state,
            "",
            `${window.location.pathname}${window.location.search}${hashPath}${query ? `?${query}` : ""}`,
          );
          appliedQuoteLink.current = null;
          appliedQuoteLinkRef.current = "";
        }
        await refreshHistoricalQuotes();
        return;
      }
      await refreshHistoricalQuotes();
      if (currentMaster.current === quoteId) {
        setMasterQuoteId(null);
        setQuoteReference(null);
        setBatchItems([]);
      }
      if (historySelection.current === quoteId) {
        historyRequest.current += 1;
        setHistoryLoading(false);
        setSelectedHistoryQuoteId(null);
        setHistoricalBatchItems(null);
        setHistoryError(null);
        setResumeQuote(null);
      }
    } catch {
      setNotice(t("No se pudo eliminar la cotización guardada."));
    } finally {
      setDeletingHistory(false);
    }
  };

  const appliedQuoteLink = useRef<string | null>(null);
  const appliedQuoteLinkRef = useRef("");
  useEffect(() => {
    const selectLinkedQuote = () => {
      const query = new URLSearchParams(
        window.location.hash.split("?")[1] ?? "",
      );
      const id = query.get("quote");
      if (!id) {
        appliedQuoteLink.current = null;
        appliedQuoteLinkRef.current = "";
        return;
      }
      const reference =
        historyQuotes.find((quote) => quote.id === id)?.name ?? undefined;
      // Reintenta cuando el historial ya trae la referencia o cuando el
      // intento anterior quedó sin detalles (colección aún sincronizando).
      const attemptKey = `${id}::${reference ?? ""}`;
      const needsRetry =
        appliedQuoteLink.current !== id ||
        (appliedQuoteLinkRef.current !== attemptKey &&
          (reference !== undefined ||
            historicalBatchItems?.length === 0 ||
            historyError !== null));
      if (id && needsRetry) {
        appliedQuoteLink.current = id;
        appliedQuoteLinkRef.current = attemptKey;
        setSurface("results");
        void handleSelectHistoryQuote(id, reference);
      }
    };
    selectLinkedQuote();
    window.addEventListener("hashchange", selectLinkedQuote);
    return () => window.removeEventListener("hashchange", selectLinkedQuote);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyQuotes, historicalBatchItems, historyError]);

  const refreshRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      setRuns(await savia.actions.list({ limit: 50 }));
    } catch {
      setNotice("No se pudieron actualizar los resultados.");
    } finally {
      setLoadingRuns(false);
    }
  }, [savia]);

  useEffect(() => {
    void refreshRuns();
  }, [refreshRuns]);

  useEffect(() => {
    const query = values.applicant.address?.trim() ?? "";
    if (query.length < 3) {
      setAddressSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLoadingAddress(true);
      try {
        const res = await fetch(
          `/api/geocoding/search?${new URLSearchParams({
            q: query,
            provider: "photon",
            country: "co",
            language: "es",
          })}`,
        );
        if (res.ok) {
          const data = (await res.json()) as {
            data?: Array<{ label: string; value: string }>;
          };
          if (Array.isArray(data?.data)) {
            setAddressSuggestions(data.data);
          }
        }
      } catch {
        // Graceful fallback
      } finally {
        setLoadingAddress(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [values.applicant.address]);

  // Si el cliente ya existe en la colección mapeada, carga sus datos al
  // formulario; si no existe, se crea al cotizar.
  const clientMatchSource = matchSourceKey(settings.clientMapping);
  const clientMatchValue =
    clientMatchSource &&
    clientMatchSource !== "fullName" &&
    Object.prototype.hasOwnProperty.call(values.applicant, clientMatchSource)
      ? values.applicant[
          clientMatchSource as keyof QuoteFormValues["applicant"]
        ].trim()
      : "";
  useEffect(() => {
    const lookupKey = `${settings.clientMapping.collection}:${settings.clientMapping.matchField}:${clientMatchValue}`;
    if (!clientMatchValue || lookupKey === lastClientLookup || quoting) {
      return;
    }
    const matchValue = clientMatchValue;
    const timer = setTimeout(async () => {
      let record: Record<string, unknown> | null = null;
      try {
        record = await fetchClientByMatch(
          savia,
          settings.clientMapping,
          matchValue,
        );
      } catch {
        return;
      }
      setLastClientLookup(lookupKey);
      if (!record) return;
      const applied = applyClientRecord(
        values.applicant,
        record,
        settings.clientMapping,
      );
      if (!applied.filled.length) return;
      setValues((current) => {
        if (
          (current.applicant[
            clientMatchSource as keyof QuoteFormValues["applicant"]
          ] ?? "") !== matchValue
        ) {
          return current;
        }
        const fresh = applyClientRecord(
          current.applicant,
          record as Record<string, unknown>,
          settings.clientMapping,
        );
        return fresh.filled.length
          ? { ...current, applicant: fresh.applicant }
          : current;
      });
    }, 450);
    return () => clearTimeout(timer);
  }, [
    clientMatchValue,
    lastClientLookup,
    quoting,
    savia,
    settings,
    values.applicant,
    clientMatchSource,
  ]);

  const update = (
    field: Parameters<typeof updateQuoteValue>[1],
    value: string | boolean,
  ) => {
    setValues((current) => updateQuoteValue(current, field, value));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setNotice("");
  };

  const next = () => {
    const nextErrors = validateQuoteStep(values, currentStep.id);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setActiveStep((current) => Math.min(current + 1, quoteSteps.length - 1));
  };

  const lookup = async () => {
    const plateError = validateQuoteStep(values, "vehicle")["vehicle.plate"];
    if (plateError) {
      setErrors({ "vehicle.plate": plateError });
      return;
    }
    if (!settings.vehicleLookup.enabled) {
      setNotice(
        "La consulta de placa está desactivada en Administrar Seguros.",
      );
      return;
    }
    setLookingUpPlate(true);
    setLastLookedUpPlate(values.vehicle.plate);
    setNotice("");
    try {
      const response = await savia.actions.execute<{
        type?: unknown;
        data?: { vehicle?: unknown };
      }>("quote", {
        input: {
          mode: "live",
          flowId: settings.vehicleLookup.flowId,
          quoteInput: { vehicle: { plate: values.vehicle.plate } },
        },
      });
      const vehicle = response.output.data?.vehicle;
      if (!vehicle || typeof vehicle !== "object" || Array.isArray(vehicle)) {
        setNotice("No se encontraron datos para esa placa.");
        return;
      }
      const result = vehicle as Record<string, unknown>;
      if (result.plate !== values.vehicle.plate) {
        setNotice("La respuesta no corresponde a la placa actual.");
        return;
      }
      setValues((current) =>
        applyVehicleLookup(current, {
          plate: String(result.plate),
          ...(typeof result.fasecoldaCode === "string"
            ? { fasecoldaCode: result.fasecoldaCode }
            : {}),
          ...(typeof result.productionYear === "number"
            ? { productionYear: result.productionYear }
            : {}),
          ...(typeof result.declaredValue === "number"
            ? { declaredValue: result.declaredValue }
            : {}),
          ...(typeof result.accessoriesValue === "number"
            ? { accessoriesValue: result.accessoriesValue }
            : {}),
        }),
      );
      setRuns((current) => [
        runFromResponse(response.run, response.output),
        ...current,
      ]);
    } catch (reason) {
      setNotice(errorMessage(reason, "No se pudo consultar la placa."));
    } finally {
      setLookingUpPlate(false);
    }
  };

  const quote = async () => {
    if (quoting || retryingIds.length > 0) return;
    const nextErrors = validateQuote(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      const firstInvalid = quoteSteps.findIndex(
        (step) => Object.keys(validateQuoteStep(values, step.id)).length,
      );
      setActiveStep(firstInvalid < 0 ? 0 : firstInvalid);
      return;
    }
    const selected = products.filter((product) =>
      selectedProducts.includes(product.id),
    );
    if (!selected.length) {
      setNotice("Selecciona al menos un producto.");
      return;
    }
    setQuoting(true);
    setPersistenceNotice("");
    setProductErrors([]);
    setNotice("");
    setQuoteTimings(null);

    const resuming = resumeQuote;
    const ref = resuming?.summary.name ?? generateQuoteReference();
    setQuoteReference(ref);

    // CRM no bloqueante: arranca en paralelo y nunca retrasa los flujos.
    // Se resuelve por consulta filtrada server-side; si no se resuelve
    // pronto, la cotización continúa y el fallo queda visible.
    const setupStart = Date.now();
    const crmStart = Date.now();
    let crmMs: number | undefined;
    const clientPromise = (async () => {
      try {
        const upserted = await upsertQuoteClient(
          savia,
          settings,
          values.applicant,
        );
        crmMs = Date.now() - crmStart;
        return upserted;
      } catch {
        crmMs = Date.now() - crmStart;
        return null;
      }
    })();
    // Timeout de seguridad: si el CRM tarda (escaneo grande), no bloquea.
    const clientTimeout = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), 4000);
    });
    let quoteClientId: string | null = null;
    let crmFailed = false;
    // No esperamos al CRM antes de crear el master: el master se crea de
    // inmediato y el vínculo `cliente` se adjunta cuando el CRM responda.
    const earlyClient = await Promise.race([clientPromise, clientTimeout]);
    if (earlyClient) quoteClientId = earlyClient.id;

    let createdMasterId: string | null = resuming?.summary.id ?? null;
    if (resuming) {
      setMasterQuoteId(createdMasterId);
    }
    if (!resuming) {
      try {
        const cotizaciones = savia.collections?.collection?.("cotizaciones");
        if (cotizaciones?.create) {
          const master = await cotizaciones.create({
            name: ref,
            ramo: "Automóviles",
            placa: values.vehicle.plate || undefined,
            valor_asegurado: values.vehicle.declaredValue
              ? Number(values.vehicle.declaredValue)
              : undefined,
            estado: "Solicitada",
            ...(quoteClientId ? { cliente: quoteClientId } : {}),
          });
          if (master && typeof master === "object" && "id" in master) {
            createdMasterId = String(master.id);
            setMasterQuoteId(createdMasterId);
          }
        }
      } catch {
        // The provider responses remain usable even if CRM persistence fails.
      }
    }
    // The terminal master update also saves a late CRM link. A separate
    // background write would race that update using the same record version.
    if (!createdMasterId) {
      setNotice(
        "No se pudo guardar la cotización en el historial. Puedes consultar las ofertas recibidas en esta pantalla.",
      );
    }

    const details: Record<
      string,
      { id: string; version: number | undefined } | undefined
    > = {};
    if (resuming) {
      for (const product of selected) {
        const saved = resuming.items.find(
          (item) => item.flowId === product.flowId && item.detailId,
        );
        if (saved?.detailId) {
          details[product.id] = {
            id: saved.detailId,
            version: saved.detailVersion,
          };
        }
      }
    }
    try {
      const cotizacionesDetalle = savia.collections?.collection?.(
        "cotizaciones_detalle",
      );
      if (cotizacionesDetalle?.create) {
        await Promise.all(
          selected.map(async (product) => {
            if (details[product.id]) return;
            try {
              const rec = await cotizacionesDetalle.create({
                name: `${ref}-${product.id}`,
                cotizacion: createdMasterId ?? ref,
                aseguradora: product.label.split(" · ")[0] ?? "Seguros",
                producto: product.label,
                flow_id: product.flowId,
                estado: "Solicitada",
              });
              if (rec && typeof rec === "object" && "id" in rec) {
                details[product.id] = {
                  id: String(rec.id),
                  version: recordVersion(rec),
                };
              }
            } catch {
              setPersistenceNotice(
                t(
                  "No se pudo guardar un resultado en el historial. Conserva esta pantalla y vuelve a intentarlo.",
                ),
              );
            }
          }),
        );
      }
    } catch {
      // Non-blocking fallback
    }
    const setupMs = Date.now() - setupStart;
    setQuoteTimings((current) => ({ ...(current ?? {}), setupMs }));

    const initialItems = resumedQuoteItems(
      resuming?.items ?? [],
      selected.map((product) => ({
        productId: product.id,
        flowId: product.flowId,
        label: product.label,
        provider: product.label.split(" · ")[0] ?? "Seguros",
        status: "pending" as const,
        detailId: details[product.id]?.id,
        detailVersion: details[product.id]?.version,
      })),
    );

    historyRequest.current += 1;
    setHistoryLoading(false);
    setBatchItems(initialItems);
    setSelectedHistoryQuoteId(null);
    setResumeQuote(null);
    setSurface("results");

    try {
      const failures: string[] = [];

      const quotePromises = selected.map(async (product) => {
        const detail = details[product.id];
        const detailId = detail?.id;
        let detailVersion = detail?.version;
        const provider = product.label.split(" · ")[0] ?? "Seguros";
        const productStart = Date.now();

        try {
          const response = await savia.actions.execute<{
            type?: unknown;
            provider?: unknown;
            status?: unknown;
            data?: unknown;
          }>("quote", {
            input: {
              mode: "live",
              flowId: product.flowId,
              quoteInput: toAutoLightQuoteInput(values),
            },
          });

          const run = runFromResponse(response.run, response.output);
          const { quoteNumber, premium } = extractQuoteData(response.output);
          const durationMs = Date.now() - productStart;
          setQuoteTimings((current) => ({
            ...(current ?? {}),
            products: {
              ...(current?.products ?? {}),
              [product.id]: durationMs,
            },
          }));

          // Snapshot allowlisted para historial sin depender de runs recientes.
          const provisional: QuoteBatchItem = {
            productId: product.id,
            flowId: product.flowId,
            label: product.label,
            provider,
            status: "succeeded",
            runId: run.runId,
            detailId,
            detailVersion,
            quoteNumber,
            premium,
            durationMs,
          };
          let snapshotText: string | undefined;
          try {
            const unified = toUnifiedComparisonQuote(provisional, run, "es");
            const snapshot = buildResultSnapshot({
              provider: unified.provider,
              productName: unified.productName,
              premium: unified.premium > 0 ? unified.premium : (premium ?? 0),
              quoteNumber: unified.quoteNumber ?? quoteNumber,
              monthlyInstallment: unified.monthlyInstallment,
              score: unified.score,
              badges: unified.badges,
              coverages: unified.coverages,
              highlights: unified.highlights,
            });
            if (snapshot) {
              provisional.snapshot = snapshot;
              snapshotText = serializeSnapshot(snapshot);
            }
          } catch {
            // Snapshot accesorio: no bloquea la cotización.
          }

          if (detailId && detailVersion !== undefined) {
            try {
              const updated = await persistDetail(
                detailId,
                {
                  estado: "Recibida",
                  numero_cotizacion: quoteNumber,
                  prima: premium,
                  run_id: run.runId,
                  error_mensaje: undefined,
                  ...(snapshotText ? { resultado_snapshot: snapshotText } : {}),
                  duracion_ms: durationMs,
                },
                { version: detailVersion },
              );
              detailVersion = recordVersion(updated) ?? detailVersion + 1;
              provisional.detailVersion = detailVersion;
            } catch {}
          }

          const updatedItem: QuoteBatchItem = provisional;

          setRuns((current) => [run, ...current]);
          setBatchItems((current) =>
            current.map((item) =>
              item.productId === product.id ? updatedItem : item,
            ),
          );

          // Commit the partial summary before waiting for other providers.
          if (createdMasterId) {
            try {
              await persistQuoteSummary(masterCollection, createdMasterId, () =>
                quoteSummaryPatch(batchItemsRef.current),
              );
            } catch {
              setPersistenceNotice(t(
                "No se pudo guardar un resultado en el historial. Conserva esta pantalla y vuelve a intentarlo.",
              ));
            }
          }

          return { status: "fulfilled" as const, product, item: updatedItem };
        } catch (reason) {
          const err = errorMessage(
            reason,
            "El conector no pudo completar la acción.",
          );
          failures.push(`${product.label}: ${err}`);
          setProductErrors((current) => [
            ...current,
            `${product.label}: ${err}`,
          ]);
          const durationMs = Date.now() - productStart;
          setQuoteTimings((current) => ({
            ...(current ?? {}),
            products: {
              ...(current?.products ?? {}),
              [product.id]: durationMs,
            },
          }));

          if (detailId && detailVersion !== undefined) {
            try {
              const updated = await persistDetail(
                detailId,
                {
                  estado: "Error",
                  error_mensaje: err,
                  duracion_ms: durationMs,
                },
                { version: detailVersion },
              );
              detailVersion = recordVersion(updated) ?? detailVersion + 1;
            } catch {}
          }

          const updatedItem: QuoteBatchItem = {
            productId: product.id,
            flowId: product.flowId,
            label: product.label,
            provider,
            status: "failed",
            error: err,
            detailId,
            detailVersion,
            durationMs,
          };

          setBatchItems((current) =>
            current.map((item) =>
              item.productId === product.id ? updatedItem : item,
            ),
          );

          return { status: "rejected" as const, product, error: err };
        }
      });

      await Promise.allSettled(quotePromises);

      // CRM: registra el tiempo real aunque haya respondido tarde; si falló,
      // queda visible sin haber bloqueado los flujos.
      try {
        const settled = await Promise.race([
          clientPromise.then((value) => ({ value })),
          new Promise<{ value: null }>((resolve) => {
            setTimeout(() => resolve({ value: null }), 2000);
          }),
        ]);
        if (crmMs === undefined) crmMs = Date.now() - crmStart;
        setQuoteTimings((current) => ({ ...(current ?? {}), crmMs }));
        if (!settled.value) {
          crmFailed = true;
        } else if (settled.value) {
          quoteClientId = settled.value.id;
        }
      } catch {
        crmFailed = true;
        if (crmMs === undefined) {
          const measured = Date.now() - crmStart;
          setQuoteTimings((current) => ({
            ...(current ?? {}),
            crmMs: measured,
          }));
        }
      }
      if (crmFailed && createdMasterId) {
        setNotice(
          t(
            "La cotización continuó sin guardar el cliente en el CRM. Revisa la colección de clientes.",
          ),
        );
      }
      if (createdMasterId) {
        try {
          await persistQuoteSummary(masterCollection, createdMasterId, () => ({
            ...quoteSummaryPatch(batchItemsRef.current),
            ...(quoteClientId ? { cliente: quoteClientId } : {}),
          }));
          void refreshHistoricalQuotes();
        } catch {
          setPersistenceNotice(
            t(
              "No se pudo guardar un resultado en el historial. Conserva esta pantalla y vuelve a intentarlo.",
            ),
          );
        }
      }

      void refreshRuns();
    } finally {
      setQuoting(false);
    }
  };

  const retrySingle = async (productId: string) => {
    const item = batchItems.find((b) => b.productId === productId);
    if (!item || retryingIds.includes(productId)) return;
    let detailVersion = item.detailVersion;
    setRetryingIds((current) => [...current, productId]);
    setBatchItems((current) =>
      current.map((b) =>
        b.productId === productId
          ? { ...b, status: "pending", error: undefined }
          : b,
      ),
    );

    if (item.detailId && detailVersion !== undefined) {
      try {
        const updated = await persistDetail(
          item.detailId,
          {
            estado: "Solicitada",
            error_mensaje: undefined,
          },
          { version: detailVersion },
        );
        detailVersion = recordVersion(updated) ?? detailVersion + 1;
      } catch {}
    }

    const retryStart = Date.now();
    try {
      const response = await savia.actions.execute<{
        type?: unknown;
        provider?: unknown;
        status?: unknown;
        data?: unknown;
      }>("quote", {
        input: {
          mode: "live",
          flowId: item.flowId,
          quoteInput: toAutoLightQuoteInput(values),
        },
      });
      const newRun = runFromResponse(response.run, response.output);
      const { quoteNumber, premium } = extractQuoteData(response.output);
      const durationMs = Date.now() - retryStart;

      let snapshotText: string | undefined;
      let snapshot: QuoteBatchItem["snapshot"];
      try {
        const provisional: QuoteBatchItem = {
          ...item,
          status: "succeeded",
          runId: newRun.runId,
          quoteNumber,
          premium,
          durationMs,
        };
        const unified = toUnifiedComparisonQuote(provisional, newRun, "es");
        const built = buildResultSnapshot({
          provider: unified.provider,
          productName: unified.productName,
          premium: unified.premium > 0 ? unified.premium : (premium ?? 0),
          quoteNumber: unified.quoteNumber ?? quoteNumber,
          monthlyInstallment: unified.monthlyInstallment,
          score: unified.score,
          badges: unified.badges,
          coverages: unified.coverages,
          highlights: unified.highlights,
        });
        if (built) {
          snapshot = built;
          snapshotText = serializeSnapshot(built);
        }
      } catch {
        // Snapshot accesorio.
      }

      if (item.detailId && detailVersion !== undefined) {
        try {
          const updated = await persistDetail(
            item.detailId,
            {
              estado: "Recibida",
              numero_cotizacion: quoteNumber,
              prima: premium,
              run_id: newRun.runId,
              error_mensaje: undefined,
              ...(snapshotText ? { resultado_snapshot: snapshotText } : {}),
              duracion_ms: durationMs,
            },
            { version: detailVersion },
          );
          detailVersion = recordVersion(updated) ?? detailVersion + 1;
        } catch {}
      }

      setRuns((current) => [newRun, ...current]);
      setBatchItems((current) =>
        current.map((b) =>
          b.productId === productId
            ? {
                ...b,
                status: "succeeded",
                runId: newRun.runId,
                detailVersion,
                quoteNumber,
                premium,
                error: undefined,
                durationMs,
                ...(snapshot ? { snapshot } : {}),
              }
            : b,
        ),
      );

      if (masterQuoteId) {
        try {
          await persistQuoteSummary(masterCollection, masterQuoteId, () =>
            quoteSummaryPatch(batchItemsRef.current),
          );
          void refreshHistoricalQuotes();
        } catch {
          setPersistenceNotice(
            t(
              "No se pudo guardar un resultado en el historial. Conserva esta pantalla y vuelve a intentarlo.",
            ),
          );
        }
      }

      void refreshRuns();
    } catch (reason) {
      const err = errorMessage(
        reason,
        "El conector no pudo completar la acción.",
      );
      const durationMs = Date.now() - retryStart;
      if (item.detailId && detailVersion !== undefined) {
        try {
          const updated = await persistDetail(
            item.detailId,
            {
              estado: "Error",
              error_mensaje: err,
              duracion_ms: durationMs,
            },
            { version: detailVersion },
          );
          detailVersion = recordVersion(updated) ?? detailVersion + 1;
        } catch {}
      }
      setBatchItems((current) =>
        current.map((b) =>
          b.productId === productId
            ? { ...b, status: "failed", error: err, detailVersion, durationMs }
            : b,
        ),
      );
    } finally {
      setRetryingIds((current) => current.filter((id) => id !== productId));
    }
  };

  const retryAllFailed = async () => {
    const failed = batchItems.filter((b) => b.status === "failed");
    if (!failed.length || retryingIds.length > 0) return;
    const failedIds = failed.map((b) => b.productId);
    setRetryingIds(failedIds);
    setBatchItems((current) =>
      current.map((b) =>
        failedIds.includes(b.productId)
          ? { ...b, status: "pending", error: undefined }
          : b,
      ),
    );

    const resetDetailVersions = new Map<string, number | undefined>();
    await Promise.all(
      failed.map(async (item) => {
        if (!item.detailId || item.detailVersion === undefined) return;
        try {
          const updated = await persistDetail(
            item.detailId,
            {
              estado: "Solicitada",
              error_mensaje: undefined,
            },
            { version: item.detailVersion },
          );
          resetDetailVersions.set(
            item.productId,
            recordVersion(updated) ?? item.detailVersion + 1,
          );
        } catch {}
      }),
    );

    try {
      const retryPromises = failed.map(async (item) => {
        let detailVersion =
          resetDetailVersions.get(item.productId) ?? item.detailVersion;
        const retryStart = Date.now();
        try {
          const res = await savia.actions.execute<{
            type?: unknown;
            provider?: unknown;
            status?: unknown;
            data?: unknown;
          }>("quote", {
            input: {
              mode: "live",
              flowId: item.flowId,
              quoteInput: toAutoLightQuoteInput(values),
            },
          });
          const newRun = runFromResponse(res.run, res.output);
          const { quoteNumber, premium } = extractQuoteData(res.output);
          const durationMs = Date.now() - retryStart;

          let snapshotText: string | undefined;
          let snapshot: QuoteBatchItem["snapshot"];
          try {
            const provisional: QuoteBatchItem = {
              ...item,
              status: "succeeded",
              runId: newRun.runId,
              quoteNumber,
              premium,
              durationMs,
            };
            const unified = toUnifiedComparisonQuote(provisional, newRun, "es");
            const built = buildResultSnapshot({
              provider: unified.provider,
              productName: unified.productName,
              premium: unified.premium > 0 ? unified.premium : (premium ?? 0),
              quoteNumber: unified.quoteNumber ?? quoteNumber,
              monthlyInstallment: unified.monthlyInstallment,
              score: unified.score,
              badges: unified.badges,
              coverages: unified.coverages,
              highlights: unified.highlights,
            });
            if (built) {
              snapshot = built;
              snapshotText = serializeSnapshot(built);
            }
          } catch {
            // Snapshot accesorio.
          }

          if (item.detailId && detailVersion !== undefined) {
            try {
              const updated = await persistDetail(
                item.detailId,
                {
                  estado: "Recibida",
                  numero_cotizacion: quoteNumber,
                  prima: premium,
                  run_id: newRun.runId,
                  error_mensaje: undefined,
                  ...(snapshotText ? { resultado_snapshot: snapshotText } : {}),
                  duracion_ms: durationMs,
                },
                { version: detailVersion },
              );
              detailVersion = recordVersion(updated) ?? detailVersion + 1;
            } catch {}
          }

          const updatedItem: QuoteBatchItem = {
            ...item,
            status: "succeeded",
            runId: newRun.runId,
            detailVersion,
            quoteNumber,
            premium,
            error: undefined,
            durationMs,
            ...(snapshot ? { snapshot } : {}),
          };

          setRuns((current) => [newRun, ...current]);
          setBatchItems((current) =>
            current.map((b) =>
              b.productId === item.productId ? updatedItem : b,
            ),
          );
          return updatedItem;
        } catch (reason) {
          const err = errorMessage(
            reason,
            "El conector no pudo completar la acción.",
          );
          const durationMs = Date.now() - retryStart;
          if (item.detailId && detailVersion !== undefined) {
            try {
              const updated = await persistDetail(
                item.detailId,
                {
                  estado: "Error",
                  error_mensaje: err,
                  duracion_ms: durationMs,
                },
                { version: detailVersion },
              );
              detailVersion = recordVersion(updated) ?? detailVersion + 1;
            } catch {}
          }
          const updatedItem: QuoteBatchItem = {
            ...item,
            status: "failed",
            error: err,
            detailVersion,
            durationMs,
          };
          setBatchItems((current) =>
            current.map((b) =>
              b.productId === item.productId ? updatedItem : b,
            ),
          );
          return updatedItem;
        }
      });

      await Promise.allSettled(retryPromises);

      if (masterQuoteId) {
        try {
          await persistQuoteSummary(masterCollection, masterQuoteId, () =>
            quoteSummaryPatch(batchItemsRef.current),
          );
          void refreshHistoricalQuotes();
        } catch {
          setPersistenceNotice(
            t(
              "No se pudo guardar un resultado en el historial. Conserva esta pantalla y vuelve a intentarlo.",
            ),
          );
        }
      }

      void refreshRuns();
    } finally {
      setRetryingIds([]);
    }
  };

  const activeQuoteItems = useMemo(() => {
    if (selectedHistoryQuoteId) {
      return historicalBatchItems ?? [];
    }
    if (masterQuoteId || batchItems.length > 0) {
      return batchItems;
    }
    return [];
  }, [selectedHistoryQuoteId, historicalBatchItems, masterQuoteId, batchItems]);

  const activeQuoteOffersCount = useMemo(
    () => activeQuoteItems.filter((item) => item.status === "succeeded").length,
    [activeQuoteItems],
  );

  if (!pageEnabled)
    return (
      <main
        className="insurance-quote"
        aria-label={
          entry === "direct" ? t("Cotizador") : t("Cotizador por pasos")
        }
      >
        <p className="insurance-quote__empty">
          {t("Esta pantalla está desactivada para este tenant.")}{" "}
        </p>
      </main>
    );

  return (
    <main
      className="insurance-quote"
      aria-label={
        entry === "direct" ? t("Cotizador") : t("Cotizador por pasos")
      }
      data-testid="insurance-quote-screen"
    >
      <header className="insurance-quote__header">
        <div className="insurance-quote__title-wrap">
          <p className="insurance-quote__eyebrow">
            {t("Seguros · Autos livianos")}
          </p>
          <div className="insurance-quote__heading">
            <h1>
              {entry === "direct" ? t("Cotizador") : t("Cotizador por pasos")}
            </h1>
            <span className="insurance-quote__info">
              <button
                aria-describedby="insurance-quote-description"
                aria-label={t("Información sobre el cotizador")}
                className="insurance-quote__info-trigger"
                type="button"
              >
                <svg
                  aria-hidden="true"
                  fill="none"
                  height="14"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  width="14"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 10v6" />
                  <path d="M12 7h.01" />
                </svg>
              </button>
              <span
                className="insurance-quote__tooltip"
                id="insurance-quote-description"
                role="tooltip"
              >
                {t(
                  "Vehículo, tomador y comparador en un solo flujo en línea.",
                )}{" "}
              </span>
            </span>
          </div>
        </div>
      </header>
      <nav aria-label={t("Vista del cotizador")} className="insurance-tabs">
        <button
          aria-pressed={surface === "form"}
          className={surface === "form" ? "is-selected" : ""}
          onClick={() => setSurface("form")}
          type="button"
        >
          <span className="insurance-tabs__label">
            {t("Preparar cotización")}
          </span>
        </button>
        <button
          aria-pressed={surface === "results"}
          className={surface === "results" ? "is-selected" : ""}
          onClick={() => {
            void handleSelectHistoryQuote(null);
            setSurface("results");
          }}
          type="button"
        >
          <span className="insurance-tabs__label">
            {t("Cotizaciones")}{" "}
            {activeQuoteOffersCount > 0 ? (
              <span aria-hidden="true" className="insurance-tabs__count">
                {activeQuoteOffersCount}
              </span>
            ) : null}
          </span>
        </button>
        <button
          aria-pressed={surface === "history"}
          className={surface === "history" ? "is-selected" : ""}
          onClick={() => setSurface("history")}
          type="button"
        >
          <span className="insurance-tabs__label">
            {t("Historial")}{" "}
            {historyQuotes.length > 0 ? (
              <span
                aria-hidden="true"
                className="insurance-tabs__count insurance-tabs__count--muted"
              >
                {historyQuotes.length}
              </span>
            ) : null}
          </span>
        </button>
      </nav>
      {persistenceNotice && surface !== "form" && !selectedHistoryQuoteId ? (
        <p className="insurance-quote__notice" role="alert">
          {persistenceNotice}
        </p>
      ) : null}
      {notice && surface !== "form" ? (
        <p className="insurance-quote__notice" role="status">
          {<InsuranceNotice message={notice} />}
        </p>
      ) : null}
      {surface === "results" || surface === "history" ? (
        <QuoteResults
          batchItems={activeQuoteItems}
          hasSelectedQuote={Boolean(
            selectedHistoryQuoteId || masterQuoteId || batchItems.length > 0,
          )}
          historyQuotes={historyQuotes}
          loading={loadingRuns}
          masterQuoteId={
            selectedHistoryQuoteId
              ? selectedHistoryQuoteId
              : (masterQuoteId ?? undefined)
          }
          onGoToForm={() => {
            setResumeQuote(null);
            setSurface("form");
            setActiveStep(0);
          }}
          onResumeHistoryQuote={
            selectedHistoryQuoteId && historicalBatchItems
              ? () => {
                  const summary = historyQuotes.find(
                    (item) => item.id === selectedHistoryQuoteId,
                  );
                  if (!summary) return;
                  setResumeQuote({
                    summary,
                    items: historicalBatchItems,
                  });
                  setSelectedProducts(
                    products
                      .filter((product) =>
                        historicalBatchItems.some(
                          (item) =>
                            item.flowId === product.flowId &&
                            item.status !== "succeeded",
                        ),
                      )
                      .map((product) => product.id),
                  );
                  setValues((current) => ({
                    ...current,
                    vehicle: {
                      ...current.vehicle,
                      plate: summary.placa ?? "",
                      declaredValue:
                        summary.valor_asegurado === undefined
                          ? ""
                          : String(summary.valor_asegurado),
                    },
                  }));
                  setSelectedHistoryQuoteId(null);
                  setSurface("form");
                  setActiveStep(0);
                  setNotice(
                    "Completa los datos faltantes para reintentar la cotización guardada.",
                  );
                }
              : undefined
          }
          onRetryAll={selectedHistoryQuoteId ? undefined : retryAllFailed}
          onRetrySingle={selectedHistoryQuoteId ? undefined : retrySingle}
          onSelectHistoryQuote={handleSelectHistoryQuote}
          onDeleteHistoryQuote={handleDeleteHistoryQuote}
          deletingHistory={
            deletingHistory ||
            (busy && selectedHistoryQuoteId === masterQuoteId)
          }
          historyLoading={historyLoading}
          historyError={historyError}
          timings={quoteTimings}
          productErrors={productErrors}
          quoteReference={
            selectedHistoryQuoteId
              ? (historyQuotes.find((q) => q.id === selectedHistoryQuoteId)
                  ?.name ?? selectedHistoryQuoteId)
              : (quoteReference ?? undefined)
          }
          retryingIds={retryingIds}
          runs={runs}
          selectedHistoryQuoteId={selectedHistoryQuoteId}
          showHistorySelector={surface === "history"}
          vehicleInfo={
            selectedHistoryQuoteId || masterQuoteId
              ? {
                  plate:
                    (selectedHistoryQuoteId
                      ? historyQuotes.find(
                          (q) => q.id === selectedHistoryQuoteId,
                        )?.placa
                      : values.vehicle.plate) || values.vehicle.plate,
                  declaredValue:
                    (selectedHistoryQuoteId
                      ? historyQuotes.find(
                          (q) => q.id === selectedHistoryQuoteId,
                        )?.valor_asegurado
                      : Number(values.vehicle.declaredValue)) || undefined,
                  productionYear:
                    Number(values.vehicle.productionYear) || undefined,
                  fasecoldaCode: values.vehicle.fasecoldaCode,
                }
              : undefined
          }
        />
      ) : null}
      {surface === "form" ? (
        <section
          className="insurance-quote__capture"
          aria-label={t("Datos de cotización")}
        >
          <details className="insurance-products">
            <summary>
              <span>{t("Cotizar con")}</span>
              <strong>
                {selectedProducts.length}{" "}
                {selectedProducts.length === 1 ? t("producto") : t("productos")}
              </strong>
            </summary>
            <fieldset disabled={busy}>
              <legend>{t("Productos para cotizar")}</legend>
              {products.map((product) => (
                <label key={product.id}>
                  <input
                    checked={selectedProducts.includes(product.id)}
                    onChange={(event) =>
                      setSelectedProducts((current) =>
                        event.target.checked
                          ? [...current, product.id]
                          : current.filter((id) => id !== product.id),
                      )
                    }
                    type="checkbox"
                  />
                  {product.label}
                </label>
              ))}
            </fieldset>
          </details>
          <nav
            aria-label={t("Pasos del formulario")}
            className="insurance-steps"
          >
            <ol>
              {quoteSteps.map((step, index) => {
                const isCurrent = index === activeStep;
                const isComplete = index < activeStep;
                return (
                  <li
                    aria-current={isCurrent ? "step" : undefined}
                    className={`${isCurrent ? "is-current" : ""} ${isComplete ? "is-complete" : ""}`.trim()}
                    key={step.id}
                  >
                    <span>{isComplete ? "✓" : index + 1}</span>
                    {t(step.title)}
                  </li>
                );
              })}
            </ol>
          </nav>
          <h2>
            {t("Paso")} {activeStep + 1} {t("de")} {quoteSteps.length}:{" "}
            {t(currentStep.title)}
          </h2>
          <fieldset
            className="insurance-quote__step-fields"
            disabled={quoting || retryingIds.length > 0}
          >
            {activeStep === 0 ? (
              <div className="insurance-fields">
                <QuoteField error={errors["vehicle.plate"]} label={t("Placa")}>
                  <div className="insurance-input-with-action">
                    <input
                      aria-label={t("Placa")}
                      className="insurance-input--plate"
                      onBlur={() => {
                        const plate = values.vehicle.plate?.trim();
                        if (
                          plate &&
                          plate.length >= 5 &&
                          plate !== lastLookedUpPlate &&
                          !lookingUpPlate &&
                          !busy
                        ) {
                          void lookup();
                        }
                      }}
                      onChange={(event) =>
                        update(
                          "vehicle.plate",
                          event.target.value.toUpperCase(),
                        )
                      }
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" &&
                          !busy &&
                          values.vehicle.plate
                        ) {
                          event.preventDefault();
                          void lookup();
                        }
                      }}
                      placeholder={t("Ej. TESTCAR")}
                      value={values.vehicle.plate}
                    />
                    <button
                      aria-label={t("Consultar placa")}
                      className="insurance-input-action-button"
                      disabled={busy || !values.vehicle.plate}
                      onClick={() => void lookup()}
                      title={t("Consultar placa")}
                      type="button"
                    >
                      {lookingUpPlate ? (
                        <span
                          aria-hidden="true"
                          className="insurance-spinner insurance-spinner--sm"
                        />
                      ) : (
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
                          <circle cx="11" cy="11" r="8" />
                          <line x1="21" x2="16.65" y1="21" y2="16.65" />
                        </svg>
                      )}
                    </button>
                  </div>
                </QuoteField>
                <QuoteField
                  badge={
                    lookingUpPlate ? (
                      <span className="insurance-field-syncing">
                        <span
                          aria-hidden="true"
                          className="insurance-spinner insurance-spinner--xs"
                        />{" "}
                        {t("Consultando…")}{" "}
                      </span>
                    ) : values.vehicle.lookupFields.includes(
                        "fasecoldaCode",
                      ) ? (
                      <span className="insurance-field-synced">
                        {t("✓ Autocompletado")}{" "}
                      </span>
                    ) : undefined
                  }
                  error={errors["vehicle.fasecoldaCode"]}
                  label={t("Código Fasecolda")}
                >
                  <input
                    aria-label={t("Código Fasecolda")}
                    disabled={lookingUpPlate}
                    onChange={(event) =>
                      update("vehicle.fasecoldaCode", event.target.value)
                    }
                    placeholder={
                      lookingUpPlate
                        ? t("Consultando Fasecolda…")
                        : t("Ej. 123456")
                    }
                    value={values.vehicle.fasecoldaCode}
                  />
                </QuoteField>
                <QuoteField
                  badge={
                    lookingUpPlate ? (
                      <span className="insurance-field-syncing">
                        <span
                          aria-hidden="true"
                          className="insurance-spinner insurance-spinner--xs"
                        />{" "}
                        {t("Consultando…")}{" "}
                      </span>
                    ) : values.vehicle.lookupFields.includes(
                        "productionYear",
                      ) ? (
                      <span className="insurance-field-synced">
                        {t("✓ Autocompletado")}{" "}
                      </span>
                    ) : undefined
                  }
                  error={errors["vehicle.productionYear"]}
                  label={t("Año del vehículo")}
                >
                  <input
                    aria-label={t("Año del vehículo")}
                    disabled={lookingUpPlate}
                    onChange={(event) =>
                      update("vehicle.productionYear", event.target.value)
                    }
                    placeholder={
                      lookingUpPlate ? t("Consultando…") : t("Ej. 2024")
                    }
                    type="number"
                    value={values.vehicle.productionYear}
                  />
                </QuoteField>
                <QuoteField label={t("Vehículo nuevo")}>
                  <select
                    onChange={(event) =>
                      update("vehicle.isNew", event.target.value === "true")
                    }
                    value={String(values.vehicle.isNew)}
                  >
                    <option value="false">{t("No")}</option>
                    <option value="true">{t("Sí")}</option>
                  </select>
                </QuoteField>
                <CitySelectorField
                  error={errors["vehicle.circulationCity"]}
                  label={
                    <span>
                      {t("Ciudad de circulación")}{" "}
                      <span className="insurance-city-dane-hint">(DANE)</span>
                    </span>
                  }
                  onChange={(code) => update("vehicle.circulationCity", code)}
                  placeholder={t(
                    "Buscar ciudad (ej. Bogotá, Medellín, Cali)...",
                  )}
                  testLabel="Código de ciudad de circulación"
                  value={values.vehicle.circulationCity}
                />
                <QuoteField
                  badge={
                    lookingUpPlate ? (
                      <span className="insurance-field-syncing">
                        <span
                          aria-hidden="true"
                          className="insurance-spinner insurance-spinner--xs"
                        />{" "}
                        {t("Consultando…")}{" "}
                      </span>
                    ) : values.vehicle.lookupFields.includes(
                        "accessoriesValue",
                      ) ? (
                      <span className="insurance-field-synced">
                        {t("✓ Autocompletado")}{" "}
                      </span>
                    ) : undefined
                  }
                  error={errors["vehicle.accessoriesValue"]}
                  label={t("Valor de accesorios")}
                >
                  <div className="insurance-currency-wrap">
                    <span className="insurance-currency-prefix">$</span>
                    <input
                      aria-label={t("Valor de accesorios")}
                      className="insurance-input--currency"
                      disabled={lookingUpPlate}
                      onBlur={() => setAccessoriesValueFocused(false)}
                      onChange={(event) => {
                        const raw = event.target.value.replace(/\D/g, "");
                        update("vehicle.accessoriesValue", raw);
                      }}
                      onFocus={() => setAccessoriesValueFocused(true)}
                      placeholder="0"
                      type="text"
                      value={
                        accessoriesValueFocused
                          ? values.vehicle.accessoriesValue
                          : formatCurrencyNumber(
                              values.vehicle.accessoriesValue,
                              locale,
                            )
                      }
                    />
                    <span className="insurance-currency-suffix">COP</span>
                  </div>
                </QuoteField>
                <QuoteField
                  badge={
                    lookingUpPlate ? (
                      <span className="insurance-field-syncing">
                        <span
                          aria-hidden="true"
                          className="insurance-spinner insurance-spinner--xs"
                        />{" "}
                        {t("Consultando…")}{" "}
                      </span>
                    ) : values.vehicle.lookupFields.includes(
                        "declaredValue",
                      ) ? (
                      <span className="insurance-field-synced">
                        {t("✓ Autocompletado")}{" "}
                      </span>
                    ) : undefined
                  }
                  error={errors["vehicle.declaredValue"]}
                  label={t("Valor asegurado")}
                >
                  <div className="insurance-currency-wrap">
                    <span className="insurance-currency-prefix">$</span>
                    <input
                      aria-label={t("Valor asegurado")}
                      className="insurance-input--currency"
                      disabled={lookingUpPlate}
                      onBlur={() => setDeclaredValueFocused(false)}
                      onChange={(event) => {
                        const raw = event.target.value.replace(/\D/g, "");
                        update("vehicle.declaredValue", raw);
                      }}
                      onFocus={() => setDeclaredValueFocused(true)}
                      placeholder={
                        lookingUpPlate ? t("Consultando…") : t("Ej. 50000000")
                      }
                      type="text"
                      value={
                        declaredValueFocused
                          ? values.vehicle.declaredValue
                          : formatCurrencyNumber(
                              values.vehicle.declaredValue,
                              locale,
                            )
                      }
                    />
                    <span className="insurance-currency-suffix">COP</span>
                  </div>
                </QuoteField>
              </div>
            ) : null}
            {activeStep === 1 ? (
              <div className="insurance-fields">
                <QuoteField label={t("Tipo de documento")}>
                  <select
                    onChange={(event) =>
                      update("applicant.documentType", event.target.value)
                    }
                    value={values.applicant.documentType}
                  >
                    <option value="CC">{t("Cédula de ciudadanía")}</option>
                    <option value="CE">{t("Cédula de extranjería")}</option>
                  </select>
                </QuoteField>
                <QuoteField
                  error={errors["applicant.documentNumber"]}
                  label={t("Número de documento")}
                >
                  <input
                    onChange={(event) =>
                      update("applicant.documentNumber", event.target.value)
                    }
                    placeholder={t("Ej. 12345678")}
                    value={values.applicant.documentNumber}
                  />
                </QuoteField>
                <QuoteField
                  error={errors["applicant.firstName"]}
                  label={t("Nombres")}
                >
                  <input
                    onChange={(event) =>
                      update("applicant.firstName", event.target.value)
                    }
                    placeholder={t("Ej. Ana")}
                    value={values.applicant.firstName}
                  />
                </QuoteField>
                <QuoteField
                  error={errors["applicant.surname"]}
                  label={t("Primer apellido")}
                >
                  <input
                    onChange={(event) =>
                      update("applicant.surname", event.target.value)
                    }
                    placeholder={t("Ej. Pérez")}
                    value={values.applicant.surname}
                  />
                </QuoteField>
                <QuoteField label={t("Segundo apellido")}>
                  <input
                    onChange={(event) =>
                      update("applicant.secondSurname", event.target.value)
                    }
                    placeholder={t("Opcional")}
                    value={values.applicant.secondSurname}
                  />
                </QuoteField>
                <QuoteField
                  error={errors["applicant.gender"]}
                  label={t("Sexo")}
                >
                  <select
                    onChange={(event) =>
                      update("applicant.gender", event.target.value)
                    }
                    value={values.applicant.gender}
                  >
                    <option value="F">{t("Femenino")}</option>
                    <option value="M">{t("Masculino")}</option>
                  </select>
                </QuoteField>
                <div className="insurance-field-group--birth-age">
                  <QuoteField
                    error={errors["applicant.birthDate"]}
                    label={t("Fecha de nacimiento")}
                  >
                    <input
                      aria-label={t("Fecha de nacimiento")}
                      max={new Date(Date.now() - 16 * 365.25 * 24 * 3600 * 1000)
                        .toISOString()
                        .slice(0, 10)}
                      onChange={(event) =>
                        update("applicant.birthDate", event.target.value)
                      }
                      type="date"
                      value={values.applicant.birthDate}
                    />
                  </QuoteField>
                  <div className="insurance-age-selector">
                    <span className="insurance-age-selector__label">
                      {t("Edad:")}{" "}
                      <strong>
                        {calculateAge(values.applicant.birthDate) !== null
                          ? t("%{p0} años", {
                              p0:
                                calculateAge(values.applicant.birthDate) ?? "",
                            })
                          : t("Seleccionar")}
                      </strong>
                    </span>
                    <div className="insurance-age-quick-chips">
                      {[20, 25, 30, 35, 45, 55, 65].map((agePreset) => (
                        <button
                          className={`insurance-age-chip ${
                            calculateAge(values.applicant.birthDate) ===
                            agePreset
                              ? "is-selected"
                              : ""
                          }`}
                          key={agePreset}
                          onClick={() =>
                            update(
                              "applicant.birthDate",
                              birthDateFromAge(agePreset),
                            )
                          }
                          type="button"
                        >
                          {agePreset}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
            {activeStep === 2 ? (
              <div className="insurance-fields">
                <CitySelectorField
                  error={errors["applicant.city"]}
                  label={
                    <span>
                      {t("Ciudad de residencia")}{" "}
                      <span className="insurance-city-dane-hint">(DANE)</span>
                    </span>
                  }
                  onChange={(code) => update("applicant.city", code)}
                  placeholder={t(
                    "Buscar ciudad (ej. Bogotá, Medellín, Cali)...",
                  )}
                  testLabel="Código de ciudad de residencia"
                  value={values.applicant.city}
                />
                <QuoteField
                  error={errors["applicant.address"]}
                  label={t("Dirección")}
                >
                  <div className="insurance-address-autocomplete-wrap">
                    <input
                      aria-autocomplete="list"
                      aria-label={t("Dirección")}
                      onBlur={() =>
                        setTimeout(() => setShowAddressDropdown(false), 250)
                      }
                      onChange={(event) => {
                        update("applicant.address", event.target.value);
                        setShowAddressDropdown(true);
                      }}
                      onFocus={() => {
                        if (addressSuggestions.length > 0)
                          setShowAddressDropdown(true);
                      }}
                      placeholder={t("Ej. Calle 1 # 2-3")}
                      value={values.applicant.address}
                    />
                    {loadingAddress ? (
                      <span
                        className="insurance-address-loading-spinner"
                        aria-hidden="true"
                      >
                        <span className="insurance-spinner insurance-spinner--xs" />
                      </span>
                    ) : null}
                    {showAddressDropdown && addressSuggestions.length > 0 ? (
                      <ul className="insurance-address-dropdown" role="listbox">
                        {addressSuggestions.map((item, idx) => (
                          <li key={idx} role="presentation">
                            <button
                              className="insurance-address-dropdown__item"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                update(
                                  "applicant.address",
                                  item.value || item.label,
                                );
                                setShowAddressDropdown(false);
                              }}
                              type="button"
                            >
                              <span
                                className="insurance-address-pin"
                                aria-hidden="true"
                              >
                                📍
                              </span>
                              <span>{item.label}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </QuoteField>
                <QuoteField
                  error={errors["applicant.phone"]}
                  label={t("Teléfono")}
                >
                  <input
                    onChange={(event) =>
                      update("applicant.phone", event.target.value)
                    }
                    placeholder={t("Ej. 3001234567")}
                    type="tel"
                    value={values.applicant.phone}
                  />
                </QuoteField>
                <QuoteField
                  error={errors["applicant.email"]}
                  label={t("Correo electrónico")}
                >
                  <input
                    aria-label={t("Correo electrónico")}
                    onBlur={() => {
                      if (values.applicant.email) {
                        const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
                          values.applicant.email,
                        );
                        setErrors((current) => ({
                          ...current,
                          "applicant.email": isValid
                            ? undefined
                            : t(
                                "Ingresa un correo válido (ej. nombre@correo.com)",
                              ),
                        }));
                      }
                    }}
                    onChange={(event) => {
                      const email = event.target.value;
                      update("applicant.email", email);
                      if (email.length > 5) {
                        const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
                          email,
                        );
                        if (isValid) {
                          setErrors((current) => ({
                            ...current,
                            "applicant.email": undefined,
                          }));
                        }
                      }
                    }}
                    placeholder={t("ejemplo@correo.com")}
                    type="email"
                    value={values.applicant.email}
                  />
                </QuoteField>
              </div>
            ) : null}
          </fieldset>
          {notice ? (
            <p className="insurance-quote__notice" role="status">
              {<InsuranceNotice message={notice} />}
            </p>
          ) : null}
          {quoting ? (
            <div
              aria-live="polite"
              className="insurance-busy-indicator"
              role="status"
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
                    {t("Cotizando con")} {selectedProducts.length}{" "}
                    {selectedProducts.length === 1
                      ? "aseguradora"
                      : "aseguradoras"}{" "}
                    {t("en vivo…")}{" "}
                  </strong>
                  <span className="insurance-busy-indicator__subtitle">
                    {t(
                      "Consultando tarifas y coberturas oficiales. Esto puede tomar unos segundos.",
                    )}{" "}
                  </span>
                </div>
              </div>
              <div aria-hidden="true" className="insurance-progress-track">
                <div className="insurance-progress-bar--indeterminate" />
              </div>
            </div>
          ) : null}
          <footer className="insurance-quote__actions">
            <button
              disabled={activeStep === 0 || busy}
              onClick={() =>
                setActiveStep((current) => Math.max(0, current - 1))
              }
              title={t("Volver al paso anterior sin perder los datos")}
              type="button"
            >
              {t("Anterior")}{" "}
            </button>
            {activeStep < quoteSteps.length - 1 ? (
              <button
                disabled={busy || Object.keys(currentErrors).length > 0}
                onClick={next}
                title={
                  Object.keys(currentErrors).length > 0
                    ? t("Completa los campos requeridos para continuar")
                    : t("Continuar al paso %{p0} de %{p1}", {
                        p0: activeStep + 2,
                        p1: quoteSteps.length,
                      })
                }
                type="button"
              >
                {t("Siguiente paso")}{" "}
              </button>
            ) : (
              <button
                className={quoting ? "is-busy" : ""}
                disabled={busy}
                onClick={() => void quote()}
                title={
                  quoting
                    ? t("Consultando aseguradoras en vivo…")
                    : t(
                        "Consultar aseguradoras con los datos ingresados (%{p0} %{p1})",
                        {
                          p0: selectedProducts.length,
                          p1:
                            selectedProducts.length === 1
                              ? t("producto")
                              : t("productos"),
                        },
                      )
                }
                type="button"
              >
                {quoting ? (
                  <>
                    <span
                      aria-hidden="true"
                      className="insurance-spinner insurance-spinner--sm"
                    />
                    <span>{t("Cotizando aseguradoras…")}</span>
                  </>
                ) : (
                  t("Cotizar")
                )}
              </button>
            )}
          </footer>
        </section>
      ) : null}
    </main>
  );
}
