import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { WorkflowTriggerCondition } from "@savia/crm-shared/workflows";
import { useEffect, useState } from "react";

const parseNumber = (text: string) => (text.trim() ? Number(text) : Number.NaN);
function NumericConditionValue({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(() =>
    Number.isFinite(value) ? String(value) : "",
  );
  useEffect(() => {
    // Preserve incomplete input and trailing decimals while accepting external edits.
    setText((current) =>
      Object.is(parseNumber(current), value)
        ? current
        : Number.isFinite(value)
          ? String(value)
          : "",
    );
  }, [value]);
  return (
    <Input
      type="text"
      inputMode="decimal"
      placeholder="Ej. -1.5"
      aria-invalid={!Number.isFinite(value)}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(parseNumber(event.target.value));
      }}
    />
  );
}

const operators: Record<WorkflowTriggerCondition["operator"], string> = {
  eq: "Es igual a",
  neq: "Es diferente de",
  gt: "Es mayor que",
  gte: "Es mayor o igual que",
  lt: "Es menor que",
  lte: "Es menor o igual que",
  contains: "Contiene",
  empty: "Está vacío",
  not_empty: "No está vacío",
};

export function TriggerConditions({
  conditions,
  mode,
  fields,
  onChange,
  onModeChange,
}: {
  conditions: WorkflowTriggerCondition[];
  mode: "all" | "any";
  fields: { name: string; label: string }[];
  onChange: (conditions: WorkflowTriggerCondition[]) => void;
  onModeChange: (mode: "all" | "any") => void;
}) {
  const update = (index: number, patch: Partial<WorkflowTriggerCondition>) =>
    onChange(
      conditions.map((condition, i) =>
        i === index ? { ...condition, ...patch } : condition,
      ),
    );
  return (
    <fieldset className="wf-trigger-conditions">
      <legend>Condiciones para iniciar</legend>
      <p className="wf-muted">
        Sin condiciones, cada evento seleccionado inicia el flujo.
      </p>
      {conditions.length > 0 && (
        <label>
          Iniciar cuando se cumplan
          <select
            value={mode}
            onChange={(e) => onModeChange(e.target.value as "all" | "any")}
          >
            <option value="all">Todas las condiciones</option>
            <option value="any">Cualquiera de las condiciones</option>
          </select>
        </label>
      )}
      {conditions.map((condition, index) => {
        const numeric = ["gt", "gte", "lt", "lte"].includes(condition.operator);
        const unary =
          condition.operator === "empty" || condition.operator === "not_empty";
        const kind = condition.value === null ? "null" : typeof condition.value;
        return (
          <fieldset key={index} className="wf-trigger-condition">
            <legend>Condición {index + 1}</legend>
            <label>
              Campo de condición {index + 1}
              <select
                value={condition.field}
                onChange={(e) => update(index, { field: e.target.value })}
              >
                {fields.map((field) => (
                  <option key={field.name} value={field.name}>
                    {field.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Comparación de condición {index + 1}
              <select
                value={condition.operator}
                onChange={(e) => {
                  const operator = e.target
                    .value as WorkflowTriggerCondition["operator"];
                  const value = ["empty", "not_empty"].includes(operator)
                    ? null
                    : ["gt", "gte", "lt", "lte"].includes(operator)
                      ? typeof condition.value === "number"
                        ? condition.value
                        : 0
                      : operator === "contains"
                        ? typeof condition.value === "string"
                          ? condition.value
                          : ""
                        : condition.value;
                  update(index, { operator, value });
                }}
              >
                {Object.entries(operators).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {!unary && (
              <>
                {!numeric && condition.operator !== "contains" && (
                  <label>
                    Tipo de condición {index + 1}
                    <select
                      value={kind}
                      onChange={(e) =>
                        update(index, {
                          value:
                            e.target.value === "number"
                              ? 0
                              : e.target.value === "boolean"
                                ? false
                                : e.target.value === "null"
                                  ? null
                                  : "",
                        })
                      }
                    >
                      <option value="string">Texto</option>
                      <option value="number">Número</option>
                      <option value="boolean">Sí / No</option>
                      <option value="null">Nulo</option>
                    </select>
                  </label>
                )}
                {kind !== "null" && (
                  <label>
                    Valor de condición {index + 1}
                    {kind === "boolean" ? (
                      <select
                        value={String(condition.value)}
                        onChange={(e) =>
                          update(index, { value: e.target.value === "true" })
                        }
                      >
                        <option value="true">Sí</option>
                        <option value="false">No</option>
                      </select>
                    ) : typeof condition.value === "number" ? (
                      <NumericConditionValue
                        value={condition.value}
                        onChange={(value) => update(index, { value })}
                      />
                    ) : (
                      <Input
                        type="text"
                        value={String(condition.value)}
                        onChange={(e) =>
                          update(index, {
                            value: e.target.value,
                          })
                        }
                      />
                    )}
                  </label>
                )}
              </>
            )}
            <Button
              type="button"
              variant="ghost"
              onClick={() => onChange(conditions.filter((_, i) => i !== index))}
            >
              Eliminar condición {index + 1}
            </Button>
          </fieldset>
        );
      })}
      <Button
        type="button"
        variant="outline"
        disabled={conditions.length >= 20 || fields.length === 0}
        onClick={() =>
          onChange([
            ...conditions,
            { field: fields[0].name, operator: "eq", value: "" },
          ])
        }
      >
        Añadir condición
      </Button>
      {conditions.length >= 20 && (
        <p className="wf-muted">Máximo de 20 condiciones por disparador.</p>
      )}
    </fieldset>
  );
}
