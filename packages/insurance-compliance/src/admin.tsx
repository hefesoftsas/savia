import { useState } from "react";
import type { PluginApi } from "@savia/crm-shared/plugin-api";
import { Workbench } from "@savia/insurance-workbench";
import { caseConfig } from "@savia/insurance-workbench/case-config";
import { fields, stages } from "./fields";
import { priority, readiness, validate } from "./domain";
import { manifest } from "./manifest";
import { requirement } from "./object";
import { Templates } from "./templates";
const config = caseConfig({
  object: requirement.object.name,
  title: manifest.label,
  singular: "Requisito de cumplimiento",
  createLabel: "Nuevo requisito",
  description: manifest.description,
  dateTitle: "Compromiso",
  fields,
  stages,
  dateField: "due_date",
  valueColumn: {
    key: "evidence",
    label: "Evidencia",
    render: (record) => String(record.evidence || "Pendiente"),
  },
  priority,
  validate,
  defaults: { stage: "pending" },
  footerNote: "Requisitos configurados por tu operación · Fechas calendario",
  metrics: (records, asOf) => {
    const totals = readiness(records, asOf);
    return [
      {
        label: "Requisitos",
        value: totals.total,
        detail: "En los expedientes del espacio",
      },
      {
        label: "Vigentes y revisados",
        value: totals.ready,
        detail: "Aprobados con evidencia o exentos con motivo",
      },
      {
        label: "Evidencia vencida",
        value: totals.expired,
        detail: "Requieren nueva revisión",
      },
      {
        label: "Pendientes",
        value: totals.total - totals.ready,
        detail: "Aún no listos para el expediente",
      },
    ];
  },
});
export function Screen({ savia }: { savia: PluginApi }) {
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
