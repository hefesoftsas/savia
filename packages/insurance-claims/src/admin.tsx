import { useMemo } from "react";
import { usePluginLocale } from "@savia/studio-shared/plugin-locale-react";
import type { PluginLocale } from "@savia/studio-shared/plugin-localization";
import { createWorkbenchTranslator, localizeWorkbenchConfig } from "@savia/insurance-workbench";
import { messages } from "./messages";
import type { PluginApi } from "@savia/studio-shared/plugin-api";
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
  singular: t("Siniestro"),
  createLabel: t("Nuevo siniestro"),
  description: t("Acompaña cada reclamación, desde el aviso hasta su resolución."),
  dateTitle: t("Próximo seguimiento"),
  fields,
  stages,
  dateField,
  priority,
  validate,
  defaults: { stage: "reported", amount: 0, paid: 0 },
  valueColumn: {
    key: "amount",
    label: t("Reclamado / Recibido (COP)"),
    numeric: true,
    render: (record) => (
      <>
         <strong>{money(record.amount, locale)}</strong>
         <small>{t("Recibido:")} {money(record.paid, locale)}</small>
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
        label: t("Casos abiertos"),
        value: open.length,
        detail: t("Reclamaciones en seguimiento"),
      },
      {
        label: t("Seguimientos atrasados"),
        value: overdue.length,
        detail: t("Próxima gestión pendiente"),
      },
      {
        label: t("Valor reclamado abierto"),
        value: money(sum(open, "amount"), locale),
        detail: t("Valores registrados en los casos"),
      },
      {
        label: t("Casos resueltos"),
        value: records.length - open.length,
        detail: t("Cerrados o rechazados"),
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
