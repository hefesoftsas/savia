import { InsuranceNotice } from "../notice";
import { usePluginLocale } from "@savia/studio-shared/plugin-locale-react";
import { pluginIntlLocale, type PluginLocale, type PluginMessageParams } from "@savia/studio-shared/plugin-localization";
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

function storedNumber(value: unknown): number | undefined {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
}

function storedText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
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

function detailStatus(
  value: unknown,
  quoteNumber: string | undefined,
  premium: number | undefined,
): QuoteBatchItem["status"] {
  const normalized =
    typeof value === "string" ? value.trim().toLocaleLowerCase("es-CO") : "";
  if (
    ["error", "fallida", "fallido", "rechazada", "rechazado"].includes(
      normalized,
    )
  ) {
    return "failed";
  }
  if (
    [
      "recibida",
      "recibido",
      "cotizada",
      "cotizado",
      "completada",
      "completado",
      "exitosa",
      "exitoso",
      "success",
      "succeeded",
    ].includes(normalized) ||
    quoteNumber ||
    (premium !== undefined && premium > 0)
  ) {
    return "succeeded";
  }
  return "pending";
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
       {t("Consultando…")} </span>
  ) : resolvedCity ? (
    <span
      className="insurance-field-synced"
      title={t("Código DANE: %{p0}", {p0: resolvedCity.code})}
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

  const [surface, setSurface] = useState<"form" | "results" | "history">(
    "form",
  );
  const [activeStep, setActiveStep] = useState(0);
  const [values, setValues] = useState<QuoteFormValues>(defaultQuoteFormValues);
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [errors, setErrors] = useState<QuoteInputErrors>({});
  const [notice, setNotice] = useState("");
  const [lookingUpPlate, setLookingUpPlate] = useState(false);
  const [lastLookedUpPlate, setLastLookedUpPlate] = useState<string | null>(
    null,
  );
  const [lastClientLookup, setLastClientLookup] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const busy = lookingUpPlate || quoting;
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
  const [batchItems, setBatchItems] = useState<QuoteBatchItem[]>([]);
  const [retryingIds, setRetryingIds] = useState<string[]>([]);
  const [quoteReference, setQuoteReference] = useState<string | null>(null);
  const [masterQuoteId, setMasterQuoteId] = useState<string | null>(null);
  const [masterQuoteVersion, setMasterQuoteVersion] = useState<number>();
  const [historyQuotes, setHistoryQuotes] = useState<HistoricalQuoteSummary[]>(
    [],
  );
  const [selectedHistoryQuoteId, setSelectedHistoryQuoteId] = useState<
    string | null
  >(null);
  const [historicalBatchItems, setHistoricalBatchItems] = useState<
    QuoteBatchItem[] | null
  >(null);
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
        const res = await coll.list();
        const records = (res?.data ?? []) as Array<Record<string, unknown>>;
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

  const handleSelectHistoryQuote = async (quoteId: string | null) => {
    if (!quoteId || quoteId === "current") {
      setSelectedHistoryQuoteId(null);
      setHistoricalBatchItems(null);
      setResumeQuote(null);
      return;
    }
    setSelectedHistoryQuoteId(quoteId);
    setResumeQuote(null);
    setHistoricalBatchItems(null);
    try {
      const detailColl = savia.collections?.collection?.(
        "cotizaciones_detalle",
      );
      if (detailColl?.list) {
        const firstPage = await detailColl.list({ page: 1, perPage: 200 });
        const pageCount = Math.ceil(firstPage.total / firstPage.perPage);
        const remainingPages = await Promise.all(
          Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) =>
            detailColl.list({ page: index + 2, perPage: firstPage.perPage }),
          ),
        );
        const items = [firstPage, ...remainingPages].flatMap(
          (page) => page.data,
        ) as Array<Record<string, unknown>>;
        const quoteReference = historyQuotes.find(
          (quote) => quote.id === quoteId,
        )?.name;
        const filtered = items.filter(
          (detail) =>
            detail.cotizacion === quoteId ||
            detail.cotizacion === quoteReference,
        );
        const mapped: QuoteBatchItem[] = filtered.map((d) => {
          const quoteNumber = storedText(d.numero_cotizacion);
          const premium = storedNumber(d.prima);
          const recordedStatus = detailStatus(d.estado, quoteNumber, premium);
          const updatedAt =
            typeof d.updated_at === "string"
              ? Date.parse(d.updated_at)
              : typeof d.created_at === "string"
                ? Date.parse(d.created_at)
                : NaN;
          const stale =
            recordedStatus === "pending" &&
            Number.isFinite(updatedAt) &&
            Date.now() - updatedAt > 5 * 60_000;
          return {
            productId: String(d.producto || d.id),
            flowId: String(d.flow_id || d.producto || d.id),
            label: String(d.producto || d.name || "Póliza"),
            provider: String(d.aseguradora || "Aseguradora"),
            status: stale ? "failed" : recordedStatus,
            error: stale
              ? t("La ejecución no se completó.")
              : typeof d.error_mensaje === "string"
                ? d.error_mensaje
                : undefined,
            detailId: String(d.id),
            detailVersion: recordVersion(d),
            runId: storedText(d.run_id),
            quoteNumber,
            premium,
          };
        });
        setHistoricalBatchItems(mapped);
      }
    } catch {
      setHistoricalBatchItems([]);
      setNotice("No se pudo cargar la cotización guardada. Inténtalo de nuevo.");
    }
  };

  const appliedQuoteLink = useRef<string | null>(null);
  useEffect(() => {
    const selectLinkedQuote = () => {
      const query = new URLSearchParams(
        window.location.hash.split("?")[1] ?? "",
      );
      const id = query.get("quote");
      if (id && appliedQuoteLink.current !== id) {
        appliedQuoteLink.current = id;
        setSurface("results");
        void handleSelectHistoryQuote(id);
      }
      if (!id) appliedQuoteLink.current = null;
    };
    selectLinkedQuote();
    window.addEventListener("hashchange", selectLinkedQuote);
    return () => window.removeEventListener("hashchange", selectLinkedQuote);
  }, [historyQuotes]);

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
    setProductErrors([]);
    setNotice("");

    const resuming = resumeQuote;
    const ref = resuming?.summary.name ?? generateQuoteReference();
    setQuoteReference(ref);

    // Guarda el solicitante en la colección CRM configurada (no bloquea).
    let quoteClientId: string | null = null;
    try {
      const upserted = await upsertQuoteClient(
        savia,
        settings,
        values.applicant,
      );
      if (upserted) quoteClientId = upserted.id;
    } catch {
      // Non-blocking fallback
    }

    let createdMasterId: string | null = resuming?.summary.id ?? null;
    let createdMasterVersion: number | undefined = resuming?.summary.version;
    if (resuming) {
      setMasterQuoteId(createdMasterId);
      setMasterQuoteVersion(createdMasterVersion);
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
            createdMasterVersion = recordVersion(master);
            setMasterQuoteId(createdMasterId);
            setMasterQuoteVersion(createdMasterVersion);
          }
        }
      } catch {
        // The provider responses remain usable even if CRM persistence fails.
      }
    }
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
              // Ignore single creation failure
            }
          }),
        );
      }
    } catch {
      // Non-blocking fallback
    }

    const initialItems: QuoteBatchItem[] = [
      ...(resuming?.items.filter((item) => item.status === "succeeded") ?? []),
      ...selected.map((product) => ({
        productId: product.id,
        flowId: product.flowId,
        label: product.label,
        provider: product.label.split(" · ")[0] ?? "Seguros",
        status: "pending" as const,
        detailId: details[product.id]?.id,
        detailVersion: details[product.id]?.version,
      })),
    ];

    setBatchItems(initialItems);
    setSelectedHistoryQuoteId(null);
    setResumeQuote(null);
    setSurface("results");

    try {
      const itemsMap = new Map<string, QuoteBatchItem>(
        initialItems.map((item) => [item.productId, item]),
      );
      const failures: string[] = [];

      const quotePromises = selected.map(async (product) => {
        const detail = details[product.id];
        const detailId = detail?.id;
        let detailVersion = detail?.version;
        const provider = product.label.split(" · ")[0] ?? "Seguros";

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

          const run = runFromResponse(
            response.run,
            response.output,
          );
          const { quoteNumber, premium } = extractQuoteData(
            response.output,
          );

          if (detailId && detailVersion !== undefined) {
            try {
              const updated = await savia.collections
                ?.collection?.("cotizaciones_detalle")
                ?.update?.(
                  detailId,
                  {
                    estado: "Recibida",
                    numero_cotizacion: quoteNumber,
                    prima: premium,
                    run_id: run.runId,
                    error_mensaje: undefined,
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
            status: "succeeded",
            runId: run.runId,
            detailId,
            detailVersion,
            quoteNumber,
            premium,
          };
          itemsMap.set(product.id, updatedItem);

          setRuns((current) => [run, ...current]);
          setBatchItems((current) =>
            current.map((item) =>
              item.productId === product.id ? updatedItem : item,
            ),
          );

          return { status: "fulfilled" as const, product, item: updatedItem };
        } catch (reason) {
          const err = errorMessage(
            reason,
            "El conector no pudo completar la acción.",
          );
          failures.push(`${product.label}: ${err}`);
          setProductErrors((current) => [...current, `${product.label}: ${err}`]);

          if (detailId && detailVersion !== undefined) {
            try {
              const updated = await savia.collections
                ?.collection?.("cotizaciones_detalle")
                ?.update?.(
                  detailId,
                  {
                    estado: "Error",
                    error_mensaje: err,
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
          };
          itemsMap.set(product.id, updatedItem);

          setBatchItems((current) =>
            current.map((item) =>
              item.productId === product.id ? updatedItem : item,
            ),
          );

          return { status: "rejected" as const, product, error: err };
        }
      });

      await Promise.allSettled(quotePromises);

      const finalItems = Array.from(itemsMap.values());
      if (createdMasterId && createdMasterVersion !== undefined) {
        try {
          const anySuccess = finalItems.some(
            (item) => item.status === "succeeded",
          );
          const validPremiums = finalItems
            .map((item) => item.premium)
            .filter((p): p is number => typeof p === "number" && p > 0);
          const bestPremium = validPremiums.length
            ? Math.min(...validPremiums)
            : undefined;
          const updatedMaster = await savia.collections
            ?.collection?.("cotizaciones")
            ?.update?.(
              createdMasterId,
              {
                estado: anySuccess ? "Recibida" : "Rechazada",
                ...(bestPremium !== undefined ? { prima: bestPremium } : {}),
              },
              { version: createdMasterVersion },
            );
          setMasterQuoteVersion(
            recordVersion(updatedMaster) ?? createdMasterVersion + 1,
          );
          void refreshHistoricalQuotes();
        } catch {}
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
        const updated = await savia.collections
          ?.collection?.("cotizaciones_detalle")
          ?.update?.(
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

      if (item.detailId && detailVersion !== undefined) {
        try {
          const updated = await savia.collections
            ?.collection?.("cotizaciones_detalle")
            ?.update?.(
              item.detailId,
              {
                estado: "Recibida",
                numero_cotizacion: quoteNumber,
                prima: premium,
                run_id: newRun.runId,
                error_mensaje: undefined,
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
              }
            : b,
        ),
      );

      if (masterQuoteId && masterQuoteVersion !== undefined) {
        try {
          const updatedMaster = await savia.collections
            ?.collection?.("cotizaciones")
            ?.update?.(
              masterQuoteId,
              {
                estado: "Recibida",
                ...(premium ? { prima: premium } : {}),
              },
              { version: masterQuoteVersion },
            );
          setMasterQuoteVersion(
            recordVersion(updatedMaster) ?? masterQuoteVersion + 1,
          );
        } catch {}
      }

      void refreshRuns();
    } catch (reason) {
      const err = errorMessage(
        reason,
        "El conector no pudo completar la acción.",
      );
      if (item.detailId && detailVersion !== undefined) {
        try {
          const updated = await savia.collections
            ?.collection?.("cotizaciones_detalle")
            ?.update?.(
              item.detailId,
              {
                estado: "Error",
                error_mensaje: err,
              },
              { version: detailVersion },
            );
          detailVersion = recordVersion(updated) ?? detailVersion + 1;
        } catch {}
      }
      setBatchItems((current) =>
        current.map((b) =>
          b.productId === productId
            ? { ...b, status: "failed", error: err, detailVersion }
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
          const updated = await savia.collections
            ?.collection?.("cotizaciones_detalle")
            ?.update?.(
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
      let anySucceeded = false;
      const retryPromises = failed.map(async (item) => {
        let detailVersion =
          resetDetailVersions.get(item.productId) ?? item.detailVersion;
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
          anySucceeded = true;
          const newRun = runFromResponse(res.run, res.output);
          const { quoteNumber, premium } = extractQuoteData(res.output);

          if (item.detailId && detailVersion !== undefined) {
            try {
              const updated = await savia.collections
                ?.collection?.("cotizaciones_detalle")
                ?.update?.(
                  item.detailId,
                  {
                    estado: "Recibida",
                    numero_cotizacion: quoteNumber,
                    prima: premium,
                    run_id: newRun.runId,
                    error_mensaje: undefined,
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
          };

          setRuns((current) => [newRun, ...current]);
          setBatchItems((current) =>
            current.map((b) =>
              b.productId === item.productId ? updatedItem : b,
            ),
          );
          setRetryingIds((current) =>
            current.filter((id) => id !== item.productId),
          );
          return updatedItem;
        } catch (reason) {
          const err = errorMessage(
            reason,
            "El conector no pudo completar la acción.",
          );
          if (item.detailId && detailVersion !== undefined) {
            try {
              const updated = await savia.collections
                ?.collection?.("cotizaciones_detalle")
                ?.update?.(
                  item.detailId,
                  {
                    estado: "Error",
                    error_mensaje: err,
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
          };
          setBatchItems((current) =>
            current.map((b) =>
              b.productId === item.productId ? updatedItem : b,
            ),
          );
          setRetryingIds((current) =>
            current.filter((id) => id !== item.productId),
          );
          return updatedItem;
        }
      });

      await Promise.allSettled(retryPromises);

      if (anySucceeded && masterQuoteId && masterQuoteVersion !== undefined) {
        try {
          const updatedMaster = await savia.collections
            ?.collection?.("cotizaciones")
            ?.update?.(
              masterQuoteId,
              {
                estado: "Recibida",
              },
              { version: masterQuoteVersion },
            );
          setMasterQuoteVersion(
            recordVersion(updatedMaster) ?? masterQuoteVersion + 1,
          );
        } catch {}
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
        aria-label={entry === "direct" ? t("Cotizador") : t("Cotizador por pasos")}
      >
        <p className="insurance-quote__empty">
           {t("Esta pantalla está desactivada para este tenant.")} </p>
      </main>
    );

  return (
    <main
      className="insurance-quote"
      aria-label={entry === "direct" ? t("Cotizador") : t("Cotizador por pasos")}
      data-testid="insurance-quote-screen"
    >
      <header className="insurance-quote__header">
        <div className="insurance-quote__title-wrap">
          <p className="insurance-quote__eyebrow">{t("Seguros · Autos livianos")}</p>
          <div className="insurance-quote__heading">
            <h1>{entry === "direct" ? t("Cotizador") : t("Cotizador por pasos")}</h1>
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
                 {t("Vehículo, tomador y comparador en un solo flujo en línea.")} </span>
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
          <span className="insurance-tabs__label">{t("Preparar cotización")}</span>
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
             {t("Cotizaciones")} {activeQuoteOffersCount > 0 ? (
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
             {t("Historial")} {historyQuotes.length > 0 ? (
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
          <nav aria-label={t("Pasos del formulario")} className="insurance-steps">
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
             {t("Paso")} {activeStep + 1}  {t("de")} {quoteSteps.length}: {t(currentStep.title)}
          </h2>
          <fieldset className="insurance-quote__step-fields" disabled={quoting}>
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
                         {t("Consultando…")} </span>
                    ) : values.vehicle.lookupFields.includes(
                        "fasecoldaCode",
                      ) ? (
                      <span className="insurance-field-synced">
                         {t("✓ Autocompletado")} </span>
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
                      lookingUpPlate ? t("Consultando Fasecolda…") : t("Ej. 123456")
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
                         {t("Consultando…")} </span>
                    ) : values.vehicle.lookupFields.includes(
                        "productionYear",
                      ) ? (
                      <span className="insurance-field-synced">
                         {t("✓ Autocompletado")} </span>
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
                    placeholder={lookingUpPlate ? t("Consultando…") : t("Ej. 2024")}
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
                  placeholder={t("Buscar ciudad (ej. Bogotá, Medellín, Cali)...")}
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
                         {t("Consultando…")} </span>
                    ) : values.vehicle.lookupFields.includes(
                        "accessoriesValue",
                      ) ? (
                      <span className="insurance-field-synced">
                         {t("✓ Autocompletado")} </span>
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
                              values.vehicle.accessoriesValue, locale,
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
                         {t("Consultando…")} </span>
                    ) : values.vehicle.lookupFields.includes(
                        "declaredValue",
                      ) ? (
                      <span className="insurance-field-synced">
                         {t("✓ Autocompletado")} </span>
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
                          : formatCurrencyNumber(values.vehicle.declaredValue, locale)
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
                <QuoteField error={errors["applicant.gender"]} label={t("Sexo")}>
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
                          ? t("%{p0} años", {p0: calculateAge(values.applicant.birthDate) ?? ""})
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
                  placeholder={t("Buscar ciudad (ej. Bogotá, Medellín, Cali)...")}
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
                <QuoteField error={errors["applicant.phone"]} label={t("Teléfono")}>
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
                            : t("Ingresa un correo válido (ej. nombre@correo.com)"),
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
                     {t("en vivo…")} </strong>
                  <span className="insurance-busy-indicator__subtitle">
                     {t("Consultando tarifas y coberturas oficiales. Esto puede tomar unos segundos.")} </span>
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
               {t("Anterior")} </button>
            {activeStep < quoteSteps.length - 1 ? (
              <button
                disabled={busy || Object.keys(currentErrors).length > 0}
                onClick={next}
                title={
                  Object.keys(currentErrors).length > 0
                    ? t("Completa los campos requeridos para continuar")
                    : t("Continuar al paso %{p0} de %{p1}", {p0: activeStep + 2, p1: quoteSteps.length})
                }
                type="button"
              >
                 {t("Siguiente paso")} </button>
            ) : (
              <button
                className={quoting ? "is-busy" : ""}
                disabled={busy}
                onClick={() => void quote()}
                title={
                  quoting
                    ? t("Consultando aseguradoras en vivo…")
                    : t("Consultar aseguradoras con los datos ingresados (%{p0} %{p1})", {p0: selectedProducts.length, p1: selectedProducts.length === 1 ? t("producto") : t("productos")})
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
