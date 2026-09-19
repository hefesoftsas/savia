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
  singular: "Actividad",
  createLabel: "Nueva actividad",
  description: "Ten a mano tus llamadas, reuniones y compromisos pendientes.",
  dateTitle: "Fecha de compromiso",
  fields,
  stages,
  dateField,
  priority,
  validate,
  defaults: { stage: "scheduled", kind: "task", importance: "normal" },
  footerNote: "Fechas calendario · Bogotá",
  valueColumn: {
    key: "kind",
    label: "Tipo / Prioridad",
    render: (record) => (
      <>
        <strong>{fieldLabel(fields, "kind", record.kind)}</strong>
        <small>
          <span
            className="iw-badge"
            data-tone={
              record.importance === "urgent"
                ? "danger"
                : record.importance === "high"
                  ? "warning"
                  : undefined
            }
          >
            {fieldLabel(fields, "importance", record.importance)}
          </span>
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
        label: "Actividades abiertas",
        value: open.length,
        detail: "Compromisos que siguen pendientes",
      },
      {
        label: "Para hoy",
        value: records.filter((record) => priority(record, asOf) === "today")
          .length,
        detail: "Según fecha de compromiso",
      },
      {
        label: "Atrasadas",
        value: overdue.length,
        detail: "Reprograma o registra el resultado",
      },
      {
        label: "Realizadas",
        value: countBy(records, "stage", "completed"),
        detail: "Actividades con resultado documentado",
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
