import { useMemo } from "react";
import { usePluginLocale } from "@savia/crm-shared/plugin-locale-react";
import type { PluginLocale } from "@savia/crm-shared/plugin-localization";
import { createWorkbenchTranslator, localizeWorkbenchConfig } from "@savia/insurance-workbench";
import { messages } from "./messages";
import type { PluginApi } from "@savia/crm-shared/plugin-api";
import { Workbench, money, text } from "@savia/insurance-workbench";
import { cents } from "@savia/insurance-workbench/data";
import {
  caseConfig,
  countBy,
  fieldLabel,
} from "@savia/insurance-workbench/case-config";
import { fields, stages, dateField } from "./fields";
import { manifest } from "./manifest";
import { requirement } from "./object";
import { priority, validate } from "./domain";
function createConfig(locale: PluginLocale) {
const t = createWorkbenchTranslator(messages, locale);
const config = caseConfig({
  object: requirement.object.name,
  title: manifest.label,
  singular: t("Actividad"),
  createLabel: t("Nueva actividad"),
  description: t("Ten a mano tus llamadas, reuniones y compromisos pendientes."),
  dateTitle: t("Fecha de compromiso"),
  fields,
  stages,
  dateField,
  priority,
  validate,
  defaults: { stage: "scheduled", kind: "task", importance: "normal" },
  footerNote: t("Fechas calendario · Bogotá"),
  valueColumn: {
    key: "kind",
    label: t("Tipo / Prioridad"),
    render: (record) => (
      <>
         <strong>{t(fieldLabel(fields, "kind", record.kind))}</strong>
         <small>
           <span
            className="iw-badge"
            data-tone={
              record.importance === "urgent"
                ? "danger"
                : record.importance === "high"
                  ? "warning"
                  : undefined
            }
          >
             {t(fieldLabel(fields, "importance", record.importance))}
           </span>
         </small>
       </>
    ),
  },
  metrics: (records, asOf) => {
    const open = records.filter(
      (record) => priority(record, asOf) !== "closed",
    );
    const overdue = records.filter(
      (record) => priority(record, asOf) === "overdue",
    );
    const sum = (items: typeof records, key: string) =>
      items.reduce((total, record) => total + (cents(record[key]) ?? 0), 0) /
      100;
    return [
      {
        label: t("Actividades abiertas"),
        value: open.length,
        detail: t("Compromisos que siguen pendientes"),
      },
      {
        label: t("Para hoy"),
        value: records.filter((record) => priority(record, asOf) === "today")
          .length,
        detail: t("Según fecha de compromiso"),
      },
      {
        label: t("Atrasadas"),
        value: overdue.length,
        detail: t("Reprograma o registra el resultado"),
      },
      {
        label: t("Realizadas"),
        value: countBy(records, "stage", "completed"),
        detail: t("Actividades con resultado documentado"),
      },
    ];
  },
}, locale, messages);
return localizeWorkbenchConfig(config, locale, messages);
}

export function Screen({ savia }: { savia: PluginApi }) {
const locale = usePluginLocale();
const config = useMemo(() => createConfig(locale), [locale]);

  return <Workbench savia={savia} config={config} />;
}
export const screens = [
  {
    id: `${manifest.id}.worklist`,
    extensionId: manifest.id,
    object: requirement.object.name,
    view: "records",
    Screen,
  },
];
