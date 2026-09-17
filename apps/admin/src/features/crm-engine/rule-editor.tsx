import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { propertySearchTerms } from "@savia/crm-shared/property-panel-search";
import type { Condition } from "@savia/crm-shared/rules";

function Choice({
  value,
  onChange,
  children,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  label?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {children}
    </select>
  );
}

export function parseValue(text: string, type?: string): unknown {
  if (type === "Number") return text === "" ? undefined : Number(text);
  if (type === "Toggle") return text === "true";
  return text;
}

export function RuleEditor({
  label,
  value,
  onChange,
  fields,
  excludeField,
}: {
  label: string;
  value?: Condition;
  onChange: (v?: Condition) => void;
  fields: Record<string, { type: string; label: string }>;
  excludeField?: string;
}) {
  const chosen = value?.field;
  return (
    <fieldset
      className="studio-rule"
      data-property-search={propertySearchTerms(label, "condición regla when")}
    >
      <legend>{label}</legend>
      <Choice
        label={`${label}: campo`}
        value={chosen ?? ""}
        onChange={(field) =>
          onChange(
            field
              ? {
                  field,
                  op: "eq",
                  value: fields[field].type === "Toggle" ? false : "",
                }
              : undefined,
          )
        }
      >
        <option value="">Siempre</option>
        {Object.entries(fields)
          .filter(([name]) => name !== excludeField)
          .map(([name, field]) => (
            <option key={name} value={name}>
              {field.label}
            </option>
          ))}
      </Choice>
      {value && (
        <>
          <Choice
            label={`${label}: condición`}
            value={value.op}
            onChange={(op) => onChange({ ...value, op: op as Condition["op"] })}
          >
            <option value="eq">Es igual a</option>
            <option value="ne">Es diferente de</option>
            <option value="gt">Es mayor que</option>
            <option value="gte">Es mayor o igual</option>
            <option value="lt">Es menor que</option>
            <option value="lte">Es menor o igual</option>
            <option value="contains">Contiene</option>
            <option value="empty">Está vacío</option>
          </Choice>
          {value.op !== "empty" &&
            (fields[value.field]?.type === "Toggle" ? (
              <Choice
                label={`${label}: valor`}
                value={String(value.value)}
                onChange={(v) => onChange({ ...value, value: v === "true" })}
              >
                <option value="true">Sí</option>
                <option value="false">No</option>
              </Choice>
            ) : (
              <Input
                aria-label={`${label}: valor`}
                value={String(value.value ?? "")}
                type={
                  fields[value.field]?.type === "Number" ? "number" : "text"
                }
                onChange={(e) =>
                  onChange({
                    ...value,
                    value: parseValue(
                      e.target.value,
                      fields[value.field]?.type,
                    ),
                  })
                }
              />
            ))}
        </>
      )}
    </fieldset>
  );
}
