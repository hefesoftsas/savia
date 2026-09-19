import { z } from "zod";
import { csv } from "@savia/insurance-workbench/data";
import { exact, decimal } from "./support";
export type Entry = {
  source: string;
  reference: string;
  account: string;
  debit: number;
  credit: number;
};
export type Batch = { id: string; createdAt: string; entries: Entry[] };
export type State = { batches: Batch[] };
export const defaults: State = { batches: [] };
const minor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const stateSchema = z
  .object({
    batches: z
      .array(
        z.object({
          id: z.string(),
          createdAt: z.string(),
          entries: z
            .array(
              z.object({
                source: z.string(),
                reference: z.string(),
                account: z.string().min(1),
                debit: minor,
                credit: minor,
              }),
            )
            .max(400),
        }),
      )
      .max(50),
  })
  .strict()
  .superRefine((s, c) => {
    const seen = new Set<string>();
    for (const b of s.batches) {
      const sources = new Set(b.entries.map((e) => e.source));
      for (const source of sources) {
        if (seen.has(source))
          c.addIssue({ code: "custom", message: "Factura ya exportada." });
        seen.add(source);
        const lines = b.entries.filter((e) => e.source === source);
        if (
          lines.reduce((n, e) => n + BigInt(e.debit) - BigInt(e.credit), 0n) !==
          0n
        )
          c.addIssue({ code: "custom", message: "Comprobante desbalanceado." });
      }
    }
  });
export function journal(
  records: Record<string, unknown>[],
  receivable: string,
  revenue: string,
): Entry[] {
  if (
    !receivable.trim() ||
    !revenue.trim() ||
    receivable.trim() === revenue.trim()
  )
    throw new Error("Indica dos cuentas contables diferentes.");
  if (!records.length || records.length > 200)
    throw new Error("Selecciona entre 1 y 200 obligaciones.");
  return records.flatMap((r) => {
    const amount = exact(r.amount);
    if (!amount || !r.id)
      throw new Error(
        "La factura debe tener un importe positivo y un identificador.",
      );
    return [
      {
        source: String(r.id),
        reference: String(r.name ?? r.id),
        account: receivable.trim(),
        debit: amount,
        credit: 0,
      },
      {
        source: String(r.id),
        reference: String(r.name ?? r.id),
        account: revenue.trim(),
        debit: 0,
        credit: amount,
      },
    ];
  });
}
export function exportJournal(entries: Entry[]): string {
  return csv([
    ["source", "reference", "account", "debit", "credit"],
    ...entries.map((e) => [
      e.source,
      e.reference,
      e.account,
      decimal(e.debit),
      decimal(e.credit),
    ]),
  ]);
}
export function addBatch(state: State, batch: Batch): State {
  return stateSchema.parse({ batches: [...state.batches, batch] });
}
