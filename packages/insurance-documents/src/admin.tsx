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
const config = caseConfig({
  object: requirement.object.name,
  title: manifest.label,
  singular: "Requisito documental",
  createLabel: "Nuevo requisito",
  description: manifest.description,
  dateTitle: "Fecha de compromiso",
  fields,
  stages,
  dateField,
  priority,
  validate,
  defaults: { stage: "requested", kind: "application" },
  footerNote: "Fechas calendario · Bogotá",
  valueColumn: {
    key: "kind",
    label: "Documento / Evidencia",
    render: (record) => (
      <>
        <strong>{fieldLabel(fields, "kind", record.kind)}</strong>
        <small>
          {record.evidence_reference ? "Evidencia registrada" : "Sin evidencia"}
        </small>
      </>
    ),
  },
  metrics: (records, asOf) => [
    {
      label: "Requisitos pendientes",
      value: records.filter((record) => priority(record, asOf) !== "closed")
        .length,
      detail: "Solicitados, recibidos o por corregir",
    },
    {
      label: "Atrasados",
      value: records.filter((record) => priority(record, asOf) === "overdue")
        .length,
      detail: "Fecha de compromiso vencida",
    },
    {
      label: "Por revisar",
      value: countBy(records, "stage", "received"),
      detail: "Recepciones pendientes de revisión",
    },
    {
      label: "Aprobados",
      value: countBy(records, "stage", "approved"),
      detail: "Con revisión documentada",
    },
  ],
});
export function Screen({ savia }: { savia: PluginApi }) {
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
