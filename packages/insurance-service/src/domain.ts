import { validateFields, duePriority } from "@savia/insurance-workbench/schema";
import { day } from "@savia/insurance-workbench/data";
import { fields, closedStages, dateField } from "./fields";
export function priority(record: Record<string, unknown>, asOf: string) {
  return duePriority(record, dateField, closedStages, asOf);
}
export function validate(record: Record<string, unknown>): string | null {
  const error = validateFields(fields, record);
  if (error) return error;
  if (day(record.due_date)! < day(record.received_date)!)
    return "El compromiso de respuesta no puede preceder a la recepción.";
  if (
    record.resolved_date &&
    day(record.resolved_date)! < day(record.received_date)!
  )
    return "La resolución no puede preceder a la recepción.";
  for (const key of ["escalation_date", "escalated_date", "response_date"]) {
    if (record[key] && day(record[key])! < day(record.received_date)!)
      return "Las fechas de respuesta y escalamiento no pueden preceder a la recepción.";
  }
  if (record.escalation_date && !String(record.escalation_owner ?? "").trim())
    return "Indica el responsable del escalamiento.";
  return null;
}

export function escalate(record: Record<string, unknown>, asOf: string) {
  const scheduled = day(record.escalation_date),
    now = day(asOf);
  if (
    closedStages.includes(String(record.stage)) ||
    scheduled === null ||
    now === null ||
    now < scheduled ||
    !String(record.escalation_owner ?? "").trim()
  )
    throw new Error(
      "Revisa la fecha y el responsable antes de escalar una solicitud abierta.",
    );
  return {
    owner: String(record.escalation_owner),
    stage: "in_progress",
    escalated_date: asOf,
  };
}
