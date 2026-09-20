import { useMessages } from "@/i18n/core";
import { automationMessages } from "@/i18n/locales/automation";
import { useQuery } from "@tanstack/react-query";
import {
  requestOperations,
  createLookupActionFromOperation,
  resolveRequestActionLabel,
  DEFAULT_LOOKUP_BUTTON_STYLE,
  DEFAULT_LOOKUP_EVENT_DEBOUNCE_MS,
  DEFAULT_LOOKUP_ICON,
  DEFAULT_LOOKUP_PLACEMENT,
  lookupEventDebounceMsSchema,
  LOOKUP_BUTTON_STYLE_LABELS,
  LOOKUP_PLACEMENT_LABELS,
  lookupButtonStyleSchema,
  lookupIconSchema,
  lookupPlacementSchema,
  resolveLookupButtonStyle,
  type LookupButtonStyle,
  type LookupPlacement,
  type RequestPageConfig,
  type RequestAction,
} from "@savia/crm-shared/request-page";
import { requestPageApi } from "./request-page-api";
import type { CrmObject } from "@savia/crm-shared/metadata";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LookupActionButtonContent } from "./lookup-action-button";
import { LookupIconPicker } from "./lookup-icon-picker";
import { LookupOperationPicker } from "./lookup-operation-picker";
import { LookupTriggerEventTags } from "./lookup-trigger-event-tags";
import {
  LocalizedFieldLabelEditor,
  useFieldLabelLocale,
} from "./localized-field-label-editor";
import { propertySearchTerms } from "@savia/crm-shared/property-panel-search";
import { StudioControlLabel } from "./studio-control-label";

const lookupButtonStyleHelp =
  "Elige si el botón muestra solo un icono o texto visible junto al campo.";
const accessibleLabelHelp =
  "Se usa en lectores de pantalla y al pasar el cursor sobre el icono.";
const placementHelp =
  "Define dónde aparece el botón de consulta respecto al campo.";
const requestMappingHelp =
  "Vincula las entradas del request con campos del formulario y asigna rutas de la respuesta a otros campos.";

