import { useMessages } from "@/i18n/core";
import { studioMessages } from "@/i18n/locales/studio";
import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { propertySearchTerms } from "@savia/studio-shared/property-panel-search";
import type { Condition } from "@savia/studio-shared/rules";

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
  if (["Number", "Currency", "Percentage", "Rating"].includes(type ?? ""))
    return text === "" ? undefined : Number(text);
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
  const t = useMessages(studioMessages);
  const chosen = value?.field;
  return (
    <fieldset
      className="studio-rule"
      data-property-search={propertySearchTerms(label, "condición regla when")}
    >
      <legend>{label}</legend>
      <Choice
        label={t("%{v1}: campo", { v1: label })}
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
        <option value="">{t("Siempre")}</option>
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
            label={t("%{v1}: condición", { v1: label })}
            value={value.op}
            onChange={(op) => onChange({ ...value, op: op as Condition["op"] })}
          >
            <option value="eq">{t("Es igual a")}</option>
            <option value="ne">{t("Es diferente de")}</option>
            <option value="gt">{t("Es mayor que")}</option>
            <option value="gte">{t("Es mayor o igual")}</option>
            <option value="lt">{t("Es menor que")}</option>
            <option value="lte">{t("Es menor o igual")}</option>
            <option value="contains">{t("Contiene")}</option>
            <option value="empty">{t("Está vacío")}</option>
          </Choice>
          {value.op !== "empty" &&
            (fields[value.field]?.type === "Toggle" ? (
              <Choice
                label={t("%{v1}: valor", { v1: label })}
                value={String(value.value)}
                onChange={(v) => onChange({ ...value, value: v === "true" })}
              >
                <option value="true">{t("Sí")}</option>
                <option value="false">{t("No")}</option>
              </Choice>
            ) : (
              <Input
                aria-label={t("%{v1}: valor", { v1: label })}
                value={String(value.value ?? "")}
                type={
                  ["Number", "Currency", "Percentage", "Rating"].includes(
                    fields[value.field]?.type ?? "",
                  )
                    ? "number"
                    : "text"
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
