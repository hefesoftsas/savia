import { useMemo } from "react";
import { usePluginLocale } from "@savia/studio-shared/plugin-locale-react";
import type { PluginLocale } from "@savia/studio-shared/plugin-localization";
import { createWorkbenchTranslator, localizeWorkbenchConfig } from "@savia/insurance-workbench";
import { messages } from "./messages";
import { useState } from "react";
import { Backfill } from "./backfill";
import type { PluginApi } from "@savia/studio-shared/plugin-api";
import {
  Workbench,
  money,
  dateLabel,
  text,
  type WorkbenchConfig,
} from "@savia/insurance-workbench";
import { priority, stages, summarize, validateRenewal } from "./domain";
import { manifest } from "./manifest";
import { requirement } from "./object";
const priorityLabels: Record<string, string> = {
  overdue: "Vencida",
  week: "Próximos 7 días",
  month: "Próximos 30 días",
  later: "Más de 30 días",
  closed: "Cerrada",
  undated: "Revisar fecha",
};
function createConfig(locale: PluginLocale) {
const t = createWorkbenchTranslator(messages, locale);
const config: WorkbenchConfig = {
  object: requirement.object.name,
  title: t("Renovaciones"),
  singular: t("Renovación de póliza"),
  createLabel: t("Nueva renovación"),
  description:
    t("Anticipa cada vencimiento y acompaña la renovación hasta su cierre."),
  stages,
  defaults: { stage: "pending", premium: 0 },
  fields: [
    { key: "name", label: t("Referencia"), required: true, maxLength: 120 },
    { key: "customer", label: t("Cliente"), required: true },
    {
      key: "policy_reference",
      label: t("Póliza actual"),
      required: true,
      maxLength: 120,
    },
    { key: "insurer", label: t("Aseguradora") },
    { key: "owner", label: t("Responsable"), maxLength: 120 },
    {
      key: "expiry_date",
      label: t("Vencimiento de la póliza"),
      type: "date",
      required: true,
    },
    {
      key: "premium",
      label: t("Prima a renovar (COP)"),
      type: "number",
      required: true,
      min: 0,
    },
    {
      key: "stage",
      label: t("Etapa"),
      type: "select",
      options: stages,
      required: true,
    },
    { key: "next_follow_up", label: t("Próximo seguimiento"), type: "date" },
    {
      key: "outcome",
      label: t("Nueva póliza o motivo de cierre"),
      maxLength: 500,
      help: t("Obligatorio al marcar Renovada o No renovada."),
    },
    {
      key: "notes",
      label: t("Notas de gestión"),
      type: "textarea",
      help: t("Conserva aquí las condiciones, documentos pendientes y próximos pasos."),
    },
  ],
  filters: [
    { value: "all", label: t("Todas") },
    { value: "overdue", label: t("Vencidas") },
    { value: "week", label: t("Esta semana") },
    { value: "month", label: t("8–30 días") },
    { value: "open", label: t("Abiertas") },
    { value: "closed", label: t("Cerradas") },
  ],
  matches: (record, filter, asOf) =>
    filter === "all" ||
    (filter === "open"
      ? priority(record, asOf) !== "closed"
      : priority(record, asOf) === filter),
  metrics: (records, asOf) => {
    const stats = summarize(records, asOf);
    return [
      {
        label: t("Renovaciones abiertas"),
        value: stats.open,
        detail: t("Casos que siguen en gestión"),
      },
      {
        label: t("Atención inmediata"),
        value: stats.urgent,
        detail: t("Vencidas o a 7 días del vencimiento"),
      },
      {
        label: t("Prima en gestión"),
        value: money(stats.premium, locale),
        detail: t("Prima de las renovaciones abiertas"),
      },
      {
        label: t("Renovadas"),
        value: stats.renewed,
        detail: t("%{count} cerradas sin renovación", {count: stats.lost}),
      },
    ];
  },
  columns: [
    {
      key: "customer",
      label: t("Cliente / Póliza"),
      render: (record) => (
        <>
           <strong>{text(record.customer)}</strong>
           <small>
             {text(record.policy_reference)} · {text(record.name)}
           </small>
         </>
      ),
    },
    {
      key: "expiry",
      label: t("Vencimiento"),
      render: (record, asOf) => {
        const group = priority(record, asOf);
        return (
          <>
             <span>{dateLabel(record.expiry_date, locale)}</span>
             <small>
               <span
                className="iw-badge"
                data-tone={
                  group === "overdue"
                    ? "danger"
                    : group === "week"
                      ? "warning"
                      : undefined
                }
              >
                 {t(priorityLabels[group] ?? "")}
               </span>
             </small>
           </>
        );
      },
    },
    {
      key: "premium",
      label: t("Prima (COP)"),
      numeric: true,
      render: (record) => (
        <>
           <strong>{money(record.premium, locale)}</strong>
           <small>{text(record.insurer) || t("Sin aseguradora")}</small>
         </>
      ),
    },
    {
      key: "stage",
      label: t("Etapa / Responsable"),
      render: (record) => (
        <>
           <span
            className="iw-badge"
            data-tone={record.stage === "renewed" ? "success" : undefined}
          >
             {t(stages.find((stage) => stage.value === record.stage)?.label ?? "") ??
              t("Sin etapa")}
           </span>
           <small>{text(record.owner) || t("Sin responsable")}</small>
         </>
      ),
    },
    {
      key: "followup",
      label: t("Próximo contacto"),
      render: (record) => dateLabel(record.next_follow_up, locale),
    },
  ],
  validate: validateRenewal,
  exportHeaders: [
    t("Referencia"),
    t("Cliente"),
    t("Póliza"),
    t("Aseguradora"),
    t("Responsable"),
    t("Vencimiento"),
    "Prima COP",
    t("Etapa"),
    t("Seguimiento"),
    t("Resultado"),
  ],
  exportRow: (record) => [
    record.name,
    record.customer,
    record.policy_reference,
    record.insurer,
    record.owner,
    record.expiry_date,
    record.premium,
    t(stages.find((stage) => stage.value === record.stage)?.label ?? ""),
    record.next_follow_up,
    record.outcome,
  ],
};
return localizeWorkbenchConfig(config, locale, messages);
}

export function RenewalsScreen({ savia }: { savia: PluginApi }) {
const locale = usePluginLocale();
const config = useMemo(() => createConfig(locale), [locale]);

  const [revision, setRevision] = useState(0);
  return (
    <>
      <Backfill savia={savia} onSaved={() => setRevision(revision + 1)} />
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
    Screen: RenewalsScreen,
  },
];
