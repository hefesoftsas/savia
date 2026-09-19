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
  singular: "Solicitud de servicio",
  createLabel: "Nueva solicitud",
  description: manifest.description,
  dateTitle: "Compromiso de respuesta",
  fields,
  stages,
  dateField,
  priority,
  validate,
  defaults: { stage: "received", kind: "query", channel: "email" },
  footerNote: "Fechas calendario · Bogotá",
  valueColumn: {
    key: "kind",
    label: "Solicitud / Canal",
    render: (record) => (
      <>
        <strong>{fieldLabel(fields, "kind", record.kind)}</strong>
        <small>{fieldLabel(fields, "channel", record.channel)}</small>
      </>
    ),
  },
  metrics: (records, asOf) => [
    {
      label: "Solicitudes abiertas",
      value: records.filter((record) => priority(record, asOf) !== "closed")
        .length,
      detail: "Casos que necesitan seguimiento",
    },
    {
      label: "Respuesta atrasada",
      value: records.filter((record) => priority(record, asOf) === "overdue")
        .length,
      detail: "Compromisos de respuesta vencidos",
    },
    {
      label: "Esperando información",
      value: countBy(records, "stage", "waiting"),
      detail: "Retoma la gestión al recibir respuesta",
    },
    {
      label: "Resueltas",
      value: countBy(records, "stage", "resolved"),
      detail: "Con respuesta y fecha registradas",
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
