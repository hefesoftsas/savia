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
import { priority, validate, weightedPremium } from "./domain";
function createConfig(locale: PluginLocale) {
const t = createWorkbenchTranslator(messages, locale);
const config = caseConfig({
  object: requirement.object.name,
  title: manifest.label,
  singular: t("Oportunidad comercial"),
  createLabel: t("Nueva oportunidad"),
  description:
    t("Organiza tu gestión comercial y convierte cada conversación en un siguiente paso."),
  dateTitle: t("Cierre esperado"),
  fields,
  stages,
  dateField,
  priority,
  validate,
  defaults: { stage: "lead", probability: 0, premium: 0 },
  valueColumn: {
    key: "premium",
    label: t("Prima / Probabilidad"),
    numeric: true,
    render: (record) => (
      <>
         <strong>{money(record.premium, locale)}</strong>
         <small>
           {String(record.probability ?? 0)} % ·{" "}
           {text(record.product) || t("Sin producto")}
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
        label: t("Oportunidades abiertas"),
        value: open.length,
        detail: t("Negocios que siguen en gestión"),
      },
      {
        label: t("Prima potencial"),
        value: money(sum(open, "premium"), locale),
        detail: t("Estimación sin ponderar"),
      },
      {
        label: t("Prima ponderada"),
        value: money(
          open.reduce(
            (sum, record) => sum + (cents(weightedPremium(record)) ?? 0),
            0,
          ) / 100, locale
        ),
        detail: t("Estimación según probabilidad registrada"),
      },
      {
        label: t("Ganadas"),
        value: countBy(records, "stage", "won"),
        detail: `${countBy(records, "stage", "lost")} oportunidades perdidas`,
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
