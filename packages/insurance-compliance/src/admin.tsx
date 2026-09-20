import { useMemo } from "react";
import { usePluginLocale } from "@savia/crm-shared/plugin-locale-react";
import type { PluginLocale } from "@savia/crm-shared/plugin-localization";
import { createWorkbenchTranslator, localizeWorkbenchConfig } from "@savia/insurance-workbench";
import { messages } from "./messages";
import { useState } from "react";
import type { PluginApi } from "@savia/crm-shared/plugin-api";
import { Workbench } from "@savia/insurance-workbench";
import { caseConfig } from "@savia/insurance-workbench/case-config";
import { fields, stages } from "./fields";
import { priority, readiness, validate } from "./domain";
import { manifest } from "./manifest";
import { requirement } from "./object";
import { Templates } from "./templates";
function createConfig(locale: PluginLocale) {
const t = createWorkbenchTranslator(messages, locale);
const config = caseConfig({
  object: requirement.object.name,
  title: manifest.label,
  singular: t("Requisito de cumplimiento"),
  createLabel: t("Nuevo requisito"),
  description: manifest.description,
  dateTitle: t("Compromiso"),
  fields,
  stages,
  dateField: "due_date",
  valueColumn: {
    key: "evidence",
    label: t("Evidencia"),
    render: (record) => String(record.evidence || t("Pendiente")),
  },
  priority,
  validate,
  defaults: { stage: "pending" },
  footerNote: t("Requisitos configurados por tu operación · Fechas calendario"),
  metrics: (records, asOf) => {
    const totals = readiness(records, asOf);
    return [
      {
        label: t("Requisitos"),
        value: totals.total,
        detail: t("En los expedientes del espacio"),
      },
      {
        label: t("Vigentes y revisados"),
        value: totals.ready,
        detail: t("Aprobados con evidencia o exentos con motivo"),
      },
      {
        label: t("Evidencia vencida"),
        value: totals.expired,
        detail: t("Requieren nueva revisión"),
      },
      {
        label: t("Pendientes"),
        value: totals.total - totals.ready,
        detail: t("Aún no listos para el expediente"),
      },
    ];
  },
}, locale, messages);
return localizeWorkbenchConfig(config, locale, messages);
}

export function Screen({ savia }: { savia: PluginApi }) {
const locale = usePluginLocale();
const config = useMemo(() => createConfig(locale), [locale]);

  const [revision, setRevision] = useState(0);
  return (
    <>
      <Templates savia={savia} onSaved={() => setRevision(revision + 1)} />
      <Workbench key={revision} savia={savia} config={config} />
    </>
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
