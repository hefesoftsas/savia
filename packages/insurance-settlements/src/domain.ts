import { z } from "zod";
import { exact, sum } from "./support";
export type Line = {
  source: string;
  sourceVersion?: number;
  owner: string;
  amount: number;
};
export type Batch = {
  id: string;
  createdAt: string;
  rate: string;
  adjustment: number;
  total: number;
  lines: Line[];
};
export type State = { batches: Batch[] };
export const defaults: State = { batches: [] };
const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const stateSchema = z
  .object({
    batches: z
      .array(
        z.object({
          id: z.string(),
          createdAt: z.string(),
          rate: z.string(),
          adjustment: z
            .number()
            .int()
            .min(-Number.MAX_SAFE_INTEGER)
            .max(Number.MAX_SAFE_INTEGER),
          total: integer,
          lines: z
            .array(
              z.object({
                source: z.string(),
                sourceVersion: z.number().optional(),
                owner: z.string(),
                amount: integer,
              }),
            )
            .max(200),
        }),
      )
      .max(50),
  })
  .strict()
  .superRefine((s, c) => {
    const sources = new Set<string>();
    for (const batch of s.batches) {
      if (
        batch.lines.reduce(
          (n, l) => n + BigInt(l.amount),
          BigInt(batch.adjustment),
        ) !== BigInt(batch.total)
      )
        c.addIssue({ code: "custom", message: "Total inconsistente." });
      for (const line of batch.lines) {
        if (sources.has(line.source))
          c.addIssue({ code: "custom", message: "Comisión ya liquidada." });
        sources.add(line.source);
      }
    }
  });
export function settle(
  records: Record<string, unknown>[],
  rate: unknown,
  adjustment: unknown,
): Omit<Batch, "id" | "createdAt"> {
  const percent = exact(rate);
  if (percent > 10000 || !records.length || records.length > 200)
    throw new Error(
      "Selecciona entre 1 y 200 comisiones y una tasa de 0 a 100.",
    );
  const raw = String(adjustment);
  const delta = (raw.startsWith("-") ? -1 : 1) * exact(raw.replace(/^-/, ""));
  const lines = records.map((r) => {
    const paid = exact(r.paid),
      expected = exact(r.amount);
    if (paid <= 0 || paid !== expected || !r.id)
      throw new Error("La comisión contiene valores inválidos.");
    return {
      source: String(r.id),
      owner: String(r.owner ?? "Sin responsable"),
      amount: Number((BigInt(paid) * BigInt(percent) + 5000n) / 10000n),
      ...(typeof r._version === "number" ? { sourceVersion: r._version } : {}),
    };
  });
  const total = sum([...lines.map((l) => l.amount), delta]);
  return { lines, total, rate: String(rate), adjustment: delta };
}
export function addBatch(state: State, batch: Batch): State {
  return stateSchema.parse({ batches: [...state.batches, batch] });
}