export function RequestActionsEditor({
  fieldId,
  fields,
  config,
  onChange,
}: {
  fieldId: string;
  fields: CrmObject["config"]["fields"];
  config: RequestPageConfig;
  onChange: (config: RequestPageConfig) => void;
}) {
  const t = useMessages(automationMessages);

  const catalog = useQuery({
    queryKey: ["request-page-action-catalog"],
    queryFn: async () =>
      requestOperations(await requestPageApi("/openapi.json")),
  });
  const labelLocale = useFieldLabelLocale();
  const actions = config.actions.filter(
    (a) => a.kind === "lookup" && Object.values(a.input)[0] === fieldId,
  );
  const update = (action: RequestAction) =>
    onChange({
      ...config,
      actions: config.actions.map((a) => (a.id === action.id ? action : a)),
    });
  const options = Object.entries(fields).map(([id, f]) => (
    <option key={id} value={id}>
      {f.label} ({id})
    </option>
  ));
  return (
    <div className="studio-request-actions">
      {catalog.isError && <p role="alert">{catalog.error.message}</p>}
      {actions.map((action) => {
        const previewLabel = resolveRequestActionLabel(action, labelLocale);
        const requestLabel =
          catalog.data?.find((o) => o.id === action.id)?.label ?? action.id;
        return (
          <div key={action.id} className="studio-request-action-card">
            <label
              className="studio-control"
              data-property-search={propertySearchTerms(
                t("Estilo del botón"),
                t("texto icono solo"),
              )}
            >
              <StudioControlLabel
                label={t("Estilo del botón")}
                help={t(lookupButtonStyleHelp)}
              />
              <select
                aria-label={t("Estilo del botón")}
                value={action.buttonStyle ?? DEFAULT_LOOKUP_BUTTON_STYLE}
                onChange={(e) => {
                  const buttonStyle = lookupButtonStyleSchema.parse(
                    e.target.value,
                  );
                  update({
                    ...action,
                    buttonStyle,
                    icon:
                      buttonStyle === "icon"
                        ? (action.icon ?? DEFAULT_LOOKUP_ICON)
                        : undefined,
                  });
                }}
              >
                {(
                  Object.keys(LOOKUP_BUTTON_STYLE_LABELS) as LookupButtonStyle[]
                ).map((value) => (
                  <option key={value} value={value}>
                    {t(
                      LOOKUP_BUTTON_STYLE_LABELS[
                        value
                      ] as keyof typeof automationMessages,
                    )}
                  </option>
                ))}
              </select>
            </label>
            {resolveLookupButtonStyle(action) === "icon" ? (
              <>
                <label
                  className="studio-control"
                  data-property-search={propertySearchTerms(
                    t("Icono"),
                    t("lupa lookup"),
                  )}
                >
                  {t("Icono")}
                  <LookupIconPicker
                    aria-label={t("Icono del botón")}
                    value={action.icon ?? DEFAULT_LOOKUP_ICON}
                    onChange={(icon) =>
                      update({
                        ...action,
                        icon: lookupIconSchema.parse(icon),
                      })
                    }
                  />
                </label>
                <label
                  className="studio-control"
                  data-property-search={propertySearchTerms(
                    t("Etiqueta accesible"),
                    t("label traducción aria title"),
                  )}
                >
                  <StudioControlLabel
                    label={t("Etiqueta accesible")}
                    help={t(accessibleLabelHelp)}
                  />
                  <LocalizedFieldLabelEditor
                    field={action}
                    onChange={({ label, labels }) =>
                      update({ ...action, label, labels })
                    }
                  />
                </label>
                <div
                  className="studio-lookup-preview"
                  data-property-search={propertySearchTerms(
                    t("Vista previa"),
                    t("botón preview"),
                  )}
                >
                  <span className="studio-lookup-preview-label">
                    {t("Vista previa")}
                  </span>
                  <Button
                    type="button"
                    variant="default"
                    size="icon"
                    className="size-9 shrink-0"
                    aria-label={previewLabel}
                    title={previewLabel}
                    disabled
                  >
                    <LookupActionButtonContent
                      action={action}
                      busy={false}
                      label={previewLabel}
                    />
                  </Button>
                </div>
              </>
            ) : (
              <label
                className="studio-control"
                data-property-search={propertySearchTerms(
                  t("Texto del botón"),
                  t("label traducción"),
                )}
              >
                {t("Texto del botón")}
                <LocalizedFieldLabelEditor
                  field={action}
                  onChange={({ label, labels }) =>
                    update({ ...action, label, labels })
                  }
                />
              </label>
            )}
            <label
              className="studio-control"
              data-property-search={propertySearchTerms(
                t("Posición del botón"),
                t("inline debajo campo placement"),
              )}
            >
              <StudioControlLabel
                label={t("Posición del botón")}
                help={t(placementHelp)}
              />
              <select
                aria-label={t("Posición del botón")}
                value={action.placement ?? DEFAULT_LOOKUP_PLACEMENT}
                onChange={(e) =>
                  update({
                    ...action,
                    placement: lookupPlacementSchema.parse(e.target.value),
                  })
                }
              >
                {(
                  Object.keys(LOOKUP_PLACEMENT_LABELS) as LookupPlacement[]
                ).map((value) => (
                  <option key={value} value={value}>
                    {t(
                      LOOKUP_PLACEMENT_LABELS[
                        value
                      ] as keyof typeof automationMessages,
                    )}
                  </option>
                ))}
              </select>
            </label>
            <LookupTriggerEventTags
              events={action.events}
              onChange={(events) =>
                update({
                  ...action,
                  events,
                  eventDebounce: events?.length
                    ? action.eventDebounce
                    : undefined,
                  eventDebounceMs:
                    events?.length && action.eventDebounce
                      ? action.eventDebounceMs
                      : undefined,
                })
              }
            />
            {(action.events?.length ?? 0) > 0 && (
              <div className="lookup-trigger-debounce">
                <label className="lookup-trigger-debounce-toggle">
                  <input
                    type="checkbox"
                    checked={action.eventDebounce ?? false}
                    onChange={(event) =>
                      update({
                        ...action,
                        eventDebounce: event.target.checked,
                        eventDebounceMs: event.target.checked
                          ? (action.eventDebounceMs ??
                            DEFAULT_LOOKUP_EVENT_DEBOUNCE_MS)
                          : undefined,
                      })
                    }
                  />
                  <span>{t("Debounce")}</span>
                </label>
                {action.eventDebounce ? (
                  <label className="studio-control lookup-trigger-debounce-ms">
                    <span>{t("Espera (ms)")}</span>
                    <Input
                      type="number"
                      min={0}
                      max={10000}
                      step={50}
                      aria-label={t("Espera del debounce en milisegundos")}
                      value={
                        action.eventDebounceMs ??
                        DEFAULT_LOOKUP_EVENT_DEBOUNCE_MS
                      }
                      onChange={(event) => {
                        const parsed = lookupEventDebounceMsSchema.safeParse(
                          Number(event.target.value),
                        );
                        if (!parsed.success) return;
                        update({
                          ...action,
                          eventDebounce: true,
                          eventDebounceMs: parsed.data,
                        });
                      }}
                    />
                  </label>
                ) : null}
              </div>
            )}
            <details
              className="studio-property-subsection"
              data-property-search={propertySearchTerms(
                t("Mapeo del request"),
                t("entradas respuesta asignación pointer output input"),
              )}
            >
              <summary>
                <StudioControlLabel
                  label={t("Mapeo del request")}
                  help={t(requestMappingHelp)}
                />
              </summary>
              <div className="studio-property-subsection-body">
                <p className="studio-request-meta">
                  {t("Request:")} <strong>{requestLabel}</strong>
                </p>
                <p className="studio-request-section-label">{t("Entradas")}</p>
                {Object.entries(action.input).map(
                  ([parameter, target], index) => (
                    <label className="studio-control" key={parameter}>
                      {parameter}
                      <select
                        aria-label={t("Entrada %{parameter}", {
                          parameter: parameter,
                        })}
                        value={target}
                        disabled={index === 0}
                        onChange={(e) =>
                          update({
                            ...action,
                            input: {
                              ...action.input,
                              [parameter]: e.target.value,
                            },
                          })
                        }
                      >
                        {options}
                      </select>
                    </label>
                  ),
                )}
                <p className="studio-request-section-label">{t("Respuesta")}</p>
                {Object.entries(action.output).map(([target, pointer]) => (
                  <div key={target} className="studio-request-output-row">
                    <label className="studio-control">
                      {t("Campo de destino")}
                      <select
                        value={target}
                        onChange={(e) => {
                          const output = { ...action.output };
                          delete output[target];
                          output[e.target.value] = pointer;
                          update({ ...action, output });
                        }}
                      >
                        {options.filter(
                          (o) =>
                            o.key === target ||
                            !Object.hasOwn(action.output, String(o.key)),
                        )}
                      </select>
                    </label>
                    <label className="studio-control">
                      {t("Ruta en la respuesta")}
                      <Input
                        placeholder={t("/data/vehicle/year")}
                        value={pointer}
                        onChange={(e) =>
                          update({
                            ...action,
                            output: {
                              ...action.output,
                              [target]: e.target.value,
                            },
                          })
                        }
                      />
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const output = { ...action.output };
                        delete output[target];
                        update({ ...action, output });
                      }}
                    >
                      {t("Quitar asignación")}
                    </Button>
                  </div>
                ))}
                <div className="studio-request-actions-row">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      Object.keys(action.output).length >=
                      Object.keys(fields).length
                    }
                    onClick={() => {
                      const target = Object.keys(fields).find(
                        (id) => !Object.hasOwn(action.output, id),
                      );
                      if (target)
                        update({
                          ...action,
                          output: {
                            ...action.output,
                            [target]: t("/data/vehicle/year"),
                          },
                        });
                    }}
                  >
                    {t("Añadir asignación")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      onChange({
                        ...config,
                        actions: config.actions.filter(
                          (a) => a.id !== action.id,
                        ),
                      })
                    }
                  >
                    {t("Eliminar consulta")}
                  </Button>
                </div>
              </div>
            </details>
          </div>
        );
      })}
      <div
        className="studio-control"
        data-property-search={propertySearchTerms(
          t("Añadir consulta"),
          t("buscar request lookup"),
        )}
      >
        {t("Añadir consulta")}
        <LookupOperationPicker
          operations={catalog.data ?? []}
          excludedIds={config.actions.map((action) => action.id)}
          pending={catalog.isPending}
          disabled={catalog.isError}
          onSelect={(operation) =>
            onChange({
              ...config,
              actions: [
                ...config.actions,
                createLookupActionFromOperation(operation, fieldId, fields),
              ],
            })
          }
        />
      </div>
      {config.actions
        .filter((a) => Object.hasOwn(a.output, fieldId))
        .map((a) => (
          <p className="studio-request-meta" key={a.id}>
            {t("Recibe datos de «")}
            {resolveRequestActionLabel(a, labelLocale)}»:{" "}
            <code>{a.output[fieldId]}</code>
          </p>
        ))}
    </div>
  );
}
