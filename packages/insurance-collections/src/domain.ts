import { balance } from "@savia/insurance-workbench/financial";
export { balance, paymentPatch } from "@savia/insurance-workbench/financial";
import {
  cents,
  day,
  text,
  type WorkRecord,
} from "@savia/insurance-workbench/data";
export const stages = [
  { value: "pending", label: "Por gestionar" },
  { value: "contacted", label: "Contactado" },
  { value: "promise", label: "Promesa de pago" },
  { value: "disputed", label: "En revisión" },
];
export function aging(record: Record<string, unknown>, asOf: string): string {
  const remaining = balance(record);
  if (remaining === null) return "invalid";
  if (remaining === 0) return "settled";
  const due = day(record.due_date),
    now = day(asOf);
  if (due === null || now === null) return "undated";
  const late = now - due;
  return late <= 0
    ? "current"
    : late <= 30
      ? "1-30"
      : late <= 60
        ? "31-60"
        : "61+";
}
export function validateAccount(
  record: Record<string, unknown>,
): string | null {
  if (!text(record.name).trim() || !text(record.customer).trim())
    return "Completa la referencia y el cliente.";
  if (day(record.due_date) === null)
    return "Indica una fecha de vencimiento válida.";
  if (balance(record) === null || cents(record.amount) === 0)
    return "El valor debe ser positivo y el acumulado pagado debe estar entre cero y el valor de la cuenta, con máximo dos decimales.";
  if (!stages.some((stage) => stage.value === record.stage))
    return "Selecciona una etapa de gestión válida.";
  if (record.next_follow_up && day(record.next_follow_up) === null)
    return "Revisa la fecha de seguimiento.";
  return null;
}
