import { useMessages } from "@/i18n/core";
import { automationMessages } from "@/i18n/locales/automation";
import { WorkflowDestinationPicker } from "./workflow-webhooks";
import { TriggerConditions } from "./workflow-trigger-conditions";
import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fieldEntries, type StudioObject } from "@savia/studio-shared/metadata";
import { api } from "./api";
import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowValue,
} from "@savia/studio-shared/workflows";
import type { WorkflowPiece } from "@savia/studio-shared/workflow-pieces";
import { cronNextOccurrence } from "@savia/studio-shared/workflow-cron";

export const stepLabels: Record<
  WorkflowNode["type"],
  keyof typeof automationMessages
> = {
  webhook: "Enviar webhook",
  condition: "Condición",
  switch: "Derivación múltiple",
  map: "Transformar lista",
  bulkUpdate: "Actualizar en lote",
  loop: "Repetir lista",
  http: "Petición HTTP",
  subflow: "Subflujo",
  piece: "Pieza",
  approval: "Aprobación",
  parallel: "Ramas paralelas",
  merge: "Unir ramas",
  transform: "Transformar datos",
  query: "Consultar registros",
  create: "Crear registro",
  update: "Actualizar registro",
  task: "Crear tarea",
  notification: "Notificación interna",
  email: "Enviar correo",
  delay: "Esperar",
};
export function newStep(
  type: WorkflowNode["type"],
  id: string,
  collection: string,
): WorkflowNode {
  const base = { id };
  switch (type) {
    case "webhook":
      return {
        ...base,
        type,
        destinationId: "",
        destinationRevision: 1,
        values: {},
      };
    case "condition":
      return { ...base, type, left: "", operator: "eq", right: "" };
    case "switch":
      return {
        ...base,
        type,
        input: "",
        cases: [{ operator: "eq", value: "" }],
      };
    case "map":
      return { ...base, type, items: { ref: "trigger.id" }, values: {} };
    case "bulkUpdate":
      return {
        ...base,
        type,
        collection,
        items: { ref: "trigger.id" },
        values: {},
      };
    case "loop":
      return { ...base, type, items: { ref: "trigger.id" }, body: "" };
    case "http":
      return {
        ...base,
        type,
        method: "GET",
        url: "",
        headers: {},
        query: {},
      };
    case "subflow":
      return { ...base, type, workflowId: "", workflowVersion: "", input: {} };
    case "piece":
      return { ...base, type, pieceId: "", pieceVersion: 1, config: {} };
    case "approval":
      return {
        ...base,
        type,
        title: "",
        assignee: { ref: "system.owner" },
        dueDays: 1,
      };
    case "parallel":
      return { ...base, type, branches: [""] };
    case "merge":
      return { ...base, type };
    case "transform":
      return { ...base, type, values: {} };
    case "query":
      return { ...base, type, collection, field: "", value: "", limit: 20 };
    case "create":
      return { ...base, type, collection, values: {} };
    case "update":
      return {
        ...base,
        type,
        collection,
        recordId: { ref: "trigger.id" },
        values: {},
      };
    case "task":
      return {
        ...base,
        type,
        title: "",
        assignee: { ref: "system.owner" },
        dueDays: 1,
      };
    case "notification":
      return { ...base, type, title: "", assignee: { ref: "system.owner" } };
    case "email":
      return { ...base, type, to: "", subject: "", body: "" };
    case "delay":
      return { ...base, type, seconds: 60 };
  }
}
export function ValueInput({
  label,
  value,
  onChange,
  variables,
}: {
  label: string;
  value: WorkflowValue;
  onChange: (v: WorkflowValue) => void;
  variables: string[];
}) {
  const t = useMessages(automationMessages);

  const id = useId(),
    kind =
      value === null
        ? "null"
        : typeof value === "object"
          ? "concat" in value
            ? "concat"
            : "dateOffset" in value
              ? "dateOffset"
              : "ref"
          : typeof value;
  return (
    <div className="wf-value">
      <label htmlFor={id}>{label}</label>
      <div>
        <select
          aria-label={t("Tipo de %{label}", { label: label })}
          value={kind}
          onChange={(e) =>
            onChange(
              e.target.value === "concat"
                ? { concat: [""] }
                : e.target.value === "dateOffset"
                  ? { dateOffset: { value: "", days: 0 } }
                  : e.target.value === "ref"
                    ? { ref: variables[0] ?? "system.owner" }
                    : e.target.value === "number"
                      ? 0
                      : e.target.value === "boolean"
                        ? false
                        : e.target.value === "null"
                          ? null
                          : "",
            )
          }
        >
          <option value="string">{t("Texto")}</option>
          <option value="number">{t("Número")}</option>
          <option value="boolean">{t("Sí / No")}</option>
          <option value="null">{t("Vacío")}</option>
          <option value="ref">{t("Variable")}</option>
          <option value="concat">{t("Combinar textos")}</option>
          <option value="dateOffset">{t("Desplazar fecha")}</option>
        </select>
        {typeof value === "object" && value && "concat" in value ? (
          <fieldset>
            <legend>{t("Partes del texto")}</legend>
            {value.concat.map((part, index) => (
              <div key={index}>
                <ValueInput
                  label={t("Parte %{value0}", { value0: index + 1 })}
                  value={part}
                  variables={variables}
                  onChange={(next) =>
                    onChange({
                      concat: value.concat.map((item, i) =>
                        i === index ? next : item,
                      ),
                    })
                  }
                />
                <Button
                  variant="ghost"
                  disabled={value.concat.length === 1}
                  onClick={() =>
                    onChange({
                      concat: value.concat.filter((_, i) => i !== index),
                    })
                  }
                >
                  {t("Quitar parte")}
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              disabled={value.concat.length >= 12}
              onClick={() => onChange({ concat: [...value.concat, ""] })}
            >
              {t("Añadir parte")}
            </Button>
          </fieldset>
        ) : typeof value === "object" && value && "dateOffset" in value ? (
          <fieldset>
            <legend>{t("Fecha relativa")}</legend>
            <ValueInput
              label={t("Fecha base")}
              value={value.dateOffset.value}
              variables={variables}
              onChange={(next) =>
                onChange({ dateOffset: { ...value.dateOffset, value: next } })
              }
            />
            <label>
              {t("Días antes (negativo) o después")}
              <Input
                type="number"
                min={-3660}
                max={3660}
                value={value.dateOffset.days}
                onChange={(e) =>
                  onChange({
                    dateOffset: {
                      ...value.dateOffset,
                      days: Number(e.target.value),
                    },
                  })
                }
              />
            </label>
          </fieldset>
        ) : kind === "boolean" ? (
          <select
            id={id}
            value={String(value)}
            onChange={(e) => onChange(e.target.value === "true")}
          >
            <option value="true">{t("Sí")}</option>
            <option value="false">{t("No")}</option>
          </select>
        ) : kind !== "null" ? (
          <Input
            id={id}
            type={kind === "number" ? "number" : "text"}
            list={kind === "ref" ? `${id}-options` : undefined}
            value={
              typeof value === "object"
                ? value && "ref" in value
                  ? value.ref
                  : ""
                : String(value)
            }
            onChange={(e) =>
              onChange(
                kind === "ref"
                  ? { ref: e.target.value }
                  : kind === "number"
                    ? Number(e.target.value)
                    : e.target.value,
              )
            }
          />
        ) : null}
      </div>
      <datalist id={`${id}-options`}>
        {variables.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
    </div>
  );
}
function Mappings({
  values,
  onChange,
  fields,
  variables,
  legend,
}: {
  values: Record<string, WorkflowValue>;
  onChange: (v: Record<string, WorkflowValue>) => void;
  fields: string[];
  variables: string[];
  legend?: keyof typeof automationMessages & string;
}) {
  const t = useMessages(automationMessages);

  return (
    <fieldset>
      <legend>{t(legend ?? "Valores de salida")}</legend>
      {Object.entries(values).map(([key, value], index) => (
        <div className="wf-mapping" key={index}>
          {fields.length ? (
            <select
              aria-label={t("Campo %{value0}", { value0: index + 1 })}
              value={key}
              onChange={(e) => {
                const next = { ...values };
                delete next[key];
                next[e.target.value] = value;
                onChange(next);
              }}
            >
              <option value={key}>{key}</option>
              {fields
                .filter((f) => f !== key && !Object.hasOwn(values, f))
                .map((f) => (
                  <option key={f}>{f}</option>
                ))}
            </select>
          ) : (
            <Input
              aria-label={t("Campo %{value0}", { value0: index + 1 })}
              value={key}
              onChange={(e) => {
                const next = Object.fromEntries(
                  Object.entries(values).map(([k, v]) => [
                    k === key ? e.target.value : k,
                    v,
                  ]),
                );
                onChange(next);
              }}
            />
          )}
          <ValueInput
            label={t("Valor %{value0}", { value0: index + 1 })}
            value={value}
            onChange={(v) => onChange({ ...values, [key]: v })}
            variables={variables}
          />
          <Button
            variant="ghost"
            onClick={() => {
              const next = { ...values };
              delete next[key];
              onChange(next);
            }}
            aria-label={t("Quitar campo %{key}", { key: key })}
          >
            {t("Quitar")}
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        onClick={() => {
          const key =
            fields.find((f) => !Object.hasOwn(values, f)) ??
            `value_${Object.keys(values).length + 1}`;
          onChange({ ...values, [key]: "" });
        }}
      >
        {t("Añadir valor")}
      </Button>
    </fieldset>
  );
}
const CRON_PRESETS = [
  { label: "Cada hora", expression: "0 * * * *" },
  { label: "Diario", expression: "0 0 * * *" },
  { label: "Semanal", expression: "0 0 * * 1" },
  { label: "Mensual", expression: "0 0 1 * *" },
];
function ScheduleCronEditor({
  trigger,
  onChange,
}: {
  trigger: Extract<WorkflowDefinition["trigger"], { type: "schedule" }>;
  onChange: (v: WorkflowDefinition["trigger"]) => void;
}) {
  const t = useMessages(automationMessages);
  const upcoming: string[] = [];
  let invalid = trigger.cron === undefined || trigger.cron.trim() === "";
  if (!invalid) {
    try {
      let from = Date.now();
      for (let i = 0; i < 3; i++) {
        const at = cronNextOccurrence(trigger.cron!, from);
        if (at === null) break;
        upcoming.push(
          new Date(at).toISOString().slice(0, 16).replace("T", " "),
        );
        from = at;
      }
      invalid = upcoming.length === 0;
    } catch {
      invalid = true;
    }
  }
  return (
    <>
      <label>
        {t("Expresión cron")}
        <Input
          value={trigger.cron ?? ""}
          placeholder="0 9 * * 1"
          onChange={(e) => onChange({ ...trigger, cron: e.target.value })}
        />
      </label>
      <div className="wf-actions">
        {CRON_PRESETS.map((preset) => (
          <Button
            key={preset.expression}
            variant="outline"
            onClick={() => onChange({ ...trigger, cron: preset.expression })}
          >
            {t(preset.label as keyof typeof automationMessages & string)}
          </Button>
        ))}
      </div>
      {invalid ? (
        <p className="wf-muted">
          {t("La expresión cron no es válida o nunca ocurre.")}
        </p>
      ) : (
        <p className="wf-muted">
          {t("Próximas ejecuciones:")} {upcoming.join(" · ")}
        </p>
      )}
    </>
  );
}
export function relationConditionFields(
  objects: StudioObject[],
  object: StudioObject | undefined,
): { name: string; label: string }[] {
  if (!object) return [];
  const fields: { name: string; label: string }[] = [];
  for (const [name, field] of fieldEntries(object)) {
    const target = field.config?.relation;
    if (!target || typeof target !== "string" || target === object.name)
      continue;
    if (field.config?.multiple) continue;
    const targetObject = objects.find((o) => o.name === target);
    if (!targetObject) continue;
    for (const [targetName, targetField] of fieldEntries(targetObject))
      fields.push({
        name: `related.${name}.${targetName}`,
        label: `${field.label} → ${targetField.label}`,
      });
  }
  return fields;
}
export function TriggerEditor({
  definition,
  onChange,
  objects,
}: {
  definition: WorkflowDefinition;
  onChange: (v: WorkflowDefinition) => void;
  objects: StudioObject[];
}) {
  const t = useMessages(automationMessages);

  const trigger = definition.trigger;
  const set = (value: WorkflowDefinition["trigger"]) =>
    onChange({ ...definition, trigger: value });
  return (
    <fieldset className="wf-trigger">
      <legend>{t("Cuándo se inicia")}</legend>
      <label>
        {t("Disparador")}
        <select
          value={trigger.type}
          onChange={(e) => {
            const type = e.target.value as typeof trigger.type;
            set(
              type === "manual" || type === "webhook"
                ? { type }
                : type === "schedule"
                  ? {
                      type,
                      intervalMinutes: 60,
                      startAt: new Date().toISOString(),
                    }
                  : type === "updated" ||
                      type === "created_or_updated" ||
                      type === "validate"
                    ? {
                        type,
                        collection: objects[0]?.name ?? "",
                        changedFields: [],
                      }
                    : { type, collection: objects[0]?.name ?? "" },
            );
          }}
        >
          <option value="manual">{t("Acción manual")}</option>
          <option value="webhook">{t("Webhook recibido")}</option>
          <option value="created">{t("Registro creado")}</option>
          <option value="updated">{t("Registro actualizado")}</option>
          <option value="created_or_updated">
            {t("Registro creado o actualizado")}
          </option>
          <option value="validate">{t("Validación pre-guardado")}</option>
          <option value="deleted">{t("Registro eliminado")}</option>
          <option value="schedule">{t("Programación")}</option>
        </select>
      </label>
      {trigger.type === "webhook" ? (
        <p className="wf-muted">
          {t(
            "Un sistema externo inicia este flujo mediante una solicitud autenticada.",
          )}
        </p>
      ) : trigger.type !== "schedule" ? (
        <label>
          {t("Colección")}
          <select
            value={trigger.collection ?? ""}
            onChange={(e) =>
              set({
                ...trigger,
                collection: e.target.value || undefined,
                ...("conditions" in trigger || trigger.type !== "manual"
                  ? { conditions: [] }
                  : {}),
                ...("changedFields" in trigger ? { changedFields: [] } : {}),
              } as typeof trigger)
            }
          >
            <option value="">
              {trigger.type === "manual"
                ? t("Sin registro asociado")
                : t("Selecciona una colección")}
            </option>
            {objects.map((o) => (
              <option key={o.name} value={o.name}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <label>
            {t("Modo de programación")}
            <select
              value={trigger.cron === undefined ? "interval" : "cron"}
              onChange={(e) =>
                set(
                  e.target.value === "cron"
                    ? {
                        type: "schedule",
                        cron: "0 * * * *",
                        startAt: trigger.startAt,
                      }
                    : {
                        type: "schedule",
                        intervalMinutes: 60,
                        startAt: trigger.startAt,
                      },
                )
              }
            >
              <option value="interval">{t("Intervalo fijo")}</option>
              <option value="cron">{t("Expresión cron")}</option>
            </select>
          </label>
          {trigger.cron === undefined ? (
            <label>
              {t("Intervalo en minutos")}
              <Input
                type="number"
                min={1}
                value={trigger.intervalMinutes ?? 60}
                onChange={(e) =>
                  set({ ...trigger, intervalMinutes: Number(e.target.value) })
                }
              />
            </label>
          ) : (
            <ScheduleCronEditor trigger={trigger} onChange={set} />
          )}
          <label>
            {t("Inicio (UTC)")}
            <Input
              type="datetime-local"
              value={trigger.startAt.slice(0, 16)}
              onChange={(e) => {
                if (e.target.value)
                  set({
                    ...trigger,
                    startAt: new Date(`${e.target.value}Z`).toISOString(),
                  });
              }}
            />
          </label>
        </>
      )}
      {trigger.type === "updated" ||
      trigger.type === "created_or_updated" ||
      trigger.type === "validate" ? (
        <label>
          {t("Campos que deben cambiar")}
          <select
            multiple
            value={trigger.changedFields}
            onChange={(e) =>
              set({
                ...trigger,
                changedFields: Array.from(
                  e.target.selectedOptions,
                  (o) => o.value,
                ),
              })
            }
          >
            {fieldEntries(
              objects.find((o) => o.name === trigger.collection) ??
                ({ config: { fields: {} } } as StudioObject),
            ).map(([key, field]) => (
              <option key={key} value={key}>
                {field.label}
              </option>
            ))}
          </select>
          <small>
            {t(
              "Sin selección: cualquier cambio de datos. Basta con que cambie uno de los campos seleccionados.",
            )}
          </small>
          {trigger.type === "created_or_updated" && (
            <small>
              {t(
                "Al crear, se evalúan las condiciones sin exigir cambios en estos campos.",
              )}
            </small>
          )}
        </label>
      ) : null}
      {trigger.type === "deleted" && (
        <p className="wf-muted">
          {t(
            "El flujo recibe los datos del registro eliminado. Vaciar la papelera no vuelve a iniciarlo.",
          )}
        </p>
      )}
      {trigger.type === "validate" && (
        <p className="wf-muted">
          {t(
            "Rechaza el guardado cuando las condiciones coinciden con el estado prohibido; si el registro pasa, los pasos se ejecutan como en creado o actualizado.",
          )}
        </p>
      )}
      {trigger.type === "created" ||
      trigger.type === "updated" ||
      trigger.type === "created_or_updated" ||
      trigger.type === "validate" ||
      trigger.type === "deleted" ? (
        <TriggerConditions
          conditions={trigger.conditions ?? []}
          mode={trigger.conditionMode ?? "all"}
          fields={[
            ...fieldEntries(
              objects.find((o) => o.name === trigger.collection) ??
                ({ config: { fields: {} } } as StudioObject),
            ).map(([name, field]) => ({ name, label: field.label })),
            ...relationConditionFields(
              objects,
              objects.find((o) => o.name === trigger.collection),
            ),
            { name: "id", label: t("ID del registro") },
          ]}
          onChange={(conditions) => set({ ...trigger, conditions })}
          onModeChange={(conditionMode) => set({ ...trigger, conditionMode })}
        />
      ) : null}
    </fieldset>
  );
}
type FlowSummary = {
  id: string;
  name: string;
  revision: number;
  published_version: string | null;
};
type FlowDetail = FlowSummary & { definition: WorkflowDefinition };

function SubflowPicker({
  value,
  workflowId,
  objects,
  variables,
  onChange,
}: {
  value: Extract<WorkflowNode, { type: "subflow" }>;
  workflowId?: string;
  objects: StudioObject[];
  variables: string[];
  onChange: (v: Extract<WorkflowNode, { type: "subflow" }>) => void;
}) {
  const t = useMessages(automationMessages);
  const list = useQuery({
    queryKey: ["workflow-children"],
    queryFn: () => api<{ data: FlowSummary[] }>("/workflows"),
  });
  const child = useQuery({
    queryKey: ["workflow-child", value.workflowId],
    enabled: !!value.workflowId,
    queryFn: () => api<{ data: FlowDetail }>(`/workflows/${value.workflowId}`),
  });
  const trigger = child.data?.data.definition.trigger;
  const triggerFields =
    trigger && "collection" in trigger && trigger.collection
      ? fieldEntries(
          objects.find((o) => o.name === trigger.collection) ??
            ({ config: { fields: {} } } as StudioObject),
        ).map(([name]) => name)
      : [];
  return (
    <section aria-label={t("Flujo hijo")}>
      <label>
        {t("Flujo hijo")}
        <select
          value={value.workflowId}
          onChange={(e) =>
            onChange({
              ...value,
              workflowId: e.target.value,
              workflowVersion: "",
            })
          }
        >
          <option value="">{t("Selecciona un flujo")}</option>
          {(list.data?.data ?? [])
            .filter((flow) => flow.id !== workflowId)
            .map((flow) => (
              <option key={flow.id} value={flow.id}>
                {flow.name}
                {flow.published_version ? "" : t(" · sin publicar")}
              </option>
            ))}
        </select>
      </label>
      {child.data ? (
        child.data.data.published_version ? (
          <p className="wf-muted">
            {t("Versión publicada:")} {child.data.data.published_version}.{" "}
            {value.workflowVersion === child.data.data.published_version
              ? t("Versión fijada.")
              : null}
          </p>
        ) : (
          <p className="wf-muted">{t("Publica el flujo hijo primero.")}</p>
        )
      ) : null}
      {child.data?.data.published_version &&
      value.workflowVersion !== child.data.data.published_version ? (
        <Button
          variant="outline"
          onClick={() =>
            onChange({
              ...value,
              workflowVersion: child.data!.data.published_version!,
            })
          }
        >
          {t("Usar versión publicada")}
        </Button>
      ) : null}
      <Mappings
        legend="Entrada"
        values={value.input ?? {}}
        onChange={(input) => onChange({ ...value, input })}
        fields={triggerFields}
        variables={variables}
      />
    </section>
  );
}

function PieceSection({
  value,
  variables,
  onChange,
}: {
  value: Extract<WorkflowNode, { type: "piece" }>;
  variables: string[];
  onChange: (v: Extract<WorkflowNode, { type: "piece" }>) => void;
}) {
  const t = useMessages(automationMessages);
  const list = useQuery({
    queryKey: ["workflow-pieces"],
    queryFn: () => api<{ data: WorkflowPiece[] }>("/workflow-pieces"),
  });
  const selected = (list.data?.data ?? []).find(
    (piece) =>
      piece.id === value.pieceId && piece.version === value.pieceVersion,
  );
  const versions = (list.data?.data ?? []).filter(
    (piece) => piece.id === value.pieceId,
  );
  const latest = versions.reduce<number | null>(
    (max, piece) => (max === null || piece.version > max ? piece.version : max),
    null,
  );
  return (
    <section aria-label={t("Pieza")}>
      <label>
        {t("Pieza")}
        <select
          value={value.pieceId}
          onChange={(e) =>
            onChange({
              ...value,
              pieceId: e.target.value,
              pieceVersion:
                (list.data?.data ?? []).find(
                  (piece) => piece.id === e.target.value,
                )?.version ?? 1,
              config: {},
            })
          }
        >
          <option value="">{t("Selecciona una pieza")}</option>
          {[
            ...new Map(
              (list.data?.data ?? []).map((piece) => [piece.id, piece]),
            ).values(),
          ].map((piece) => (
            <option key={piece.id} value={piece.id}>
              {piece.label}
            </option>
          ))}
        </select>
      </label>
      {versions.length > 1 ? (
        <label>
          {t("Versión de la pieza")}
          <select
            value={value.pieceVersion}
            onChange={(e) =>
              onChange({ ...value, pieceVersion: Number(e.target.value) })
            }
          >
            {versions.map((piece) => (
              <option key={piece.version} value={piece.version}>
                {piece.version}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {selected?.description ? (
        <p className="wf-muted">{selected.description}</p>
      ) : null}
      {latest !== null && latest !== value.pieceVersion ? (
        <Button
          variant="outline"
          onClick={() => onChange({ ...value, pieceVersion: latest })}
        >
          {t("Usar versión %{value0}", { value0: latest })}
        </Button>
      ) : null}
      {(selected?.inputs ?? []).map((field) => (
        <div key={field.key}>
          {field.type === "select" ? (
            <label>
              {field.label}
              <select
                value={
                  typeof value.config?.[field.key] === "string"
                    ? (value.config[field.key] as string)
                    : ""
                }
                onChange={(e) =>
                  onChange({
                    ...value,
                    config: { ...value.config, [field.key]: e.target.value },
                  })
                }
              >
                <option value="">
                  {field.required ? t("Selecciona un valor") : t("Vacío")}
                </option>
                {(field.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <ValueInput
              label={field.label}
              value={value.config?.[field.key] ?? ""}
              variables={variables}
              onChange={(next) =>
                onChange({
                  ...value,
                  config: { ...value.config, [field.key]: next },
                })
              }
            />
          )}
          {field.hint ? <small>{field.hint}</small> : null}
        </div>
      ))}
    </section>
  );
}

export function StepEditor({
  node,
  definition,
  objects,
  workflowId,
  onChange,
}: {
  node: WorkflowNode;
  definition: WorkflowDefinition;
  objects: StudioObject[];
  workflowId?: string;
  onChange: (v: WorkflowNode) => void;
}) {
  const t = useMessages(automationMessages);
  const listId = useId();
  const catalog = useQuery({
    queryKey: ["workflow-pieces"],
    queryFn: () => api<{ data: WorkflowPiece[] }>("/workflow-pieces"),
  });

  const patch = (value: Partial<WorkflowNode>) =>
    onChange({ ...node, ...value } as WorkflowNode);
  const object =
    "collection" in node
      ? objects.find((o) => o.name === node.collection)
      : undefined;
  const fields = object ? fieldEntries(object).map(([key]) => key) : [];
  const trigger = definition.trigger;
  const triggerObject =
    "collection" in trigger
      ? objects.find((o) => o.name === trigger.collection)
      : undefined;
  const variables = [
    "system.owner",
    "system.workspace",
    "trigger.id",
    ...([
      "created",
      "updated",
      "created_or_updated",
      "validate",
      "deleted",
    ].includes(trigger.type)
      ? ["system.eventType"]
      : []),
    ...(triggerObject
      ? fieldEntries(triggerObject).map(([key]) => `trigger.${key}`)
      : []),
    ...definition.nodes
      .filter((n) => n.id !== node.id)
      .flatMap((n) =>
        n.type === "transform"
          ? [
              ...Object.keys(n.values).map((k) => `steps.${n.id}.${k}`),
              `steps.${n.id}.error`,
            ]
          : n.type === "webhook"
            ? [
                `steps.${n.id}.status`,
                `steps.${n.id}.body`,
                `steps.${n.id}.error`,
              ]
            : n.type === "query"
              ? [`steps.${n.id}.count`, `steps.${n.id}.error`]
              : n.type === "map"
                ? [
                    `steps.${n.id}.items`,
                    `steps.${n.id}.count`,
                    `steps.${n.id}.error`,
                  ]
                : n.type === "bulkUpdate"
                  ? [
                      `steps.${n.id}.updated`,
                      `steps.${n.id}.ids`,
                      `steps.${n.id}.error`,
                    ]
                  : n.type === "loop"
                    ? [
                        `steps.${n.id}.count`,
                        `steps.${n.id}.index`,
                        `steps.${n.id}.item`,
                        `steps.${n.id}.error`,
                      ]
                    : n.type === "http"
                      ? [
                          `steps.${n.id}.status`,
                          `steps.${n.id}.body`,
                          `steps.${n.id}.truncated`,
                          `steps.${n.id}.error`,
                        ]
                      : n.type === "subflow"
                        ? [`steps.${n.id}.steps`, `steps.${n.id}.error`]
                        : n.type === "switch"
                          ? [
                              `steps.${n.id}.value`,
                              `steps.${n.id}.matched`,
                              `steps.${n.id}.branch`,
                              `steps.${n.id}.error`,
                            ]
                          : n.type === "condition"
                            ? [`steps.${n.id}.matches`, `steps.${n.id}.error`]
                            : n.type === "piece"
                              ? [
                                  ...(
                                    (catalog.data?.data ?? []).find(
                                      (piece) =>
                                        piece.id === n.pieceId &&
                                        piece.version === n.pieceVersion,
                                    )?.outputs ?? []
                                  ).map((output) => `steps.${n.id}.${output}`),
                                  `steps.${n.id}.error`,
                                ]
                              : n.type === "parallel"
                                ? [
                                    `steps.${n.id}.branches`,
                                    `steps.${n.id}.count`,
                                    `steps.${n.id}.error`,
                                  ]
                                : n.type === "merge"
                                  ? [
                                      `steps.${n.id}.branches`,
                                      `steps.${n.id}.count`,
                                      `steps.${n.id}.error`,
                                    ]
                                  : n.type === "approval"
                                    ? [
                                        `steps.${n.id}.decision`,
                                        `steps.${n.id}.by`,
                                        `steps.${n.id}.comment`,
                                        `steps.${n.id}.error`,
                                      ]
                                    : [
                                        `steps.${n.id}.id`,
                                        `steps.${n.id}.error`,
                                      ],
      ),
  ];
  if (node.type === "map" || node.type === "bulkUpdate")
    variables.push("item.id");
  const destination = (label: string, key: "next" | "otherwise") => (
    <label>
      {label}
      <select
        value={(node as { next?: string; otherwise?: string })[key] ?? ""}
        onChange={(e) => patch({ [key]: e.target.value || undefined })}
      >
        <option value="">{t("Finalizar")}</option>
        {definition.nodes
          .filter((n) => n.id !== node.id)
          .map((n) => (
            <option key={n.id} value={n.id}>
              {n.label || t(stepLabels[n.type])} · {n.id}
            </option>
          ))}
      </select>
    </label>
  );
  return (
    <section className="wf-config" aria-label={t("Configuración del paso")}>
      <h3>{t(stepLabels[node.type])}</h3>
      <p className="wf-muted">
        {t("Identificador:")} {node.id}
      </p>
      <label>
        {t("Etiqueta")}
        <Input
          value={node.label ?? ""}
          onChange={(e) => patch({ label: e.target.value })}
        />
      </label>
      {"collection" in node ? (
        <label>
          {t("Colección del paso")}
          <select
            value={node.collection}
            onChange={(e) => patch({ collection: e.target.value })}
          >
            <option value="">{t("Selecciona una colección")}</option>
            {objects.map((o) => (
              <option key={o.name} value={o.name}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {node.type === "condition" ? (
        <>
          <ValueInput
            label={t("Valor a comparar")}
            value={node.left}
            onChange={(v) => patch({ left: v })}
            variables={variables}
          />
          <label>
            {t("Operador")}
            <select
              value={node.operator}
              onChange={(e) =>
                patch({ operator: e.target.value as typeof node.operator })
              }
            >
              {[
                "eq",
                "neq",
                "gt",
                "gte",
                "lt",
                "lte",
                "contains",
                "empty",
                "date_after",
              ].map((op, i) => (
                <option key={op} value={op}>
                  {
                    [
                      t("Igual"),
                      t("Distinto"),
                      t("Mayor"),
                      t("Mayor o igual"),
                      t("Menor"),
                      t("Menor o igual"),
                      t("Contiene"),
                      t("Está vacío"),
                      t("Fecha posterior"),
                    ][i]
                  }
                </option>
              ))}
            </select>
          </label>
          <ValueInput
            label={t("Comparar con")}
            value={node.right}
            onChange={(v) => patch({ right: v })}
            variables={variables}
          />
        </>
      ) : null}
      {node.type === "switch" ? (
        <>
          <ValueInput
            label={t("Valor de entrada")}
            value={node.input}
            onChange={(v) => patch({ input: v })}
            variables={variables}
          />
          <fieldset>
            <legend>{t("Ramas")}</legend>
            {node.cases.map((entry, index) => (
              <div className="wf-mapping" key={index}>
                <span aria-hidden="true">
                  {t("Caso %{value0}", { value0: index + 1 })}
                </span>
                <label>
                  {t("Operador")}
                  <select
                    value={entry.operator}
                    onChange={(e) =>
                      patch({
                        cases: node.cases.map((item, i) =>
                          i === index
                            ? {
                                ...item,
                                operator: e.target
                                  .value as typeof item.operator,
                              }
                            : item,
                        ),
                      })
                    }
                  >
                    {[
                      "eq",
                      "neq",
                      "gt",
                      "gte",
                      "lt",
                      "lte",
                      "contains",
                      "date_after",
                    ].map((op, i) => (
                      <option key={op} value={op}>
                        {
                          [
                            t("Igual"),
                            t("Distinto"),
                            t("Mayor"),
                            t("Mayor o igual"),
                            t("Menor"),
                            t("Menor o igual"),
                            t("Contiene"),
                            t("Fecha posterior"),
                          ][i]
                        }
                      </option>
                    ))}
                  </select>
                </label>
                <ValueInput
                  label={t("Comparar con")}
                  value={entry.value}
                  onChange={(v) =>
                    patch({
                      cases: node.cases.map((item, i) =>
                        i === index ? { ...item, value: v } : item,
                      ),
                    })
                  }
                  variables={variables}
                />
                <label>
                  {t("Siguiente paso")}
                  <select
                    value={entry.next ?? ""}
                    onChange={(e) =>
                      patch({
                        cases: node.cases.map((item, i) =>
                          i === index
                            ? {
                                ...item,
                                next: e.target.value || undefined,
                              }
                            : item,
                        ),
                      })
                    }
                  >
                    <option value="">{t("Finalizar")}</option>
                    {definition.nodes
                      .filter((n) => n.id !== node.id)
                      .map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.label || t(stepLabels[n.type])} · {n.id}
                        </option>
                      ))}
                  </select>
                </label>
                <Button
                  variant="ghost"
                  disabled={node.cases.length === 1}
                  onClick={() =>
                    patch({
                      cases: node.cases.filter((_, i) => i !== index),
                    })
                  }
                  aria-label={t("Quitar caso %{value0}", {
                    value0: index + 1,
                  })}
                >
                  {t("Quitar")}
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              disabled={node.cases.length >= 10}
              onClick={() =>
                patch({
                  cases: [...node.cases, { operator: "eq", value: "" }],
                })
              }
            >
              {t("Añadir caso")}
            </Button>
          </fieldset>
        </>
      ) : null}
      {node.type === "map" || node.type === "bulkUpdate" ? (
        <>
          <label>
            {t("Lista de origen")}
            <Input
              list={`${listId}-lists`}
              value={node.items.ref}
              onChange={(e) => patch({ items: { ref: e.target.value } })}
            />
            <datalist id={`${listId}-lists`}>
              {variables.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </label>
          <small>
            {t("Solo referencias a listas, como steps.consulta.records.")}
          </small>
        </>
      ) : null}
      {node.type === "loop" ? (
        <>
          <label>
            {t("Lista de origen")}
            <Input
              list={`${listId}-lists`}
              value={node.items.ref}
              onChange={(e) => patch({ items: { ref: e.target.value } })}
            />
            <datalist id={`${listId}-lists`}>
              {variables.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </label>
          <label>
            {t("Primer paso del cuerpo")}
            <select
              value={node.body}
              onChange={(e) => patch({ body: e.target.value })}
            >
              <option value="">{t("Selecciona un paso")}</option>
              {definition.nodes
                .filter((n) => n.id !== node.id)
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label || t(stepLabels[n.type])} · {n.id}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {t("Máximo de iteraciones")}
            <Input
              type="number"
              min={1}
              max={100}
              value={node.maxIterations ?? 100}
              onChange={(e) => patch({ maxIterations: Number(e.target.value) })}
            />
          </label>
          <p className="wf-muted">
            {t(
              "El cuerpo termina al encadenar pasos; saltar fuera lo interrumpe. Usa steps.<id>.item dentro del cuerpo.",
            )}
          </p>
        </>
      ) : null}
      {node.type === "http" ? (
        <>
          <label>
            {t("Método")}
            <select
              value={node.method}
              onChange={(e) =>
                patch({
                  method: e.target.value as typeof node.method,
                  ...(e.target.value === "GET" || e.target.value === "DELETE"
                    ? { body: undefined }
                    : {}),
                })
              }
            >
              {["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </label>
          <ValueInput
            label={t("URL")}
            value={node.url}
            onChange={(v) => patch({ url: v })}
            variables={variables}
          />
          <Mappings
            legend="Cabeceras"
            values={node.headers ?? {}}
            onChange={(headers) => patch({ headers })}
            fields={[]}
            variables={variables}
          />
          <Mappings
            legend="Parámetros"
            values={node.query ?? {}}
            onChange={(query) => patch({ query })}
            fields={[]}
            variables={variables}
          />
          {node.method !== "GET" && node.method !== "DELETE" ? (
            <Mappings
              legend="Cuerpo JSON"
              values={node.body ?? {}}
              onChange={(body) =>
                patch({ body: Object.keys(body).length ? body : undefined })
              }
              fields={[]}
              variables={variables}
            />
          ) : null}
          <WorkflowDestinationPicker value={node} onChange={patch} />
          {node.destinationId ? (
            <Button
              variant="ghost"
              onClick={() =>
                patch({
                  destinationId: undefined,
                  destinationRevision: undefined,
                })
              }
            >
              {t("Quitar credencial")}
            </Button>
          ) : null}
          <p className="wf-muted">
            {t(
              "Solo HTTPS público. La credencial es opcional y se gestiona como destino.",
            )}
          </p>
        </>
      ) : null}
      {node.type === "piece" ? (
        <PieceSection
          value={node}
          variables={variables}
          onChange={(v) => patch(v)}
        />
      ) : null}
      {node.type === "parallel" ? (
        <fieldset>
          <legend>{t("Ramas")}</legend>
          {node.branches.map((entry, index) => (
            <div className="wf-mapping" key={index}>
              <label>
                {t("Rama %{value0}", { value0: index + 1 })}
                <select
                  value={entry}
                  onChange={(e) =>
                    patch({
                      branches: node.branches.map((item, i) =>
                        i === index ? e.target.value : item,
                      ),
                    })
                  }
                >
                  <option value="">{t("Selecciona un paso")}</option>
                  {definition.nodes
                    .filter((n) => n.id !== node.id)
                    .map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.label || t(stepLabels[n.type])} · {n.id}
                      </option>
                    ))}
                </select>
              </label>
              <Button
                variant="ghost"
                disabled={node.branches.length <= 2}
                onClick={() =>
                  patch({
                    branches: node.branches.filter((_, i) => i !== index),
                  })
                }
                aria-label={t("Quitar rama %{value0}", { value0: index + 1 })}
              >
                {t("Quitar")}
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            disabled={node.branches.length >= 8}
            onClick={() => patch({ branches: [...node.branches, ""] })}
          >
            {t("Añadir rama")}
          </Button>
          <p className="wf-muted">
            {t(
              "Cada rama es una línea recta hasta la misma unión. Sin decisiones ni loops dentro.",
            )}
          </p>
        </fieldset>
      ) : null}
      {node.type === "merge" ? (
        <p className="wf-muted">
          {t(
            "Espera a que todas las ramas entrantes terminen y combina sus resultados en steps.<id>.branches.",
          )}
        </p>
      ) : null}
      {node.type === "approval" ? (
        <>
          <ValueInput
            label={t("Título")}
            value={node.title}
            onChange={(v) => patch({ title: v })}
            variables={variables}
          />
          <ValueInput
            label={t("ID del destinatario")}
            value={node.assignee}
            onChange={(v) => patch({ assignee: v })}
            variables={variables}
          />
          <ValueInput
            label={t("Descripción")}
            value={node.description ?? ""}
            onChange={(v) => patch({ description: v || undefined })}
            variables={variables}
          />
          <label>
            {t("Vence en días")}
            <Input
              type="number"
              min={0}
              max={365}
              value={node.dueDays}
              onChange={(e) => patch({ dueDays: Number(e.target.value) })}
            />
          </label>
          <p className="wf-muted">
            {t(
              "Se aprueba sigue adelante; de lo contrario va a la otra rama, incluido el vencimiento.",
            )}
          </p>
        </>
      ) : null}
      {node.type === "subflow" ? (
        <>
          <SubflowPicker
            value={node}
            workflowId={workflowId}
            objects={objects}
            variables={variables}
            onChange={(v) => patch(v)}
          />
          <p className="wf-muted">
            {t(
              "El hijo corre su versión fijada y devuelve sus pasos en steps.<id>.steps.",
            )}
          </p>
        </>
      ) : null}
      {node.type === "webhook" ? (
        <WorkflowDestinationPicker value={node} onChange={patch} />
      ) : null}
      {"values" in node ? (
        <Mappings
          values={node.values}
          onChange={(values) => patch({ values })}
          fields={fields}
          variables={variables}
        />
      ) : null}
      {node.type === "create" ? (
        <label>
          {t("Evitar duplicados por campo único")}
          <select
            value={node.matchField ?? ""}
            onChange={(e) => patch({ matchField: e.target.value || undefined })}
          >
            <option value="">{t("Crear siempre")}</option>
            {fields
              .filter((field) => {
                const definition = objects.find(
                  (o) => o.name === node.collection,
                )?.config.fields[field];
                return (
                  definition?.config?.unique &&
                  !definition.config.multiple &&
                  ["Textbox", "Dropdown"].includes(definition.type)
                );
              })
              .map((field) => (
                <option key={field} value={field}>
                  {field}
                </option>
              ))}
          </select>
        </label>
      ) : null}
      {node.type === "update" ? (
        <ValueInput
          label={t("ID del registro")}
          value={node.recordId}
          onChange={(v) => patch({ recordId: v })}
          variables={variables}
        />
      ) : null}
      {node.type === "query" ? (
        <>
          <label>
            {t("Campo de búsqueda")}
            <select
              value={node.field}
              onChange={(e) => patch({ field: e.target.value })}
            >
              <option value="">{t("Selecciona un campo")}</option>
              <option value="id">{t("ID del registro")}</option>
              {fields.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          <ValueInput
            label={t("Valor de búsqueda")}
            value={node.value}
            onChange={(v) => patch({ value: v })}
            variables={variables}
          />
          <label>
            {t("Límite de resultados")}
            <Input
              type="number"
              min={1}
              max={100}
              value={node.limit}
              onChange={(e) => patch({ limit: Number(e.target.value) })}
            />
          </label>
        </>
      ) : null}
      {node.type === "task" || node.type === "notification" ? (
        <>
          <ValueInput
            label={t("Título")}
            value={node.title}
            onChange={(v) => patch({ title: v })}
            variables={variables}
          />
          <ValueInput
            label={t("ID del destinatario")}
            value={node.assignee}
            onChange={(v) => patch({ assignee: v })}
            variables={variables}
          />
        </>
      ) : null}
      {node.type === "task" ? (
        <label>
          {t("Vence en días")}
          <Input
            type="number"
            min={0}
            value={node.dueDays}
            onChange={(e) => patch({ dueDays: Number(e.target.value) })}
          />
        </label>
      ) : null}
      {node.type === "email" ? (
        <>
          <ValueInput
            label={t("Destinatario")}
            value={node.to}
            onChange={(v) => patch({ to: v })}
            variables={variables}
          />
          <ValueInput
            label={t("Asunto")}
            value={node.subject}
            onChange={(v) => patch({ subject: v })}
            variables={variables}
          />
          <ValueInput
            label={t("Cuerpo")}
            value={node.body}
            onChange={(v) => patch({ body: v })}
            variables={variables}
          />
          <p className="wf-muted">
            {t(
              "Requiere entrega de correo configurada en el host; sin ella el paso falla visiblemente.",
            )}
          </p>
        </>
      ) : null}
      {node.type === "delay" ? (
        <fieldset>
          <legend>{t("Momento de continuación")}</legend>
          <select
            aria-label={t("Tipo de espera")}
            value={node.until === undefined ? "seconds" : "until"}
            onChange={(e) =>
              patch(
                e.target.value === "seconds"
                  ? { seconds: 60, until: undefined }
                  : { seconds: undefined, until: "" },
              )
            }
          >
            <option value="seconds">{t("Duración en segundos")}</option>
            <option value="until">{t("Hasta una fecha UTC")}</option>
          </select>
          {node.until === undefined ? (
            <label>
              {t("Segundos de espera")}
              <Input
                type="number"
                min={1}
                value={node.seconds ?? 60}
                onChange={(e) => patch({ seconds: Number(e.target.value) })}
              />
            </label>
          ) : (
            <ValueInput
              label={t("Continuar en fecha")}
              value={node.until}
              onChange={(value) => patch({ until: value })}
              variables={variables}
            />
          )}
        </fieldset>
      ) : null}
      <fieldset>
        <legend>{t("Ante un fallo")}</legend>
        <label>
          {t("Política de error")}
          <select
            value={node.onError ?? "fail"}
            onChange={(e) =>
              patch({
                onError: e.target.value === "continue" ? "continue" : undefined,
              })
            }
          >
            <option value="fail">{t("Detener el flujo")}</option>
            <option value="continue">{t("Continuar con error")}</option>
          </select>
        </label>
        <label>
          {t("Intentos máximos")}
          <Input
            type="number"
            min={1}
            max={5}
            value={node.maxAttempts ?? 3}
            onChange={(e) => patch({ maxAttempts: Number(e.target.value) })}
          />
        </label>
        {node.onError === "continue" ? (
          <p className="wf-muted">
            {t(
              "El fallo queda en steps.<id>.error y el flujo sigue por la rama por defecto.",
            )}
          </p>
        ) : null}
      </fieldset>
      {node.type === "switch"
        ? destination(t("Rama por defecto"), "otherwise")
        : destination(
            node.type === "condition"
              ? t("Si se cumple")
              : node.type === "approval"
                ? t("Si se aprueba")
                : t("Siguiente paso"),
            "next",
          )}
      {node.type === "condition" || node.type === "approval"
        ? destination(
            node.type === "approval"
              ? t("Si no se aprueba")
              : t("Si no se cumple"),
            "otherwise",
          )
        : null}
    </section>
  );
}
