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
import { priority, validate, calculatedCommission } from "./domain";
import { balance, paymentPatch } from "@savia/insurance-workbench/financial";
function createConfig(locale: PluginLocale) {
const t = createWorkbenchTranslator(messages, locale);
const config = caseConfig({
  object: requirement.object.name,
  title: manifest.label,
  singular: t("Comisión"),
  createLabel: t("Nueva comisión"),
  description:
    t("Concilia lo esperado, registra lo recibido y controla cada diferencia."),
  dateTitle: t("Recaudo previsto"),
  fields,
  stages,
  dateField,
  priority,
  validate,
  defaults: { stage: "pending", paid: 0, seller_share: 0 },
  payment: { balance, patch: paymentPatch },
  valueColumn: {
    key: "balance",
    label: t("Por recaudar (COP)"),
    numeric: true,
    render: (record) => (
      <>
         <strong>{money(balance(record), locale)}</strong>
         <small>
          {t("Estimación por tasa:")} {" "}
           {money(calculatedCommission(record.premium, record.rate), locale)}
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
        label: t("Por recaudar"),
        value: money(
          open.reduce((sum, record) => sum + (cents(balance(record)) ?? 0), 0) /
            100, locale
        ),
        detail: t("Saldo de comisiones con valores válidos"),
      },
      {
        label: t("Recaudo registrado"),
        value: money(sum(records, "paid"), locale),
        detail: t("Acumulado recibido de aseguradoras"),
      },
      {
        label: t("Participación del vendedor"),
        value: money(sum(records, "seller_share"), locale),
        detail: t("Asignación prevista, no pago realizado"),
      },
      {
        label: t("Diferencias por revisar"),
        value: countBy(records, "stage", "disputed"),
        detail: t("Registros pendientes de conciliación"),
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
