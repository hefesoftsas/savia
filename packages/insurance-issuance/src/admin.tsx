import { DeliveryAction } from "./actions";
import type { PluginApi } from "@savia/crm-shared/plugin-api";
import { cents } from "@savia/insurance-workbench/data";
import { Workbench, money, text } from "@savia/insurance-workbench";
import { caseConfig, countBy } from "@savia/insurance-workbench/case-config";
import { fields, stages, dateField } from "./fields";
import { manifest } from "./manifest";
import { requirement } from "./object";
import { priority, validate } from "./domain";
const config = caseConfig({
  object: requirement.object.name,
  title: manifest.label,
  singular: "Solicitud de emisión",
  createLabel: "Nueva emisión",
  description: manifest.description,
  dateTitle: "Compromiso de entrega",
  fields,
  stages,
  dateField,
  priority,
  validate,
  defaults: { stage: "requested" },
  footerNote: "Valores en COP · Fechas calendario en Bogotá",
  valueColumn: {
    key: "premium",
    label: "Prima / Producto",
    render: (record) => (
      <>
        <strong>
          {money(
            cents(record.premium) === null ? null : Number(record.premium),
          )}
        </strong>
        <small>{text(record.product) || "Sin producto indicado"}</small>
      </>
    ),
  },
  metrics: (records, asOf) => [
    {
      label: "Emisiones abiertas",
      value: records.filter((record) => priority(record, asOf) !== "closed")
        .length,
      detail: "Pendientes de expedición o entrega",
    },
    {
      label: "Entrega atrasada",
      value: records.filter((record) => priority(record, asOf) === "overdue")
        .length,
      detail: "Compromisos de entrega vencidos",
    },
    {
      label: "Por entregar",
      value: countBy(records, "stage", "issued"),
      detail: "Expedidas, pendientes del cliente",
    },
    {
      label: "Entregadas",
      value: countBy(records, "stage", "delivered"),
      detail: "Con fecha de entrega registrada",
    },
  ],
});
export function Screen({ savia }: { savia: PluginApi }) {
  return (
    <Workbench
      savia={savia}
      config={{
        ...config,
        recordActions: (props) => <DeliveryAction {...props} />,
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
