import { useMemo } from "react";
import { usePluginLocale } from "@savia/crm-shared/plugin-locale-react";
import type { PluginLocale } from "@savia/crm-shared/plugin-localization";
import { createWorkbenchTranslator, localizeWorkbenchConfig } from "@savia/insurance-workbench";
import { messages } from "./messages";
import { DeliveryAction } from "./actions";
import type { PluginApi } from "@savia/crm-shared/plugin-api";
import { cents } from "@savia/insurance-workbench/data";
import { Workbench, money, text } from "@savia/insurance-workbench";
import { caseConfig, countBy } from "@savia/insurance-workbench/case-config";
import { fields, stages, dateField } from "./fields";
import { manifest } from "./manifest";
import { requirement } from "./object";
import { priority, validate } from "./domain";
function createConfig(locale: PluginLocale) {
const t = createWorkbenchTranslator(messages, locale);
const config = caseConfig({
  object: requirement.object.name,
  title: manifest.label,
  singular: t("Solicitud de emisión"),
  createLabel: t("Nueva emisión"),
  description: manifest.description,
  dateTitle: t("Compromiso de entrega"),
  fields,
  stages,
  dateField,
  priority,
  validate,
  defaults: { stage: "requested" },
  footerNote: t("Valores en COP · Fechas calendario en Bogotá"),
  valueColumn: {
    key: "premium",
    label: t("Prima / Producto"),
    render: (record) => (
      <>
         <strong>
           {money(
            cents(record.premium) === null ? null : Number(record.premium), locale
          )}
         </strong>
         <small>{text(record.product) || t("Sin producto indicado")}</small>
       </>
    ),
  },
  metrics: (records, asOf) => [
    {
      label: t("Emisiones abiertas"),
      value: records.filter((record) => priority(record, asOf) !== "closed")
        .length,
      detail: t("Pendientes de expedición o entrega"),
    },
    {
      label: t("Entrega atrasada"),
      value: records.filter((record) => priority(record, asOf) === "overdue")
        .length,
      detail: t("Compromisos de entrega vencidos"),
    },
    {
      label: t("Por entregar"),
      value: countBy(records, "stage", "issued"),
      detail: t("Expedidas, pendientes del cliente"),
    },
    {
      label: t("Entregadas"),
      value: countBy(records, "stage", "delivered"),
      detail: t("Con fecha de entrega registrada"),
    },
  ],
}, locale, messages);
return localizeWorkbenchConfig(config, locale, messages);
}

export function Screen({ savia }: { savia: PluginApi }) {
const locale = usePluginLocale();
const config = useMemo(() => createConfig(locale), [locale]);

  return (
    <Workbench
      savia={savia}
      config={{
        ...config,
        recordActions: (props) => <DeliveryAction {...props} />,
      }}
    />
  );
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
