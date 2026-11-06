import { cents, day } from "@savia/insurance-workbench/data";
export type Row = { id: string; [key: string]: unknown };
export function customerRecords(records: Row[], id: string): Row[] {
  return records.filter((r) => r.customer_id === id || r.cliente === id);
}
export function summarize(data: Record<string, Row[]>, asOf: string) {
  let receivableCents = 0,
    invalidAmounts = 0;
  for (const row of data.insurance_receivables ?? []) {
    const amount = cents(row.amount),
      paid = cents(row.paid ?? 0);
    if (amount === null || paid === null || paid > amount) {
      invalidAmounts++;
      continue;
    }
    receivableCents += amount - paid;
    if (!Number.isSafeInteger(receivableCents))
      throw Error("El total excede el rango seguro.");
  }
  const current = day(asOf);
  if (current === null) throw Error("Fecha de corte inválida.");
  const renewals = data.insurance_renewals ?? [];
  const won = (data.insurance_opportunities ?? []).filter(
    (r) => r.stage === "won",
  ).length;
  const lost = renewals.filter((r) => r.stage === "lost").length,
    renewed = renewals.filter((r) => r.stage === "renewed").length;
  return {
    receivableCents,
    invalidAmounts,
    won,
    renewed,
    lost,
    retention: renewed + lost ? renewed / (renewed + lost) : null,
    overdue: Object.entries(data).flatMap(([name, rows]) =>
      rows.filter((r) => {
        const dates: Record<string, string> = {
          insurance_renewals: "expiry_date",
          insurance_claims: "next_follow_up",
          insurance_opportunities: "target_date",
        };
        if (
          [
            "closed",
            "paid",
            "resolved",
            "cancelled",
            "renewed",
            "lost",
            "approved",
            "waived",
            "delivered",
            "completed",
            "won",
            "rejected",
          ].includes(String(r.stage))
        )
          return false;
        if (["insurance_receivables", "insurance_commissions"].includes(name)) {
          const amount = cents(r.amount),
            paid = cents(r.paid ?? 0);
          if (amount !== null && paid !== null && paid >= amount) return false;
        }
        const deadline = day(r[dates[name] ?? "due_date"]);
        return deadline !== null && deadline < current;
      }),
    ).length,
  };
}
