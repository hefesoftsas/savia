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
  singular: "Movimiento de póliza",
  createLabel: "Nuevo movimiento",
  description:
    "Da seguimiento a cambios de cobertura, inclusiones, exclusiones y anexos.",
  dateTitle: "Fecha de efecto",
  fields,
  stages,
  dateField,
  priority,
  validate,
  defaults: {
    stage: "requested",
    kind: "coverage",
    additional_premium: 0,
    refund: 0,
  },
  valueColumn: {
    key: "kind",
    label: "Movimiento / Prima",
    render: (record) => (
      <>
        <strong>{fieldLabel(fields, "kind", record.kind)}</strong>
        <small>
          Adicional: {money(record.additional_premium)} · Devolución:{" "}
          {money(record.refund)}
        </small>
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
        label: "Solicitudes abiertas",
        value: open.length,
        detail: "Movimientos pendientes de resolución",
      },
      {
        label: "Fecha de efecto vencida",
        value: overdue.length,
        detail: "Solicitudes que requieren revisión",
      },
      {
        label: "Prima adicional abierta",
        value: money(sum(open, "additional_premium")),
        detail: "Valor previsto de los movimientos",
      },
      {
        label: "Anexos expedidos",
        value: countBy(records, "stage", "issued"),
        detail: "Expedición registrada por el equipo",
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
