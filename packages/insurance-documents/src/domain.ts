import { validateFields, duePriority } from "@savia/insurance-workbench/schema";
import { day } from "@savia/insurance-workbench/data";
import { fields, closedStages, dateField } from "./fields";
export function priority(record: Record<string, unknown>, asOf: string) {
  if (isExpired(record, asOf)) return "overdue";
  return duePriority(record, dateField, closedStages, asOf);
}
export function validate(record: Record<string, unknown>): string | null {
  const error = validateFields(fields, record);
  if (error) return error;
  if (day(record.due_date)! < day(record.requested_date)!)
    return "El compromiso no puede preceder a la solicitud.";
  if (
    record.received_date &&
    day(record.received_date)! < day(record.requested_date)!
  )
    return "La recepción no puede preceder a la solicitud.";
  if (
    record.reviewed_date &&
    (!record.received_date ||
      day(record.reviewed_date)! < day(record.received_date)!)
  )
    return "La revisión requiere una recepción anterior o del mismo día.";
  if (
    record.valid_until &&
    day(record.valid_until)! <
      day(record.received_date ?? record.requested_date)!
  )
    return "La validez no puede finalizar antes de la recepción o solicitud.";
  return null;
}

export function isExpired(
  record: Record<string, unknown>,
  asOf: string,
): boolean {
  const expiry = day(record.valid_until),
    now = day(asOf);
  return (
    record.stage === "approved" &&
    expiry !== null &&
    now !== null &&
    expiry < now
  );
}
export function reopenExpired(record: Record<string, unknown>, asOf: string) {
  if (!isExpired(record, asOf))
    throw new Error("El documento no tiene una aprobación vencida.");
  return { stage: "changes", due_date: asOf };
}
