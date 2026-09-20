import { useMemo } from "react";
import { usePluginLocale } from "@savia/crm-shared/plugin-locale-react";
import type { PluginLocale } from "@savia/crm-shared/plugin-localization";
import { createWorkbenchTranslator, localizeWorkbenchConfig } from "@savia/insurance-workbench";
import { messages } from "./messages";
import { RecordActions } from "./actions";
import type { PluginApi } from "@savia/crm-shared/plugin-api";
import { Workbench } from "@savia/insurance-workbench";
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
  singular: t("Solicitud de servicio"),
  createLabel: t("Nueva solicitud"),
  description: manifest.description,
  dateTitle: t("Compromiso de respuesta"),
  fields,
  stages,
  dateField,
  priority,
  validate,
  defaults: { stage: "received", kind: "query", channel: "email" },
  footerNote: t("Fechas calendario · Bogotá"),
  valueColumn: {
    key: "kind",
    label: t("Solicitud / Canal"),
    render: (record) => (
      <>
         <strong>{t(fieldLabel(fields, "kind", record.kind))}</strong>
         <small>{t(fieldLabel(fields, "channel", record.channel))}</small>
       </>
    ),
  },
  metrics: (records, asOf) => [
    {
      label: t("Solicitudes abiertas"),
      value: records.filter((record) => priority(record, asOf) !== "closed")
        .length,
      detail: t("Casos que necesitan seguimiento"),
    },
    {
      label: t("Respuesta atrasada"),
      value: records.filter((record) => priority(record, asOf) === "overdue")
        .length,
      detail: t("Compromisos de respuesta vencidos"),
    },
    {
      label: t("Esperando información"),
      value: countBy(records, "stage", "waiting"),
      detail: t("Retoma la gestión al recibir respuesta"),
    },
    {
      label: t("Resueltas"),
      value: countBy(records, "stage", "resolved"),
      detail: t("Con respuesta y fecha registradas"),
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
        recordActions: (props) => <RecordActions {...props} />,
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
