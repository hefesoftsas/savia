import { useMessages } from "@/i18n/core";
import { automationMessages } from "@/i18n/locales/automation";
import type { RequestAction } from "@savia/studio-shared/request-page";
import {
  LOOKUP_PLACEMENT_LABELS,
  lookupPlacementSchema,
  DEFAULT_LOOKUP_EVENT_DEBOUNCE_MS,
} from "@savia/studio-shared/request-page";
import { LookupTriggerEventTags } from "./lookup-trigger-event-tags";
import { LookupIconPicker } from "./lookup-icon-picker";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";
import { PropertyPanelSearch } from "./property-panel-search";
import { StudioHelpTooltip } from "./studio-help-tooltip";
import { usePropertyPanelFilter } from "./use-property-panel-filter";
import { propertySearchTerms } from "@savia/studio-shared/property-panel-search";

export function RequestLookupSettings({
  action,
  fields,
  onChange,
}: {
  action: RequestAction;
  fields: Record<string, { label?: string }>;
  onChange: (action: RequestAction) => void;
}) {
  const t = useMessages(automationMessages);

  const source = Object.values(action.input)[0];
  const [outputSearch, setOutputSearch] = useState("");
  const outputPropertiesRef = useRef<HTMLDivElement>(null);
  const {
    empty: outputFilterEmpty,
    matchCount: outputMatchCount,
    filtering: outputFiltering,
  } = usePropertyPanelFilter(outputSearch, outputPropertiesRef, action.id);
  useEffect(() => {
    setOutputSearch("");
  }, [action.id]);
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="studio-control-label-row">
          <h4 className="font-semibold">{t("Cuándo se consulta")}</h4>
          <StudioHelpTooltip label={t("Ayuda sobre los disparadores")}>
            {t("Campo disparador:")} {fields[source]?.label ?? source}
            {t(
              ". El botón permite consultar manualmente; los eventos siguientes agregan disparadores automáticos.",
            )}
          </StudioHelpTooltip>
        </div>
        <LookupTriggerEventTags
          events={action.events}
          onChange={(events) =>
            onChange({
              ...action,
              events,
              eventDebounce: events?.length ? action.eventDebounce : undefined,
              eventDebounceMs:
                events?.length && action.eventDebounce
                  ? action.eventDebounceMs
                  : undefined,
            })
          }
        />
        {!!action.events?.length && (
          <>
            <label className="flex gap-2 items-center text-sm">
              <input
                type="checkbox"
                checked={action.eventDebounce ?? false}
                onChange={(event) =>
                  onChange({
                    ...action,
                    eventDebounce: event.target.checked,
                    eventDebounceMs: event.target.checked
                      ? (action.eventDebounceMs ??
                        DEFAULT_LOOKUP_EVENT_DEBOUNCE_MS)
                      : undefined,
                  })
                }
              />
              {t("Debounce")}
            </label>
            {action.eventDebounce && (
              <label className="studio-control">
                <span>{t("Espera del debounce (ms)")}</span>
                <Input
                  type="number"
                  min={0}
                  max={10000}
                  step={50}
                  value={
                    action.eventDebounceMs ?? DEFAULT_LOOKUP_EVENT_DEBOUNCE_MS
                  }
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isInteger(value) && value >= 0 && value <= 10000)
                      onChange({ ...action, eventDebounceMs: value });
                  }}
                />
              </label>
            )}
          </>
        )}
        <details>
          <summary>{t("Botón del campo")}</summary>
          <div className="space-y-3 mt-3">
            <label className="studio-control">
              <span>{t("Estilo del botón")}</span>
              <select
                value={action.buttonStyle ?? "text"}
                onChange={(event) =>
                  onChange({
                    ...action,
                    buttonStyle: event.target.value as "text" | "icon",
                    icon:
                      event.target.value === "icon"
                        ? (action.icon ?? "search")
                        : undefined,
                  })
                }
              >
                <option value="text">{t("Texto")}</option>
                <option value="icon">{t("Icono")}</option>
              </select>
            </label>
            {action.buttonStyle === "icon" && (
              <LookupIconPicker
                aria-label={t("Icono del botón")}
                value={action.icon ?? "search"}
                onChange={(icon) => onChange({ ...action, icon })}
              />
            )}
            <label className="studio-control">
              <span>{t("Posición del botón")}</span>
              <select
                value={action.placement ?? "inline-end"}
                onChange={(event) =>
                  onChange({
                    ...action,
                    placement: lookupPlacementSchema.parse(event.target.value),
                  })
                }
              >
                {Object.entries(LOOKUP_PLACEMENT_LABELS).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>
        </details>
      </section>
      <section className="space-y-3">
        <div className="studio-control-label-row">
          <h4 className="font-semibold">
            {t("Respuesta → Campos que se completan")}
          </h4>
          <StudioHelpTooltip label={t("Ayuda sobre los campos de salida")}>
            {t(
              "Selecciona cada campo y escribe la ruta de su valor en la respuesta, por ejemplo /data/vehicle/year.",
            )}
          </StudioHelpTooltip>
        </div>
        {!!Object.keys(action.output).length && (
          <PropertyPanelSearch
            query={outputSearch}
            onQueryChange={setOutputSearch}
            matchCount={outputMatchCount}
            filtering={outputFiltering}
            ariaLabel={t("Buscar campos de salida")}
          />
        )}
        {outputFilterEmpty ? (
          <p className="request-mapping-empty" role="status">
            {t("No hay campos de salida que coincidan con esta búsqueda.")}
          </p>
        ) : null}
        <div ref={outputPropertiesRef} className="request-lookup-output-list">
          {Object.entries(action.output).map(([field, pointer]) => (
            <details
              key={field}
              className="studio-property-section request-lookup-output-property"
            >
              <summary className="studio-property-section-summary">
                <span>{fields[field]?.label ?? field}</span>
                <span className="request-lookup-output-path">{pointer}</span>
              </summary>
              <div
                className="studio-property-section-body request-lookup-output-body"
                data-property-search={propertySearchTerms(
                  field,
                  fields[field]?.label,
                  pointer,
                )}
              >
                <label className="studio-control">
                  <span>{t("Campo de destino")}</span>
                  <select
                    aria-label={t("Destino %{field}", { field: field })}
                    value={field}
                    onChange={(event) => {
                      const next = { ...action.output };
                      delete next[field];
                      next[event.target.value] = pointer;
                      onChange({ ...action, output: next });
                    }}
                  >
                    {!fields[field] && (
                      <option value={field}>
                        {t("Campo no disponible:")} {field}
                      </option>
                    )}
                    {Object.entries(fields)
                      .filter(
                        ([name]) => name === field || !(name in action.output),
                      )
                      .map(([name, definition]) => (
                        <option key={name} value={name}>
                          {definition.label ?? name} ({name})
                        </option>
                      ))}
                  </select>
                </label>
                <label className="studio-control">
                  <span>{t("Ruta en la respuesta")}</span>
                  <Input
                    aria-label={t("Ruta para %{field}", { field: field })}
                    value={pointer}
                    aria-invalid={!/^\/[a-zA-Z0-9_/]+$/.test(pointer)}
                    onChange={(event) =>
                      onChange({
                        ...action,
                        output: {
                          ...action.output,
                          [field]: event.target.value,
                        },
                      })
                    }
                  />
                </label>
                {!/^\/[a-zA-Z0-9_/]+$/.test(pointer) && (
                  <p role="alert" className="text-sm text-destructive">
                    {t("Usa una ruta como /data/vehicle/year.")}
                  </p>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const next = { ...action.output };
                    delete next[field];
                    onChange({ ...action, output: next });
                  }}
                >
                  {t("Quitar asignación")}
                </Button>
              </div>
            </details>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={
            !Object.keys(fields).some((name) => !(name in action.output))
          }
          onClick={() => {
            const field = Object.keys(fields).find(
              (name) => !(name in action.output),
            );
            if (field)
              onChange({
                ...action,
                output: { ...action.output, [field]: "/data" },
              });
          }}
        >
          {t("Agregar campo de salida")}
        </Button>
      </section>
    </div>
  );
}
