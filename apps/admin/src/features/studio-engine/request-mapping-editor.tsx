import { useMessages, useAppLocale, intlLocale } from "@/i18n/core";
import { integrationMessages } from "@/i18n/locales/integrations";
import { automationMessages } from "@/i18n/locales/automation";
import { RequestLookupSettings } from "./request-lookup-settings";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import "./request-mapping-editor.css";
import { RequestCatalogDialog } from "./request-catalog-dialog";
import { useEffect, useRef, useState } from "react";
import type { RequestPageConfig } from "@savia/studio-shared/request-page";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { MonacoCodeEditor } from "./monaco-code-editor";
import { requestPageApi, type PageRun } from "./request-page-api";
import { getStudioRuntime } from "./runtime";
import { PropertyPanelSearch } from "./property-panel-search";
import { StudioHelpTooltip } from "./studio-help-tooltip";
import { usePropertyPanelFilter } from "./use-property-panel-filter";
import { propertySearchTerms } from "@savia/studio-shared/property-panel-search";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function RequestMappingEditor({
  config,
  fields,
  pageName,
  onChange,
}: {
  config: RequestPageConfig;
  fields: Record<string, { label?: string }>;
  pageName?: string;
  onChange: (config: RequestPageConfig) => void;
}) {
  const t = useMessages(automationMessages);
  const statusText = useMessages(integrationMessages);
  const locale = useAppLocale();

  const [actionId, setActionId] = useState(config.actions[0]?.id ?? "");
  const [runs, setRuns] = useState<PageRun[]>([]);
  const [runId, setRunId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [propertySearch, setPropertySearch] = useState("");
  const mappingPropertiesRef = useRef<HTMLDivElement>(null);
  const action =
    config.actions.find((item) => item.id === actionId) ?? config.actions[0];
  const domainId = getStudioRuntime().domainId ?? "platform";
  const {
    empty: propertyFilterEmpty,
    matchCount,
    filtering,
  } = usePropertyPanelFilter(
    propertySearch,
    mappingPropertiesRef,
    action?.id ?? "",
  );
  useEffect(() => {
    if (!pageName) return;
    let active = true;
    setLoading(true);
    setError("");
    setRuns([]);
    requestPageApi<{ data: PageRun[] }>(
      "/runs?" + new URLSearchParams({ domainId, pageName }),
    )
      .then((result) => {
        if (active) setRuns(result.data);
      })
      .catch((error) => {
        if (active)
          setError(
            error instanceof Error
              ? error.message
              : t("No se pudieron consultar las respuestas."),
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [pageName, domainId, revision]);
  useEffect(() => {
    setPropertySearch("");
  }, [action?.id]);
  if (!action)
    return <p>{t("No hay operaciones configuradas en esta página.")}</p>;
  const canRemove =
    action.kind !== "submit" ||
    config.actions.filter((item) => item.kind === "submit").length > 1;
  const history = runs.filter((run) => run.actionId === action.id);
  const selected = history.find((run) => run.id === runId) ?? history[0];
  return (
    <div className="request-connections">
      <header className="request-connections-toolbar">
        <div className="request-connections-heading">
          <h4>{t("Requests conectados")}</h4>
          <StudioHelpTooltip label={t("Estado de las conexiones")}>
            {config.actions.length}{" "}
            {t("operaciones · Los cambios se guardan al publicar")}
          </StudioHelpTooltip>
        </div>
        <RequestCatalogDialog
          config={config}
          fields={fields}
          onAdd={(next, id) => {
            onChange(next);
            setActionId(id);
            setRunId("");
          }}
        />
      </header>
      <label className="studio-control">
        <span>{t("Operación de Savia Request")}</span>
        <select
          value={action.id}
          onChange={(event) => {
            setActionId(event.target.value);
            setRunId("");
          }}
        >
          {config.actions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label} ·{" "}
              {item.kind === "submit"
                ? t("Botón principal")
                : t("Consulta de campo")}
            </option>
          ))}
        </select>
      </label>
      <div className="request-connection-identity">
        <div>
          <div className="request-connection-title">
            <strong>{action.label}</strong>
            <StudioHelpTooltip label={t("Cómo se ejecuta esta operación")}>
              {action.kind === "submit"
                ? t("Se ejecuta con el botón principal")
                : t("Consulta desde un campo")}
            </StudioHelpTooltip>
          </div>
          <code>{action.id}</code>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={t("Quitar de esta página")}
              disabled={!canRemove}
              onClick={() => {
                if (!canRemove) return;
                const actions = config.actions.filter(
                  (item) => item.id !== action.id,
                );
                onChange({ ...config, actions });
                setActionId(actions[0]?.id ?? "");
                setRunId("");
              }}
            >
              <Trash2 size={14} aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" sideOffset={6}>
            {t("Quitar de esta página")}
          </TooltipContent>
        </Tooltip>
      </div>
      {!canRemove && (
        <p className="text-sm text-muted-foreground">
          {t(
            "Conecta otro request al botón principal antes de quitar el último.",
          )}
        </p>
      )}
      <Tabs defaultValue="mapping" key={action.id}>
        <TabsList aria-label={t("Detalle del request")}>
          <TabsTrigger value="mapping">
            {t("Entradas (")}
            {Object.keys(action.input).length})
          </TabsTrigger>
          <TabsTrigger value="responses">
            {t("Respuestas (")}
            {history.length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="mapping">
          <section className="request-mapping-properties">
            <h4 className="font-semibold">{t("Conectar campos")}</h4>
            <PropertyPanelSearch
              query={propertySearch}
              onQueryChange={setPropertySearch}
              matchCount={matchCount}
              filtering={filtering}
            />
            {propertyFilterEmpty ? (
              <p className="request-mapping-empty" role="status">
                {t("No hay propiedades que coincidan con esta búsqueda.")}
              </p>
            ) : null}
            <div
              ref={mappingPropertiesRef}
              className="request-mapping-property-list"
            >
              {Object.entries(action.input).map(([input, field]) => (
                <details
                  key={input}
                  className="studio-property-section request-mapping-property"
                >
                  <summary className="studio-property-section-summary request-mapping-property-summary">
                    <span className="request-mapping-property-name">
                      {input}
                    </span>
                    <span className="request-mapping-property-field">
                      {fields[field]?.label ?? field}
                    </span>
                  </summary>
                  <div className="studio-property-section-body">
                    <label
                      className="studio-control request-mapping-row"
                      data-property-search={propertySearchTerms(
                        input,
                        fields[field]?.label,
                        field,
                      )}
                    >
                      <span>{t("Campo de Savia")}</span>
                      <select
                        aria-label={t("Campo para %{input}", { input: input })}
                        value={field}
                        onChange={(event) =>
                          onChange({
                            ...config,
                            actions: config.actions.map((item) =>
                              item.id === action.id
                                ? {
                                    ...item,
                                    input: {
                                      ...item.input,
                                      [input]: event.target.value,
                                    },
                                  }
                                : item,
                            ),
                          })
                        }
                      >
                        {!fields[field] && (
                          <option value={field}>
                            {t("Campo no disponible:")} {field}
                          </option>
                        )}
                        {Object.entries(fields).map(([name, definition]) => (
                          <option key={name} value={name}>
                            {definition.label ?? name} ({name})
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </details>
              ))}
            </div>
          </section>
          {action.kind === "lookup" && (
            <RequestLookupSettings
              action={action}
              fields={fields}
              onChange={(next) =>
                onChange({
                  ...config,
                  actions: config.actions.map((item) =>
                    item.id === next.id ? next : item,
                  ),
                })
              }
            />
          )}
        </TabsContent>
        <TabsContent value="responses">
          <section className="space-y-3 min-w-0">
            <div className="flex flex-wrap justify-between gap-3">
              <div className="request-responses-heading">
                <h4 className="font-semibold">{t("Respuestas guardadas")}</h4>
                <StudioHelpTooltip
                  label={t("Ayuda sobre las respuestas guardadas")}
                >
                  {t(
                    "Datos enviados desde el formulario y respuesta guardada. Consultar este historial no ejecuta el request.",
                  )}
                </StudioHelpTooltip>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading || !pageName}
                onClick={() => setRevision((value) => value + 1)}
              >
                {t("Actualizar respuestas")}
              </Button>
            </div>
            {loading ? (
              <p role="status">{t("Cargando respuestas…")}</p>
            ) : error ? (
              <p role="alert">{error}</p>
            ) : !selected ? (
              <p className="text-sm text-muted-foreground">
                {t(
                  "Esta operación todavía no tiene ejecuciones guardadas en esta página.",
                )}
              </p>
            ) : (
              <>
                <label className="studio-control">
                  <span>{t("Ejecución")}</span>
                  <select
                    value={selected.id}
                    onChange={(event) => setRunId(event.target.value)}
                  >
                    {history.map((run) => (
                      <option key={run.id} value={run.id}>
                        {new Date(run.createdAt).toLocaleString(
                          intlLocale(locale),
                        )}{" "}
                        · {run.mode === "mock" ? t("Simulación") : t("Real")} ·{" "}
                        {statusText(run.status)}
                      </option>
                    ))}
                  </select>
                </label>
                <MonacoCodeEditor
                  language="json"
                  ariaLabel={t("Entrada y respuesta de Savia Request")}
                  readOnly
                  onChange={() => {}}
                  height={420}
                  value={JSON.stringify(
                    {
                      formValues: selected.values,
                      response: selected.result,
                      error: selected.error,
                    },
                    null,
                    2,
                  )}
                />
              </>
            )}
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
