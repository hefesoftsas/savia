import type { PluginApi } from "@savia/studio-shared/plugin-api";
import { cents, csv } from "@savia/insurance-workbench/data";
export function exact(value: unknown): number {
  const n = cents(value);
  if (n === null)
    throw new Error("Usa un importe positivo con máximo dos decimales.");
  return n;
}
export function sum(values: number[]): number {
  const total = values.reduce((a, b) => a + BigInt(b), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < 0n)
    throw new Error("El total está fuera del rango permitido.");
  return Number(total);
}
export function decimal(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
export function download(name: string, rows: unknown[][]) {
  const url = URL.createObjectURL(
    new Blob([csv(rows)], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function saveState<T extends Record<string, unknown>>(
  savia: PluginApi,
  state: T,
  version: number,
) {
  if (!Number.isInteger(version) || version < 0)
    throw new Error("Actualiza antes de guardar.");
  return savia.settings.replace(state, version);
}
