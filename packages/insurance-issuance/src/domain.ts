import { validateFields, duePriority } from "@savia/insurance-workbench/schema";
import { day } from "@savia/insurance-workbench/data";
import { fields, closedStages, dateField } from "./fields";
export function priority(record: Record<string, unknown>, asOf: string) {
  return duePriority(record, dateField, closedStages, asOf);
}
export function validate(record: Record<string, unknown>): string | null {
  const error = validateFields(fields, record);
  if (error) return error;
  if (day(record.end_date)! <= day(record.effective_date)!)
    return "El fin de vigencia debe ser posterior al inicio.";
  if (day(record.due_date)! < day(record.requested_date)!)
    return "El compromiso de entrega no puede preceder a la solicitud.";
  if (
    record.issued_date &&
    day(record.issued_date)! < day(record.requested_date)!
  )
    return "La expedición no puede preceder a la solicitud.";
  if (
    record.delivered_date &&
    (!record.issued_date ||
      day(record.delivered_date)! < day(record.issued_date)!)
  )
    return "La entrega requiere una expedición anterior o del mismo día.";
  return null;
}
