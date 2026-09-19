import { WorkflowDestinationPicker } from "./workflow-webhooks";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fieldEntries, type CrmObject } from "@savia/crm-shared/metadata";
import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowValue,
} from "@savia/crm-shared/workflows";

export const stepLabels: Record<WorkflowNode["type"], string> = {
  webhook: "Enviar webhook",
  condition: "Condición",
  transform: "Transformar datos",
  query: "Consultar registros",
  create: "Crear registro",
  update: "Actualizar registro",
  task: "Crear tarea",
  notification: "Notificación interna",
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
  const id = useId(),
    kind =
      value === null
        ? "null"
        : typeof value === "object"
          ? "ref"
          : typeof value;
  return (
    <div className="wf-value">
      <label htmlFor={id}>{label}</label>
      <div>
        <select
          aria-label={`Tipo de ${label}`}
          value={kind}
          onChange={(e) =>
            onChange(
              e.target.value === "ref"
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
          <option value="string">Texto</option>
          <option value="number">Número</option>
          <option value="boolean">Sí / No</option>
          <option value="null">Vacío</option>
          <option value="ref">Variable</option>
        </select>
        {kind === "boolean" ? (
          <select
            id={id}
            value={String(value)}
            onChange={(e) => onChange(e.target.value === "true")}
          >
            <option value="true">Sí</option>
            <option value="false">No</option>
          </select>
        ) : kind !== "null" ? (
          <Input
            id={id}
            type={kind === "number" ? "number" : "text"}
            list={kind === "ref" ? `${id}-options` : undefined}
            value={
              typeof value === "object" ? (value?.ref ?? "") : String(value)
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
}: {
  values: Record<string, WorkflowValue>;
  onChange: (v: Record<string, WorkflowValue>) => void;
  fields: string[];
  variables: string[];
}) {
  return (
    <fieldset>
      <legend>Valores de salida</legend>
      {Object.entries(values).map(([key, value], index) => (
        <div className="wf-mapping" key={index}>
          {fields.length ? (
            <select
              aria-label={`Campo ${index + 1}`}
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
              aria-label={`Campo ${index + 1}`}
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
            label={`Valor ${index + 1}`}
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
            aria-label={`Quitar campo ${key}`}
          >
            Quitar
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
        Añadir valor
      </Button>
    </fieldset>
  );
}
export function TriggerEditor({
  definition,
  onChange,
  objects,
}: {
  definition: WorkflowDefinition;
  onChange: (v: WorkflowDefinition) => void;
  objects: CrmObject[];
}) {
  const trigger = definition.trigger;
  const set = (value: WorkflowDefinition["trigger"]) =>
    onChange({ ...definition, trigger: value });
  return (
    <fieldset className="wf-trigger">
      <legend>Cuándo se inicia</legend>
      <label>
        Disparador
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
                  : type === "updated"
                    ? {
                        type,
                        collection: objects[0]?.name ?? "",
                        changedFields: [],
                      }
                    : { type, collection: objects[0]?.name ?? "" },
            );
          }}
        >
          <option value="manual">Acción manual</option>
          <option value="webhook">Webhook recibido</option>
          <option value="created">Registro creado</option>
          <option value="updated">Registro actualizado</option>
          <option value="schedule">Programación</option>
        </select>
      </label>
      {trigger.type === "webhook" ? (
        <p className="wf-muted">
          Un sistema externo inicia este flujo mediante una solicitud
          autenticada.
        </p>
      ) : trigger.type !== "schedule" ? (
        <label>
          Colección
          <select
            value={trigger.collection ?? ""}
            onChange={(e) =>
              set({
                ...trigger,
                collection: e.target.value || undefined,
              } as typeof trigger)
            }
          >
            <option value="">
              {trigger.type === "manual"
                ? "Sin registro asociado"
                : "Selecciona una colección"}
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
            Intervalo en minutos
            <Input
              type="number"
              min={1}
              value={trigger.intervalMinutes}
              onChange={(e) =>
                set({ ...trigger, intervalMinutes: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Inicio (UTC)
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
      {trigger.type === "updated" ? (
        <label>
          Campos que deben cambiar
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
                ({ config: { fields: {} } } as CrmObject),
            ).map(([key, field]) => (
              <option key={key} value={key}>
                {field.label}
              </option>
            ))}
          </select>
          <small>Sin selección: cualquier cambio de datos.</small>
        </label>
      ) : null}
    </fieldset>
  );
}
export function StepEditor({
  node,
  definition,
  objects,
  onChange,
}: {
  node: WorkflowNode;
  definition: WorkflowDefinition;
  objects: CrmObject[];
  onChange: (v: WorkflowNode) => void;
}) {
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
    ...(triggerObject
      ? fieldEntries(triggerObject).map(([key]) => `trigger.${key}`)
      : []),
    ...definition.nodes
      .filter((n) => n.id !== node.id)
      .flatMap((n) =>
        n.type === "transform"
          ? Object.keys(n.values).map((k) => `steps.${n.id}.${k}`)
          : n.type === "webhook"
            ? [`steps.${n.id}.status`, `steps.${n.id}.body`]
            : n.type === "query"
              ? [`steps.${n.id}.count`]
              : [`steps.${n.id}.id`],
      ),
  ];
  const destination = (label: string, key: "next" | "otherwise") => (
    <label>
      {label}
      <select
        value={(node as { next?: string; otherwise?: string })[key] ?? ""}
        onChange={(e) => patch({ [key]: e.target.value || undefined })}
      >
        <option value="">Finalizar</option>
        {definition.nodes
          .filter((n) => n.id !== node.id)
          .map((n) => (
            <option key={n.id} value={n.id}>
              {n.label || stepLabels[n.type]} · {n.id}
            </option>
          ))}
      </select>
    </label>
  );
  return (
    <section className="wf-config" aria-label="Configuración del paso">
      <h3>{stepLabels[node.type]}</h3>
      <p className="wf-muted">Identificador: {node.id}</p>
      <label>
        Etiqueta
        <Input
          value={node.label ?? ""}
          onChange={(e) => patch({ label: e.target.value })}
        />
      </label>
      {"collection" in node ? (
        <label>
          Colección del paso
          <select
            value={node.collection}
            onChange={(e) => patch({ collection: e.target.value })}
          >
            <option value="">Selecciona una colección</option>
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
            label="Valor a comparar"
            value={node.left}
            onChange={(v) => patch({ left: v })}
            variables={variables}
          />
          <label>
            Operador
            <select
              value={node.operator}
              onChange={(e) =>
                patch({ operator: e.target.value as typeof node.operator })
              }
            >
              {["eq", "neq", "gt", "gte", "lt", "lte", "contains", "empty"].map(
                (op, i) => (
                  <option key={op} value={op}>
                    {
                      [
                        "Igual",
                        "Distinto",
                        "Mayor",
                        "Mayor o igual",
                        "Menor",
                        "Menor o igual",
                        "Contiene",
                        "Está vacío",
                      ][i]
                    }
                  </option>
                ),
              )}
            </select>
          </label>
          <ValueInput
            label="Comparar con"
            value={node.right}
            onChange={(v) => patch({ right: v })}
            variables={variables}
          />
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
      {node.type === "update" ? (
        <ValueInput
          label="ID del registro"
          value={node.recordId}
          onChange={(v) => patch({ recordId: v })}
          variables={variables}
        />
      ) : null}
      {node.type === "query" ? (
        <>
          <label>
            Campo de búsqueda
            <select
              value={node.field}
              onChange={(e) => patch({ field: e.target.value })}
            >
              <option value="">Selecciona un campo</option>
              {fields.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          <ValueInput
            label="Valor de búsqueda"
            value={node.value}
            onChange={(v) => patch({ value: v })}
            variables={variables}
          />
          <label>
            Límite de resultados
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
            label="Título"
            value={node.title}
            onChange={(v) => patch({ title: v })}
            variables={variables}
          />
          <ValueInput
            label="ID del destinatario"
            value={node.assignee}
            onChange={(v) => patch({ assignee: v })}
            variables={variables}
          />
        </>
      ) : null}
      {node.type === "task" ? (
        <label>
          Vence en días
          <Input
            type="number"
            min={0}
            value={node.dueDays}
            onChange={(e) => patch({ dueDays: Number(e.target.value) })}
          />
        </label>
      ) : null}
      {node.type === "delay" ? (
        <label>
          Segundos de espera
          <Input
            type="number"
            min={1}
            value={node.seconds}
            onChange={(e) => patch({ seconds: Number(e.target.value) })}
          />
        </label>
      ) : null}
      {destination(
        node.type === "condition" ? "Si se cumple" : "Siguiente paso",
        "next",
      )}
      {node.type === "condition"
        ? destination("Si no se cumple", "otherwise")
        : null}
    </section>
  );
}
