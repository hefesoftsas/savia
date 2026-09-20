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
  singular: t("Movimiento de póliza"),
  createLabel: t("Nuevo movimiento"),
  description:
    t("Da seguimiento a cambios de cobertura, inclusiones, exclusiones y anexos."),
  dateTitle: t("Fecha de efecto"),
  fields,
  stages,
  dateField,
  priority,
  validate,
  defaults: {
    stage: "requested",
    kind: "coverage",
    additional_premium: 0,
    refund: 0,
  },
  valueColumn: {
    key: "kind",
    label: t("Movimiento / Prima"),
    render: (record) => (
      <>
         <strong>{t(fieldLabel(fields, "kind", record.kind))}</strong>
         <small>
          {t("Adicional:")} {money(record.additional_premium, locale)} {t("· Devolución:")} {" "}
           {money(record.refund, locale)}
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
        label: t("Solicitudes abiertas"),
        value: open.length,
        detail: t("Movimientos pendientes de resolución"),
      },
      {
        label: t("Fecha de efecto vencida"),
        value: overdue.length,
        detail: t("Solicitudes que requieren revisión"),
      },
      {
        label: t("Prima adicional abierta"),
        value: money(sum(open, "additional_premium"), locale),
        detail: t("Valor previsto de los movimientos"),
      },
      {
        label: t("Anexos expedidos"),
        value: countBy(records, "stage", "issued"),
        detail: t("Expedición registrada por el equipo"),
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
