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
const config = caseConfig({
  object: requirement.object.name,
  title: manifest.label,
  singular: "Siniestro",
  createLabel: "Nuevo siniestro",
  description: "Acompaña cada reclamación, desde el aviso hasta su resolución.",
  dateTitle: "Próximo seguimiento",
  fields,
  stages,
  dateField,
  priority,
  validate,
  defaults: { stage: "reported", amount: 0, paid: 0 },
  valueColumn: {
    key: "amount",
    label: "Reclamado / Recibido (COP)",
    numeric: true,
    render: (record) => (
      <>
        <strong>{money(record.amount)}</strong>
        <small>Recibido: {money(record.paid)}</small>
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
        label: "Casos abiertos",
        value: open.length,
        detail: "Reclamaciones en seguimiento",
      },
      {
        label: "Seguimientos atrasados",
        value: overdue.length,
        detail: "Próxima gestión pendiente",
      },
      {
        label: "Valor reclamado abierto",
        value: money(sum(open, "amount")),
        detail: "Valores registrados en los casos",
      },
      {
        label: "Casos resueltos",
        value: records.length - open.length,
        detail: "Cerrados o rechazados",
      },
    ];
  },
});
export function Screen({ savia }: { savia: PluginApi }) {
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
