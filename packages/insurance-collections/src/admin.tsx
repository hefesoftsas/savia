import type { PluginApi } from "@savia/crm-shared/plugin-api";
import {
  Workbench,
  money,
  dateLabel,
  text,
  type WorkbenchConfig,
} from "@savia/insurance-workbench";
import { cents } from "@savia/insurance-workbench/data";
import {
  aging,
  balance,
  paymentPatch,
  stages,
  validateAccount,
} from "./domain";
import { manifest } from "./manifest";
import { requirement } from "./object";
const agingLabels: Record<string, string> = {
  current: "Al día",
  "1-30": "Mora 1–30 días",
  "31-60": "Mora 31–60 días",
  "61+": "Mora +60 días",
  settled: "Pagada",
  undated: "Sin vencimiento",
  invalid: "Revisar saldo",
};
const config: WorkbenchConfig = {
  object: requirement.object.name,
  title: "Cartera",
  singular: "Cuenta por cobrar",
  createLabel: "Nueva cuenta",
  description:
    "Prioriza los cobros, registra abonos y da continuidad a cada compromiso.",
  stages,
  defaults: { stage: "pending", paid: 0 },
  fields: [
    { key: "name", label: "Referencia", required: true, maxLength: 120 },
    { key: "customer", label: "Cliente", required: true },
    { key: "policy_reference", label: "Póliza", maxLength: 120 },
    { key: "insurer", label: "Aseguradora" },
    { key: "owner", label: "Responsable", maxLength: 120 },
    { key: "due_date", label: "Vencimiento", type: "date", required: true },
    {
      key: "amount",
      label: "Valor de la cuenta (COP)",
      type: "number",
      required: true,
      min: 0.01,
    },
    {
      key: "paid",
      label: "Acumulado pagado (COP)",
      type: "number",
      required: true,
      min: 0,
      help: "Para agregar un pago recibido usa Registrar abono. Este campo permite corregir el acumulado.",
    },
    { key: "last_payment_date", label: "Último pago", type: "date" },
    {
      key: "stage",
      label: "Etapa de gestión",
      type: "select",
      options: stages,
      required: true,
    },
    { key: "next_follow_up", label: "Próximo seguimiento", type: "date" },
    {
      key: "notes",
      label: "Notas de gestión",
      type: "textarea",
      help: "Registra acuerdos, compromisos y el siguiente paso.",
    },
  ],
  filters: [
    { value: "all", label: "Todas" },
    { value: "overdue", label: "Vencidas" },
    { value: "current", label: "Al día" },
    { value: "promise", label: "Compromisos" },
    { value: "settled", label: "Pagadas" },
    { value: "review", label: "Por revisar" },
  ],
  matches: (record, filter, asOf) =>
    filter === "all" ||
    (filter === "overdue"
      ? ["1-30", "31-60", "61+"].includes(aging(record, asOf))
      : filter === "promise"
        ? record.stage === "promise" && (balance(record) ?? 0) > 0
        : filter === "review"
          ? ["undated", "invalid"].includes(aging(record, asOf))
          : aging(record, asOf) === filter),
  metrics: (records, asOf) => {
    const sum = (items: typeof records) =>
      items.reduce(
        (total, record) => total + (cents(balance(record)) ?? 0),
        0,
      ) / 100;
    const overdue = records.filter((record) =>
      ["1-30", "31-60", "61+"].includes(aging(record, asOf)),
    );
    return [
      {
        label: "Saldo por cobrar",
        value: money(sum(records)),
        detail: "Saldo de cuentas con valores válidos",
      },
      {
        label: "Saldo vencido",
        value: money(sum(overdue)),
        detail: `${overdue.length} cuentas requieren atención`,
      },
      {
        label: "Mora de más de 60 días",
        value: money(
          sum(records.filter((record) => aging(record, asOf) === "61+")),
        ),
        detail: "Prioridad de recuperación",
      },
      {
        label: "Cuentas pagadas",
        value: records.filter((record) => balance(record) === 0).length,
        detail: `${records.length} cuentas en total`,
      },
    ];
  },
  columns: [
    {
      key: "customer",
      label: "Cliente / Cuenta",
      render: (record) => (
        <>
          <strong>{text(record.customer)}</strong>
          <small>
            {text(record.name)} ·{" "}
            {text(record.policy_reference) || "Sin póliza"}
          </small>
        </>
      ),
    },
    {
      key: "due",
      label: "Vencimiento",
      render: (record, asOf) => {
        const group = aging(record, asOf);
        return (
          <>
            <span>{dateLabel(record.due_date)}</span>
            <small>
              <span
                className="iw-badge"
                data-tone={
                  group === "settled"
                    ? "success"
                    : ["1-30", "31-60", "61+"].includes(group)
                      ? "danger"
                      : undefined
                }
              >
                {agingLabels[group]}
              </span>
            </small>
          </>
        );
      },
    },
    {
      key: "balance",
      label: "Saldo (COP)",
      numeric: true,
      render: (record) => (
        <>
          <strong>{money(balance(record))}</strong>
          <small>de {money(record.amount)}</small>
        </>
      ),
    },
    {
      key: "stage",
      label: "Gestión",
      render: (record) => (
        <>
          <span>
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
  validate: validateAccount,
  payment: { balance, patch: paymentPatch },
  exportHeaders: [
    "Referencia",
    "Cliente",
    "Póliza",
    "Aseguradora",
    "Responsable",
    "Vencimiento",
    "Valor COP",
    "Pagado COP",
    "Saldo COP",
    "Etapa",
    "Seguimiento",
  ],
  exportRow: (record) => [
    record.name,
    record.customer,
    record.policy_reference,
    record.insurer,
    record.owner,
    record.due_date,
    record.amount,
    record.paid,
    balance(record),
    stages.find((stage) => stage.value === record.stage)?.label,
    record.next_follow_up,
  ],
};
export function CollectionsScreen({ savia }: { savia: PluginApi }) {
  return <Workbench savia={savia} config={config} />;
}
export const screens = [
  {
    id: `${manifest.id}.worklist`,
    extensionId: manifest.id,
    object: requirement.object.name,
    view: "records",
    Screen: CollectionsScreen,
  },
];
