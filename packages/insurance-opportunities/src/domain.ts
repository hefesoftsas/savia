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
export function calculatedCommission(
  premium: unknown,
  rate: unknown,
): number | null {
  const base = cents(premium),
    percent = cents(rate);
  if (base === null || percent === null || percent > 10000) return null;
  const rounded = (BigInt(base) * BigInt(percent) + 5000n) / 10000n;
  return Number(rounded) / 100;
}
export function weightedPremium(record: Record<string, unknown>) {
  return calculatedCommission(record.premium, record.probability);
}
