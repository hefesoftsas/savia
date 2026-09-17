import { RESULT_REACT_EXAMPLE } from "./result-react-example";
import { resultHtmlExample } from "./result-html-example";
import { ResultCards } from "./result-cards";
import { ChevronRight, RefreshCw } from "lucide-react";
import "./request-wizard.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import type { CrmObject } from "@savia/crm-shared/metadata";
import {
  requestPageSchema,
  type RequestAction,
} from "@savia/crm-shared/request-page";
import {
  requestPageApi,
  executeRequestPageAction,
  type PageRun,
} from "./request-page-api";
import { getCrmRuntime } from "./runtime";
import { jsonPointer } from "@savia/crm-shared/collection-operations";
import DynamicForm from "./dynamic-form";
import { LookupActions } from "./lookup-actions";
const labels: Record<string, string> = {
  running: "En proceso",
  success: "Resultado disponible",
  partial: "Resultado parcial",
  no_result: "Sin resultados",
  error: "No se completó",
  failed: "No se completó",
  pending: "En proceso",
};
function RefreshResultsButton({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Actualizar resultados"
          onClick={onClick}
        >
          <RefreshCw size={15} aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        Actualizar resultados
      </TooltipContent>
    </Tooltip>
  );
}
function ExecutionModeControl({
  mode,
  busy,
  compact,
  inline,
  onChange,
}: {
  mode: "live" | "mock";
  busy: boolean;
  compact?: boolean;
  inline?: boolean;
  onChange: (mode: "live" | "mock") => void;
}) {
  function change(next: "live" | "mock") {
    if (
      next === "live" &&
      mode === "mock" &&
      !window.confirm(
        "En modo Real las cotizaciones contactan a las aseguradoras. ¿Continuar?",
      )
    ) {
      return;
    }
    onChange(next);
  }
  if (compact) {
    return (
      <details
        className={`request-execution-mode${inline ? " request-execution-mode--inline" : ""}`}
      >
        <summary>
          <span
            className={`request-mode-chip request-mode-chip--${mode}`}
            aria-hidden="true"
          >
            {mode === "live" ? "Real" : "Simulación"}
          </span>
          <span className="request-execution-mode-label">
            Modo de ejecución
          </span>
        </summary>
        <fieldset disabled={busy} className="request-execution-mode-options">
          <legend className="sr-only">Modo de ejecución</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="execution-mode"
              checked={mode === "live"}
              onChange={() => change("live")}
            />
            Real — contacta aseguradoras
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="execution-mode"
              checked={mode === "mock"}
              onChange={() => change("mock")}
            />
            Simulación — respuestas de prueba
          </label>
        </fieldset>
      </details>
    );
  }
  return (
    <label className="grid gap-1 text-sm">
      Modo de ejecución
      <select
        aria-label="Modo de ejecución"
        className="rounded-md border bg-background p-2"
        value={mode}
        disabled={busy}
        onChange={(e) => change(e.target.value as "live" | "mock")}
      >
        <option value="live">Real</option>
        <option value="mock">Simulación</option>
      </select>
    </label>
  );
}
function defaultSelectedActions(actions: RequestAction[]) {
  const submitActions = actions.filter((action) => action.kind === "submit");
  return submitActions.length ? [submitActions[0].id] : [];
}
function display(value: unknown, format: string, currency?: string | null) {
  if (value === null || value === undefined || value === "")
    return "No informado";
  if (format === "money" && Number.isFinite(Number(value))) {
    try {
      return new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: currency ?? "COP",
      }).format(Number(value));
    } catch {
      return String(value);
    }
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
export default function RequestPage({ object }: { object: CrmObject }) {
  const config = requestPageSchema.parse(object.config.studio?.requestPage);
  const isWizard = !!object.config.studio?.wizard?.enabled;
  const [surface, setSurface] = useState<"form" | "results">("form");
  const domainId = getCrmRuntime().domainId ?? "platform";
  const [selected, setSelected] = useState(() =>
    defaultSelectedActions(config.actions),
  );
  const [showHistory, setShowHistory] = useState(false);
  const [mode, setMode] = useState<"live" | "mock">("live");
  const [runs, setRuns] = useState<PageRun[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({}),
    [formVersion, setFormVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    try {
      const result = await requestPageApi<{ data: PageRun[] }>(
        "/runs?" + new URLSearchParams({ domainId, pageName: object.name }),
      );
      if (alive.current) {
        setRuns(result.data);
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [domainId, object.name]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);
  const displayedRuns = showHistory
    ? runs
    : runs.filter(
        (run, index) =>
          runs.findIndex((other) => other.actionId === run.actionId) === index,
      );
  const pending = runs.some(
    (r) =>
      r.status === "running" && Date.now() - Date.parse(r.createdAt) < 360000,
  );
  useEffect(() => {
    if (!pending && !busy) return;
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [pending, busy, refresh]);
  const execute = async (
    action: RequestAction,
    data: Record<string, unknown>,
  ) => {
    const run = await executeRequestPageAction(object.name, action, data, mode);
    if (alive.current)
      setRuns((previous) => [run, ...previous.filter((r) => r.id !== run.id)]);
    return run;
  };
  return (
    <section
      className={`mx-auto max-w-6xl ${isWizard ? "request-wizard space-y-4" : "space-y-6"}`}
      aria-label={object.label}
    >
      <header
        className={
          isWizard
            ? "request-wizard-header"
            : "flex flex-wrap items-center justify-between gap-4"
        }
      >
        <div className="request-wizard-heading">
          <h1
            className={
              isWizard ? "text-lg font-semibold" : "text-2xl font-semibold"
            }
          >
            {object.label}
          </h1>
          <p
            className={
              isWizard
                ? "request-wizard-subtitle"
                : "mt-1.5 text-sm text-muted-foreground"
            }
          >
            {isWizard
              ? "Cotiza auto liviano en tres pasos."
              : "Completa los datos y selecciona las operaciones que deseas ejecutar."}
          </p>
        </div>
        {isWizard ? (
          <div className="request-wizard-toolbar">
            <ExecutionModeControl
              compact
              inline
              mode={mode}
              busy={busy}
              onChange={setMode}
            />
            <RefreshResultsButton onClick={() => void refresh()} />
          </div>
        ) : (
          <ExecutionModeControl mode={mode} busy={busy} onChange={setMode} />
        )}
      </header>
      {isWizard && (
        <nav
          className="view-tabs request-wizard-tabs"
          aria-label="Vista del cotizador"
        >
          <button
            type="button"
            className={surface === "form" ? "selected" : ""}
            aria-pressed={surface === "form"}
            onClick={() => setSurface("form")}
          >
            Preparar cotización
          </button>
          <button
            type="button"
            className={surface === "results" ? "selected" : ""}
            aria-pressed={surface === "results"}
            onClick={() => setSurface("results")}
          >
            Resultados{runs.length ? ` (${runs.length})` : ""}
          </button>
        </nav>
      )}
      {isWizard && error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <div
        hidden={isWizard && surface !== "form"}
        className="request-capture rounded-xl border bg-card p-6"
      >
        <details className="request-products">
          <summary className="request-products-summary">
            <ChevronRight
              className="request-products-chevron"
              aria-hidden="true"
            />
            <span className="request-products-summary-label">Cotizar con</span>
            <span className="request-products-summary-meta">
              {selected.length}{" "}
              {selected.length === 1 ? "producto" : "productos"}
            </span>
          </summary>
          <fieldset disabled={busy} className="request-products-fieldset">
            <legend className="sr-only">Cotizar con</legend>
            <div className="request-products-options">
              {config.actions
                .filter((a) => a.kind === "submit")
                .map((a) => (
                  <label className="request-products-option" key={a.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(a.id)}
                      onChange={(e) =>
                        setSelected((v) =>
                          e.target.checked
                            ? [...v, a.id]
                            : v.filter((id) => id !== a.id),
                        )
                      }
                    />
                    <span>{a.label}</span>
                  </label>
                ))}
            </div>
          </fieldset>
        </details>
        <DynamicForm
          key={formVersion}
          object={object}
          values={values}
          submitLabel={busy ? "Cotizando…" : config.submitLabel}
          renderFieldActions={(field) => {
            const actions = config.actions.filter(
              (a) => a.kind === "lookup" && Object.values(a.input)[0] === field,
            );
            return actions.length ? (
              <LookupActions
                fieldName={field}
                actions={actions}
                execute={execute}
              />
            ) : null;
          }}
          onSave={async (data) => {
            if (submitting.current) return;
            const submitActions = config.actions.filter(
              (a) => selected.includes(a.id) && a.kind === "submit",
            );
            if (!submitActions.length)
              throw new Error("Selecciona al menos una operación.");
            submitting.current = true;
            setBusy(true);
            try {
              await Promise.all(
                submitActions.map(async (a) => {
                  try {
                    await execute(a, data);
                  } catch (e) {
                    if (alive.current) setError((e as Error).message);
                  }
                }),
              );
              await refresh();
              if (isWizard && alive.current) setSurface("results");
            } finally {
              submitting.current = false;
              if (alive.current) setBusy(false);
            }
          }}
        />
      </div>
      <section
        className="rounded-xl border bg-card p-6 space-y-4"
        hidden={isWizard && surface !== "results"}
        aria-label="Resultados de la página"
      >
        {!isWizard && (
          <header className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Resultados e historial</h2>
            <RefreshResultsButton onClick={() => void refresh()} />
          </header>
        )}
        <label className="request-results-history flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showHistory}
            onChange={(e) => setShowHistory(e.target.checked)}
          />
          Mostrar todas las ejecuciones
        </label>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {loading ? (
          <div className="space-y-3" role="status" aria-live="polite">
            <p className="text-xs font-medium text-muted-foreground">
              Cargando resultados…
            </p>
            <div className="overflow-hidden rounded-md border bg-card">
              <div className="flex items-center gap-4 border-b bg-muted/40 px-4 py-3">
                <Skeleton className="h-4 w-28 my-0.5" />
                <Skeleton className="h-4 w-24 my-0.5" />
                <Skeleton className="h-4 w-32 my-0.5" />
                <Skeleton className="h-4 w-20 my-0.5" />
              </div>
              <div className="divide-y">
                {Array.from({ length: 4 }, (_, rowIndex) => (
                  <div
                    key={rowIndex}
                    className="flex items-center gap-4 px-4 py-3.5"
                  >
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : runs.length === 0 ? (
          <p className="text-muted-foreground">
            Al ejecutar una operación, sus resultados aparecerán aquí.
          </p>
        ) : config.resultLayout && config.resultLayout !== "table" ? (
          <ResultCards
            customReact={
              config.resultLayout === "react"
                ? config.resultReact || RESULT_REACT_EXAMPLE
                : undefined
            }
            customHtml={
              config.resultLayout === "html"
                ? config.resultHtml?.trim()
                  ? config.resultHtml
                  : resultHtmlExample(config.resultColumns)
                : undefined
            }
            columns={config.resultColumns}
            comparison={
              config.resultLayout === "comparison" ||
              config.resultLayout === "html"
            }
            rows={displayedRuns.flatMap((run) => {
              const rawOffers =
                (run.result as any)?.type === "quote" &&
                Array.isArray((run.result as any)?.data?.offers) &&
                (run.result as any).data.offers.length
                  ? (run.result as any).data.offers
                  : null;
              const offers = rawOffers ?? [null];
              return offers.map((offer: any, index: number) => ({
                id: `${run.id}:${index}`,
                title: run.label,
                status: labels[run.result?.status ?? run.status] ?? run.status,
                simulation: run.mode === "mock",
                date: run.createdAt,
                values: config.resultColumns.map((col) =>
                  display(
                    jsonPointer(offer ?? run.result?.data, col.pointer),
                    col.format,
                    offer?.premium.currency,
                  ),
                ),
                errors: [
                  run.error,
                  ...(run.result?.errors.map((e) => e.message) ?? []),
                ].filter((value): value is string => Boolean(value)),
                response: run.result,
                onLoad: () => {
                  setSurface("form");
                  setValues(run.values);
                  setFormVersion((v) => v + 1);
                  if (
                    config.actions.some(
                      (a) => a.id === run.actionId && a.kind === "submit",
                    )
                  )
                    setSelected([run.actionId]);
                  setMode(run.mode);
                },
              }));
            })}
            disabled={busy}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="p-3">Operación / fecha</th>
                  <th className="p-3">Estado</th>
                  {config.resultColumns.map((col) => (
                    <th className="p-3" key={col.pointer}>
                      {col.label}
                    </th>
                  ))}
                  <th className="p-3">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {displayedRuns.map((run) => {
                  const rawOffers =
                    (run.result as any)?.type === "quote" &&
                    Array.isArray((run.result as any)?.data?.offers) &&
                    (run.result as any).data.offers.length
                      ? (run.result as any).data.offers
                      : null;
                  const offers = rawOffers ?? [null];
                  return offers.map((offer: any, index: number) => (
                    <tr
                      className="border-b align-top"
                      key={run.id + ":" + index}
                    >
                      <td className="p-3">
                        <strong>{run.label}</strong>
                        <small className="block text-muted-foreground">
                          {new Date(run.createdAt).toLocaleString("es-CO")}
                        </small>
                        {run.mode === "mock" && <small>Simulación</small>}
                      </td>
                      <td className="p-3">
                        {run.status === "running" &&
                        Date.now() - Date.parse(run.createdAt) >= 360000
                          ? "Sin confirmación"
                          : labels[run.result?.status ?? run.status]}
                        {run.error && <p role="alert">{run.error}</p>}
                        {run.result?.errors.map((e, i) => (
                          <p key={i} className="text-destructive">
                            {e.message}
                          </p>
                        ))}
                      </td>
                      {config.resultColumns.map((col) => (
                        <td className="p-3" key={col.pointer}>
                          {display(
                            jsonPointer(offer ?? run.result?.data, col.pointer),
                            col.format,
                            offer?.premium.currency,
                          )}
                        </td>
                      ))}
                      <td className="p-3 space-y-2">
                        <details>
                          <summary className="cursor-pointer">
                            Ver respuesta
                          </summary>
                          <div className="max-w-md space-y-2">
                            {run.result?.warnings.map((w, i) => (
                              <p key={i}>{w.message}</p>
                            ))}
                            {offer?.coverages?.map((c: any, i: number) => (
                              <p key={i}>
                                {c.name ?? c.code}:{" "}
                                {display(
                                  c.insuredValue,
                                  "money",
                                  offer.premium.currency,
                                )}
                              </p>
                            ))}
                            {offer?.deductibles?.map((d: any, i: number) => (
                              <p key={i}>{d.description ?? d.code}</p>
                            ))}
                            <pre className="max-h-64 overflow-auto text-xs">
                              {JSON.stringify(run.result, null, 2)}
                            </pre>
                          </div>
                        </details>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            setSurface("form");
                            setValues(run.values);
                            setFormVersion((v) => v + 1);
                            if (
                              config.actions.some(
                                (a) =>
                                  a.id === run.actionId && a.kind === "submit",
                              )
                            )
                              setSelected([run.actionId]);
                            setMode(run.mode);
                          }}
                        >
                          Cargar datos
                        </Button>
                        {(run.status === "failed" ||
                          run.result?.status === "error") && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={async () => {
                              const action = config.actions.find(
                                (a) => a.id === run.actionId,
                              );
                              if (!action) return;
                              setSurface("form");
                              setValues(run.values);
                              if (action.kind === "submit")
                                setSelected([action.id]);
                              setMode(run.mode);
                              setFormVersion((v) => v + 1);
                            }}
                          >
                            Preparar reintento
                          </Button>
                        )}
                      </td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
