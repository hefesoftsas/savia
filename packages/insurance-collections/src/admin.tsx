import { useMemo } from "react";
import { usePluginLocale } from "@savia/crm-shared/plugin-locale-react";
import type { PluginLocale } from "@savia/crm-shared/plugin-localization";
import { createWorkbenchTranslator, localizeWorkbenchConfig } from "@savia/insurance-workbench";
import { messages } from "./messages";
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
function createConfig(locale: PluginLocale) {
const t = createWorkbenchTranslator(messages, locale);
const config: WorkbenchConfig = {
  object: requirement.object.name,
  title: t("Cartera"),
  singular: t("Cuenta por cobrar"),
  createLabel: t("Nueva cuenta"),
  description:
    t("Prioriza los cobros, registra abonos y da continuidad a cada compromiso."),
  stages,
  defaults: { stage: "pending", paid: 0 },
  fields: [
    { key: "name", label: t("Referencia"), required: true, maxLength: 120 },
    { key: "customer", label: t("Cliente"), required: true },
    { key: "policy_reference", label: t("Póliza"), maxLength: 120 },
    { key: "insurer", label: t("Aseguradora") },
    { key: "owner", label: t("Responsable"), maxLength: 120 },
    { key: "due_date", label: t("Vencimiento"), type: "date", required: true },
    {
      key: "amount",
      label: t("Valor de la cuenta (COP)"),
      type: "number",
      required: true,
      min: 0.01,
    },
    {
      key: "paid",
      label: t("Acumulado pagado (COP)"),
      type: "number",
      required: true,
      min: 0,
      help: t("Para agregar un pago recibido usa Registrar abono. Este campo permite corregir el acumulado."),
    },
    { key: "last_payment_date", label: t("Último pago"), type: "date" },
    {
      key: "stage",
      label: t("Etapa de gestión"),
      type: "select",
      options: stages,
      required: true,
    },
    { key: "next_follow_up", label: t("Próximo seguimiento"), type: "date" },
    {
      key: "notes",
      label: t("Notas de gestión"),
      type: "textarea",
      help: t("Registra acuerdos, compromisos y el siguiente paso."),
    },
  ],
  filters: [
    { value: "all", label: t("Todas") },
    { value: "overdue", label: t("Vencidas") },
    { value: "current", label: t("Al día") },
    { value: "promise", label: t("Compromisos") },
    { value: "settled", label: t("Pagadas") },
    { value: "review", label: t("Por revisar") },
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
        label: t("Saldo por cobrar"),
        value: money(sum(records), locale),
        detail: t("Saldo de cuentas con valores válidos"),
      },
      {
        label: t("Saldo vencido"),
        value: money(sum(overdue), locale),
        detail: t("%{count} cuentas requieren atención", {count: overdue.length}),
      },
      {
        label: t("Mora de más de 60 días"),
        value: money(
          sum(records.filter((record) => aging(record, asOf) === "61+")), locale
        ),
        detail: t("Prioridad de recuperación"),
      },
      {
        label: t("Cuentas pagadas"),
        value: records.filter((record) => balance(record) === 0).length,
        detail: t("%{count} cuentas en total", {count: records.length}),
      },
    ];
  },
  columns: [
    {
      key: "customer",
      label: t("Cliente / Cuenta"),
      render: (record) => (
        <>
           <strong>{text(record.customer)}</strong>
           <small>
             {text(record.name)} ·{" "}
             {text(record.policy_reference) || t("Sin póliza")}
           </small>
         </>
      ),
    },
    {
      key: "due",
      label: t("Vencimiento"),
      render: (record, asOf) => {
        const group = aging(record, asOf);
        return (
          <>
             <span>{dateLabel(record.due_date, locale)}</span>
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
                 {t(agingLabels[group] ?? "")}
               </span>
             </small>
           </>
        );
      },
    },
    {
      key: "balance",
      label: t("Saldo (COP)"),
      numeric: true,
      render: (record) => (
        <>
           <strong>{money(balance(record), locale)}</strong>
           <small>{t("de")} {money(record.amount, locale)}</small>
         </>
      ),
    },
    {
      key: "stage",
      label: t("Gestión"),
      render: (record) => (
        <>
           <span>
             {t(stages.find((stage) => stage.value === record.stage)?.label ?? "") ??
              t("Sin etapa")}
           </span>
           <small>{text(record.owner) || t("Sin responsable")}</small>
         </>
      ),
    },
    {
      key: "followup",
      label: t("Próximo contacto"),
      render: (record) => dateLabel(record.next_follow_up, locale),
    },
  ],
  validate: validateAccount,
  payment: { balance, patch: paymentPatch },
  exportHeaders: [
    t("Referencia"),
    t("Cliente"),
    t("Póliza"),
    t("Aseguradora"),
    t("Responsable"),
    t("Vencimiento"),
    "Valor COP",
    "Pagado COP",
    "Saldo COP",
    t("Etapa"),
    t("Seguimiento"),
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
    t(stages.find((stage) => stage.value === record.stage)?.label ?? ""),
    record.next_follow_up,
  ],
};
return localizeWorkbenchConfig(config, locale, messages);
}

export function CollectionsScreen({ savia }: { savia: PluginApi }) {
const locale = usePluginLocale();
const config = useMemo(() => createConfig(locale), [locale]);

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
