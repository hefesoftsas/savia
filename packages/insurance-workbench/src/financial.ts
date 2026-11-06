import { cents, day, type WorkRecord } from "./data";
export function balance(record: Record<string, unknown>): number | null {
  const amount = cents(record.amount),
    paid = cents(record.paid ?? 0);
  return amount === null || paid === null || paid > amount
    ? null
    : (amount - paid) / 100;
}
export function paymentPatch(record: WorkRecord, amount: string, date: string) {
  const payment = cents(amount),
    remaining = balance(record);
  if (
    payment === null ||
    payment <= 0 ||
    remaining === null ||
    payment > (cents(remaining) ?? 0)
  )
    throw new Error(
      "El abono debe ser mayor que cero y no superar el saldo, con máximo dos decimales.",
    );
  if (day(date) === null) throw new Error("Indica una fecha de pago válida.");
  return {
    paid: ((cents(record.paid ?? 0) ?? 0) + payment) / 100,
    last_payment_date:
      (day(record.last_payment_date) ?? -Infinity) > day(date)!
        ? String(record.last_payment_date).slice(0, 10)
        : date.slice(0, 10),
  };
}
