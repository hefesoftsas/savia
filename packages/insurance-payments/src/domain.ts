import { z } from "zod";
import { day } from "@savia/insurance-workbench/data";
import { exact, sum } from "./support";
export type Transaction = {
  id: string;
  date: string;
  reference: string;
  amount: number;
};
export type Allocation = {
  transaction: string;
  obligation: string;
  amount: number;
  sourceVersion?: number;
};
export type State = { transactions: Transaction[]; allocations: Allocation[] };
export const defaults: State = { transactions: [], allocations: [] };
const minor = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const stateSchema = z
  .object({
    transactions: z
      .array(
        z.object({
          id: z.string().min(1).max(200),
          date: z.string().refine((v) => day(v) !== null),
          reference: z.string().max(200),
          amount: minor,
        }),
      )
      .max(200),
    allocations: z
      .array(
        z.object({
          transaction: z.string(),
          obligation: z.string(),
          amount: minor,
          sourceVersion: z.number().int().optional(),
        }),
      )
      .max(1000),
  })
  .strict()
  .superRefine((s, ctx) => {
    const ids = new Set(s.transactions.map((t) => t.id));
    if (ids.size !== s.transactions.length)
      ctx.addIssue({ code: "custom", message: "Transacción duplicada." });
    for (const a of s.allocations)
      if (!ids.has(a.transaction))
        ctx.addIssue({ code: "custom", message: "Transacción ausente." });
    for (const t of s.transactions)
      if (
        s.allocations
          .filter((a) => a.transaction === t.id)
          .reduce((n, a) => n + BigInt(a.amount), 0n) > BigInt(t.amount)
      )
        ctx.addIssue({ code: "custom", message: "Asignación excedida." });
  });
function rows(input: string): string[][] {
  const result: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" && !quoted) {
      row.push(cell.replace(/\r$/, ""));
      result.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("El CSV contiene comillas sin cerrar.");
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    result.push(row);
  }
  return result;
}
export function parseStatement(input: string, account: string): Transaction[] {
  if (!account.trim() || account.trim().length > 80)
    throw new Error("Indica una cuenta de máximo 80 caracteres.");
  const parsed = rows(input.replace(/^\uFEFF/, ""));
  if (parsed.shift()?.join(",") !== "id,date,reference,amount")
    throw new Error("Encabezado requerido: id,date,reference,amount");
  if (!parsed.length || parsed.length > 200)
    throw new Error("Importa entre 1 y 200 movimientos.");
  return parsed.map((row, index) => {
    if (
      row.length !== 4 ||
      !row[0].trim() ||
      day(row[1]) === null ||
      row[1].length !== 10
    )
      throw new Error(
        `Revisa la fila ${index + 2}: identificador, fecha o columnas inválidas.`,
      );
    const amount = exact(row[3]);
    if (!amount)
      throw new Error(`Fila ${index + 2}: el recaudo debe ser mayor que cero.`);
    return {
      id: `${encodeURIComponent(account.trim())}:${encodeURIComponent(row[0].trim())}`,
      date: row[1],
      reference: row[2],
      amount,
    };
  });
}
export function importStatement(state: State, rows: Transaction[]): State {
  const next = { ...state, transactions: [...state.transactions, ...rows] };
  return stateSchema.parse(next);
}
export function allocate(
  state: State,
  transaction: string,
  obligation: Record<string, unknown>,
  value: unknown,
): State {
  const amount = exact(value),
    t = state.transactions.find((t) => t.id === transaction);
  if (!t || amount <= 0 || typeof obligation.id !== "string")
    throw new Error("Selecciona movimiento, obligación e importe.");
  const outstanding = exact(obligation.amount) - exact(obligation.paid ?? 0);
  const used = sum(
    state.allocations
      .filter((a) => a.obligation === obligation.id)
      .map((a) => a.amount),
  );
  if (amount > outstanding - used)
    throw new Error(
      "La asignación supera el saldo disponible de la obligación.",
    );
  return stateSchema.parse({
    ...state,
    allocations: [
      ...state.allocations,
      {
        transaction,
        obligation: obligation.id,
        amount,
        ...(typeof obligation._version === "number"
          ? { sourceVersion: obligation._version }
          : {}),
      },
    ],
  });
}
export function remaining(state: State, id: string): number {
  const t = state.transactions.find((t) => t.id === id);
  return t
    ? t.amount -
        sum(
          state.allocations
            .filter((a) => a.transaction === id)
            .map((a) => a.amount),
        )
    : 0;
}
