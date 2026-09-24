import { useMemo } from "react";
import { usePluginLocale } from "@savia/studio-shared/plugin-locale-react";
import type { PluginLocale } from "@savia/studio-shared/plugin-localization";
import { createWorkbenchTranslator, localizeWorkbenchConfig } from "@savia/insurance-workbench";
import { messages } from "./messages";
import { RecordActions } from "./actions";
import type { PluginApi } from "@savia/studio-shared/plugin-api";
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
  singular: t("Requisito documental"),
  createLabel: t("Nuevo requisito"),
  description: manifest.description,
  dateTitle: t("Fecha de compromiso"),
  fields,
  stages,
  dateField,
  priority,
  validate,
  defaults: { stage: "requested", kind: "application" },
  footerNote: t("Fechas calendario · Bogotá"),
  valueColumn: {
    key: "kind",
    label: t("Documento / Evidencia"),
    render: (record) => (
      <>
         <strong>{t(fieldLabel(fields, "kind", record.kind))}</strong>
         <small>
           {record.evidence_reference ? t("Evidencia registrada") : t("Sin evidencia")}
         </small>
       </>
    ),
  },
  metrics: (records, asOf) => [
    {
      label: t("Requisitos pendientes"),
      value: records.filter((record) => priority(record, asOf) !== "closed")
        .length,
      detail: t("Solicitados, recibidos o por corregir"),
    },
    {
      label: t("Atrasados"),
      value: records.filter((record) => priority(record, asOf) === "overdue")
        .length,
      detail: t("Fecha de compromiso vencida"),
    },
    {
      label: t("Por revisar"),
      value: countBy(records, "stage", "received"),
      detail: t("Recepciones pendientes de revisión"),
    },
    {
      label: t("Aprobados"),
      value: countBy(records, "stage", "approved"),
      detail: t("Con revisión documentada"),
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
