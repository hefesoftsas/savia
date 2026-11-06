import { z } from "zod";
import { csvLine } from "./csv";
import { identifier, type StudioObject, type StudioRecord } from "./metadata";
import { formatMapLocationSummary, parseMapLocation } from "./map-location";

export function formatRecordCsvValue(value: unknown): string {
  const location = parseMapLocation(value);
  if (location) return formatMapLocationSummary(location);
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function parseCsvExportColumns(
  params: Record<string, string | undefined>,
  object: StudioObject,
) {
  if (!params.columns) return null;
  const columns = z
    .array(identifier)
    .min(1)
    .max(100)
    .parse(JSON.parse(params.columns));
  const headers = z
    .array(z.string().trim().min(1).max(100))
    .length(columns.length)
    .parse(JSON.parse(params.headers ?? "[]"));
  if (columns.some((key) => !object.config.fields[key]))
    throw new Error("El CSV contiene una columna no declarada.");
  return { columns, headers };
}

export function buildRecordsCsv(
  columns: string[],
  headers: string[],
  records: StudioRecord[],
): string {
  return (
    "\uFEFF" +
    csvLine(headers) +
    records
      .map((record) =>
        csvLine(columns.map((key) => formatRecordCsvValue(record[key]))),
      )
      .join("")
  );
}

export function recordsCsvFilename(
  objectName: string,
  date = new Date(),
): string {
  return `${objectName}-registros-${date.toISOString().slice(0, 10)}.csv`;
}
