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
import { priority, validate, calculatedCommission } from "./domain";
import { balance, paymentPatch } from "@savia/insurance-workbench/financial";
const config = caseConfig({
  object: requirement.object.name,
  title: manifest.label,
  singular: "Comisión",
  createLabel: "Nueva comisión",
  description:
    "Concilia lo esperado, registra lo recibido y controla cada diferencia.",
  dateTitle: "Recaudo previsto",
  fields,
  stages,
  dateField,
  priority,
  validate,
  defaults: { stage: "pending", paid: 0, seller_share: 0 },
  payment: { balance, patch: paymentPatch },
  valueColumn: {
    key: "balance",
    label: "Por recaudar (COP)",
    numeric: true,
    render: (record) => (
      <>
        <strong>{money(balance(record))}</strong>
        <small>
          Estimación por tasa:{" "}
          {money(calculatedCommission(record.premium, record.rate))}
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
        label: "Por recaudar",
        value: money(
          open.reduce((sum, record) => sum + (cents(balance(record)) ?? 0), 0) /
            100,
        ),
        detail: "Saldo de comisiones con valores válidos",
      },
      {
        label: "Recaudo registrado",
        value: money(sum(records, "paid")),
        detail: "Acumulado recibido de aseguradoras",
      },
      {
        label: "Participación del vendedor",
        value: money(sum(records, "seller_share")),
        detail: "Asignación prevista, no pago realizado",
      },
      {
        label: "Diferencias por revisar",
        value: countBy(records, "stage", "disputed"),
        detail: "Registros pendientes de conciliación",
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
