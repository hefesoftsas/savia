import { validateFields, duePriority } from "@savia/insurance-workbench/schema";
import { cents, day } from "@savia/insurance-workbench/data";
import { balance } from "@savia/insurance-workbench/financial";
import { fields, closedStages, dateField } from "./fields";
export function priority(record: Record<string, unknown>, asOf: string) {
  return balance(record) === null
    ? "invalid"
    : balance(record) === 0
      ? "closed"
      : duePriority(record, dateField, closedStages, asOf);
}
export function validate(record: Record<string, unknown>): string | null {
  const error = validateFields(fields, record);
  if (error) return error;
  if (balance(record) === null)
    return "La comisión recibida no puede superar la esperada.";
  if (cents(record.seller_share)! > cents(record.amount)!)
    return "La participación del vendedor no puede superar la comisión esperada.";
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
