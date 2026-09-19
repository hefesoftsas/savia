import { useState } from "react";
import { Backfill } from "./backfill";
import type { PluginApi } from "@savia/crm-shared/plugin-api";
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
const config: WorkbenchConfig = {
  object: requirement.object.name,
  title: "Renovaciones",
  singular: "Renovación de póliza",
  createLabel: "Nueva renovación",
  description:
    "Anticipa cada vencimiento y acompaña la renovación hasta su cierre.",
  stages,
  defaults: { stage: "pending", premium: 0 },
  fields: [
    { key: "name", label: "Referencia", required: true, maxLength: 120 },
    { key: "customer", label: "Cliente", required: true },
    {
      key: "policy_reference",
      label: "Póliza actual",
      required: true,
      maxLength: 120,
    },
    { key: "insurer", label: "Aseguradora" },
    { key: "owner", label: "Responsable", maxLength: 120 },
    {
      key: "expiry_date",
      label: "Vencimiento de la póliza",
      type: "date",
      required: true,
    },
    {
      key: "premium",
      label: "Prima a renovar (COP)",
      type: "number",
      required: true,
      min: 0,
    },
    {
      key: "stage",
      label: "Etapa",
      type: "select",
      options: stages,
      required: true,
    },
    { key: "next_follow_up", label: "Próximo seguimiento", type: "date" },
    {
      key: "outcome",
      label: "Nueva póliza o motivo de cierre",
      maxLength: 500,
      help: "Obligatorio al marcar Renovada o No renovada.",
    },
    {
      key: "notes",
      label: "Notas de gestión",
      type: "textarea",
      help: "Conserva aquí las condiciones, documentos pendientes y próximos pasos.",
    },
  ],
  filters: [
    { value: "all", label: "Todas" },
    { value: "overdue", label: "Vencidas" },
    { value: "week", label: "Esta semana" },
    { value: "month", label: "8–30 días" },
    { value: "open", label: "Abiertas" },
    { value: "closed", label: "Cerradas" },
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
        label: "Renovaciones abiertas",
        value: stats.open,
        detail: "Casos que siguen en gestión",
      },
      {
        label: "Atención inmediata",
        value: stats.urgent,
        detail: "Vencidas o a 7 días del vencimiento",
      },
      {
        label: "Prima en gestión",
        value: money(stats.premium),
        detail: "Prima de las renovaciones abiertas",
      },
      {
        label: "Renovadas",
        value: stats.renewed,
        detail: `${stats.lost} cerradas sin renovación`,
      },
    ];
  },
  columns: [
    {
      key: "customer",
      label: "Cliente / Póliza",
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
      label: "Vencimiento",
      render: (record, asOf) => {
        const group = priority(record, asOf);
        return (
          <>
            <span>{dateLabel(record.expiry_date)}</span>
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
                {priorityLabels[group]}
              </span>
            </small>
          </>
        );
      },
    },
    {
      key: "premium",
      label: "Prima (COP)",
      numeric: true,
      render: (record) => (
        <>
          <strong>{money(record.premium)}</strong>
          <small>{text(record.insurer) || "Sin aseguradora"}</small>
        </>
      ),
    },
    {
      key: "stage",
      label: "Etapa / Responsable",
      render: (record) => (
        <>
          <span
            className="iw-badge"
            data-tone={record.stage === "renewed" ? "success" : undefined}
          >
            {stages.find((stage) => stage.value === record.stage)?.label ??
              "Sin etapa"}
          </span>
          <small>{text(record.owner) || "Sin responsable"}</small>
        </>
      ),
    },
    {
      key: "followup",
      label: "Próximo contacto",
      render: (record) => dateLabel(record.next_follow_up),
    },
  ],
  validate: validateRenewal,
  exportHeaders: [
    "Referencia",
    "Cliente",
    "Póliza",
    "Aseguradora",
    "Responsable",
    "Vencimiento",
    "Prima COP",
    "Etapa",
    "Seguimiento",
    "Resultado",
  ],
  exportRow: (record) => [
    record.name,
    record.customer,
    record.policy_reference,
    record.insurer,
    record.owner,
    record.expiry_date,
    record.premium,
    stages.find((stage) => stage.value === record.stage)?.label,
    record.next_follow_up,
    record.outcome,
  ],
};
export function RenewalsScreen({ savia }: { savia: PluginApi }) {
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
