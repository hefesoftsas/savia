import { pluginIntlLocale, type PluginLocale } from "@savia/crm-shared/plugin-localization";
import type { PluginApi } from "@savia/crm-shared/plugin-api";

export type WorkRecord = {
  id: string;
  _version?: number;
  [key: string]: unknown;
};
export const text = (value: unknown): string =>
  typeof value === "string" ? value : "";
export function day(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value))
    return null;
  const date = value.slice(0, 10);
  const stamp = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(stamp) &&
    new Date(stamp).toISOString().slice(0, 10) === date
    ? stamp / 86400000
    : null;
}
export function today(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function cents(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const decimal = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(decimal)) return null;
  const [whole, fraction = ""] = decimal.split(".");
  const exact = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return exact <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(exact) : null;
}
export function money(value: unknown, locale: PluginLocale = "es"): string {
  const amount = cents(value);
  return amount === null
    ? { es: "Sin valor", en: "No amount", pt: "Sem valor" }[locale]
    : new Intl.NumberFormat(pluginIntlLocale(locale), {
        style: "currency",
        currency: "COP",
        maximumFractionDigits: 2,
      }).format(amount / 100);
}
export function dateLabel(value: unknown, locale: PluginLocale = "es"): string {
  const stamp = day(value);
  return stamp === null
    ? { es: "Sin fecha", en: "No date", pt: "Sem data" }[locale]
    : new Intl.DateTimeFormat(pluginIntlLocale(locale), {
        timeZone: "UTC",
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date(stamp * 86400000));
}
export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "No se pudo completar la operación. Intenta de nuevo.";
}
export function csv(rows: unknown[][]): string {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((value) => {
            const cell = String(value ?? "");
            const safe = /^[\s]*[=+@\-]/.test(cell) ? "'" + cell : cell;
            return '"' + safe.replaceAll('"', '""') + '"';
          })
          .join(","),
      )
      .join("\r\n")
  );
}
export async function loadRecords(
  savia: PluginApi,
  object: string,
): Promise<WorkRecord[]> {
  const collection = savia.collections.collection<WorkRecord>(object);
  if (!(await collection.describe()))
    throw new Error(
      "Falta la colección requerida. Repara la instalación en Paquetes y extensiones.",
    );
  const records: WorkRecord[] = [];
  const ids = new Set<string>();
  let expectedTotal: number | undefined;
  for (let page = 1; page <= 100; page++) {
    const result = await collection.list({
      page,
      perPage: 100,
      sort: "id",
      order: "ASC",
    });
    if (expectedTotal !== undefined && result.total !== expectedTotal)
      throw new Error(
        "La lista cambió durante la carga. Actualiza para obtener todos los registros.",
      );
    expectedTotal = result.total;
    for (const record of result.data) {
      if (ids.has(record.id))
        throw new Error(
          "La lista cambió durante la carga. Actualiza para obtener todos los registros.",
        );
      ids.add(record.id);
      records.push(record);
    }
    if (records.length === result.total) return records;
    if (records.length > result.total)
      throw new Error(
        "La lista cambió durante la carga. Actualiza para obtener todos los registros.",
      );
    if (!result.data.length)
      throw new Error(
        "La lista cambió durante la carga. Actualiza para obtener todos los registros.",
      );
  }
  throw new Error(
    "La colección supera 10.000 registros. Usa la vista de colección para consultar este volumen.",
  );
}
