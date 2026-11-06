import { createWorkbenchTranslator } from "./localization";
import type { PluginLocale, PluginMessages } from "@savia/studio-shared/plugin-localization";
import { dateLabel, text, type WorkRecord } from "./data";
import type { WorkbenchConfig, Field } from "./types";
type CaseOptions = Pick<
  WorkbenchConfig,
  | "object"
  | "title"
  | "description"
  | "singular"
  | "createLabel"
  | "fields"
  | "stages"
  | "defaults"
  | "validate"
  | "metrics"
  | "footerNote"
  | "payment"
  | "recordActions"
> & {
  dateField: string;
  dateTitle: string;
  priority: (record: Record<string, unknown>, asOf: string) => string;
  valueColumn: WorkbenchConfig["columns"][number];
};
const labels: Record<string, string> = {
  overdue: "Atrasado",
  today: "Hoy",
  week: "Próximos 7 días",
  later: "Más adelante",
  closed: "Cerrado",
  undated: "Sin fecha",
  invalid: "Revisar valores",
};
export function caseConfig(options: CaseOptions, locale: PluginLocale = "es", catalog: PluginMessages = {}): WorkbenchConfig {
  const t = createWorkbenchTranslator(catalog, locale);
  return {
    ...options,
    filters: [
      { value: "all", label: "Todos" },
      { value: "overdue", label: "Atrasados" },
      { value: "today", label: "Hoy" },
      { value: "week", label: "Próximos 7 días" },
      { value: "open", label: "Abiertos" },
      { value: "closed", label: "Cerrados" },
    ],
    matches: (record, filter, asOf) =>
      filter === "all" ||
      (filter === "open"
        ? options.priority(record, asOf) !== "closed"
        : filter === "week"
          ? ["today", "week"].includes(options.priority(record, asOf))
          : options.priority(record, asOf) === filter),
    columns: [
      {
        key: "identity",
        label: "Referencia / Cliente",
        render: (record) => (
          <>
            <strong>{text(record.name)}</strong>
            <small>
              {text(record.customer) || t("Sin cliente asociado")}
              {record.policy_reference
                ? ` · ${text(record.policy_reference)}`
                : ""}
            </small>
          </>
        ),
      },
      {
        key: "date",
        label: options.dateTitle,
        render: (record, asOf) => {
          const group = options.priority(record, asOf);
          return (
            <>
              <span>{dateLabel(record[options.dateField], locale)}</span>
              <small>
                <span
                  className="iw-badge"
                  data-tone={
                    group === "overdue"
                      ? "danger"
                      : group === "today"
                        ? "warning"
                        : group === "closed"
                          ? "success"
                          : undefined
                  }
                >
                  {t(labels[group] ?? group)}
                </span>
              </small>
            </>
          );
        },
      },
      options.valueColumn,
      {
        key: "stage",
        label: "Etapa / Responsable",
        render: (record) => (
          <>
            <span className="iw-badge">
              {options.stages.find((stage) => stage.value === record.stage)
                ?.label ? t(options.stages.find((stage) => stage.value === record.stage)!.label) : t("Revisar etapa")}
            </span>
            <small>{text(record.owner) || t("Sin responsable")}</small>
          </>
        ),
      },
    ],
    exportHeaders: options.fields.map((field) => field.label),
    exportRow: (record) =>
      options.fields.map(
        (field) =>
          field.options?.find((option) => option.value === record[field.key])
            ?.label ? t(field.options.find((option) => option.value === record[field.key])!.label) : record[field.key],
      ),
  };
}
export const countBy = (records: WorkRecord[], field: string, value: string) =>
  records.filter((record) => record[field] === value).length;
export const fieldLabel = (
  fields: readonly Field[],
  key: string,
  value: unknown,
) =>
  fields
    .find((field) => field.key === key)
    ?.options?.find((option) => option.value === value)?.label ?? text(value);
