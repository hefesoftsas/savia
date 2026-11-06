import { validateFields, duePriority } from "@savia/insurance-workbench/schema";
import { cents, day } from "@savia/insurance-workbench/data";
import { fields, closedStages, dateField } from "./fields";
export function priority(record: Record<string, unknown>, asOf: string) {
  return duePriority(record, dateField, closedStages, asOf);
}
export function validate(record: Record<string, unknown>): string | null {
  const error = validateFields(fields, record);
  if (error) return error;
  return null;
}
