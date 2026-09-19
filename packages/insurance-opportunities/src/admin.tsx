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
import { priority, validate, weightedPremium } from "./domain";
const config = caseConfig({
  object: requirement.object.name,
  title: manifest.label,
  singular: "Oportunidad comercial",
  createLabel: "Nueva oportunidad",
  description:
    "Organiza tu gestión comercial y convierte cada conversación en un siguiente paso.",
  dateTitle: "Cierre esperado",
  fields,
  stages,
  dateField,
  priority,
  validate,
  defaults: { stage: "lead", probability: 0, premium: 0 },
  valueColumn: {
    key: "premium",
    label: "Prima / Probabilidad",
    numeric: true,
    render: (record) => (
      <>
        <strong>{money(record.premium)}</strong>
        <small>
          {String(record.probability ?? 0)} % ·{" "}
          {text(record.product) || "Sin producto"}
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
        label: "Oportunidades abiertas",
        value: open.length,
        detail: "Negocios que siguen en gestión",
      },
      {
        label: "Prima potencial",
        value: money(sum(open, "premium")),
        detail: "Estimación sin ponderar",
      },
      {
        label: "Prima ponderada",
        value: money(
          open.reduce(
            (sum, record) => sum + (cents(weightedPremium(record)) ?? 0),
            0,
          ) / 100,
        ),
        detail: "Estimación según probabilidad registrada",
      },
      {
        label: "Ganadas",
        value: countBy(records, "stage", "won"),
        detail: `${countBy(records, "stage", "lost")} oportunidades perdidas`,
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
