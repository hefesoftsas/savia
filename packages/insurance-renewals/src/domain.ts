import { cents, day, text } from "@savia/insurance-workbench/data";
export const stages = [
  { value: "pending", label: "Por contactar" },
  { value: "contacted", label: "Contactado" },
  { value: "negotiation", label: "En negociación" },
  { value: "documents", label: "Documentación" },
  { value: "issuance", label: "En expedición" },
  { value: "renewed", label: "Renovada" },
  { value: "lost", label: "No renovada" },
];
export function priority(
  record: Record<string, unknown>,
  asOf: string,
): string {
  if (record.stage === "renewed" || record.stage === "lost") return "closed";
  const expiry = day(record.expiry_date),
    now = day(asOf);
  if (expiry === null || now === null) return "undated";
  const days = expiry - now;
  return days < 0
    ? "overdue"
    : days <= 7
      ? "week"
      : days <= 30
        ? "month"
        : "later";
}
export function validateRenewal(
  record: Record<string, unknown>,
): string | null {
  if (
    !text(record.name).trim() ||
    !text(record.customer).trim() ||
    !text(record.policy_reference).trim()
  )
    return "Completa la referencia, el cliente y la póliza actual.";
  if (day(record.expiry_date) === null)
    return "Indica una fecha de vencimiento válida.";
  if (cents(record.premium) === null)
    return "La prima debe ser un valor no negativo con máximo dos decimales.";
  if (!stages.some((stage) => stage.value === record.stage))
    return "Selecciona una etapa válida.";
  if (record.next_follow_up && day(record.next_follow_up) === null)
    return "Revisa la fecha de seguimiento.";
  if (
    (record.stage === "renewed" || record.stage === "lost") &&
    !text(record.outcome).trim()
  )
    return record.stage === "renewed"
      ? "Indica la nueva póliza para cerrar la renovación."
      : "Indica el motivo de no renovación.";
  return null;
}
export function summarize(
  records: readonly Record<string, unknown>[],
  asOf: string,
) {
  const open = records.filter((record) => priority(record, asOf) !== "closed");
  return {
    open: open.length,
    urgent: open.filter((record) =>
      ["week", "overdue"].includes(priority(record, asOf)),
    ).length,
    renewed: records.filter((record) => record.stage === "renewed").length,
    lost: records.filter((record) => record.stage === "lost").length,
    premium:
      open.reduce((sum, record) => sum + (cents(record.premium) ?? 0), 0) / 100,
  };
}

export function planRenewal(
  policy: Record<string, unknown>,
  customer: string,
  leadDays: number,
) {
  const expiry = day(policy.fin);
  if (
    !text(policy.id) ||
    policy.estado !== "Vigente" ||
    !text(policy.cliente) ||
    !customer.trim() ||
    expiry === null ||
    cents(policy.prima) === null ||
    !Number.isInteger(leadDays) ||
    leadDays < 0 ||
    leadDays > 365
  )
    throw new Error(
      "Revisa la póliza vigente, cliente, prima, vencimiento y anticipación de 0 a 365 días.",
    );
  return {
    name: text(policy.name),
    customer,
    customer_id: text(policy.cliente),
    term_policy_id: text(policy.id),
    policy_reference: text(policy.name),
    term_key: `${policy.id}:${policy.fin}`,
    expiry_date: text(policy.fin),
    premium: Number(policy.prima),
    stage: "pending",
    next_follow_up: new Date((expiry - leadDays) * 86400000)
      .toISOString()
      .slice(0, 10),
  };
}
