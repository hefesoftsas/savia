import type { IFieldConfig } from "@form-eng/core";
import {
  parseMapLocation,
  formatMapLocationSummary,
} from "@savia/crm-shared/map-location";
import { recordOptionLabel } from "./record-option-label";

/** Shared presentation for table cells, record details and form summaries. */
export function formatFieldValue(
  value: unknown,
  field: IFieldConfig,
  locale = "es-CO",
): string {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && !value.length)
  )
    return "—";
  const location = parseMapLocation(value);
  if (location) return formatMapLocationSummary(location);
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (field.type === "Currency" || field.config?.format === "currency") {
    const decimals =
      typeof field.config?.decimals === "number"
        ? field.config.decimals
        : field.config?.integer
          ? 0
          : 2;
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: String(field.config?.currency || "COP"),
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(Number(value));
    } catch {
      return String(value);
    }
  }
  if (field.type === "DateTime" || field.config?.dateTime === true) {
    const date = new Date(String(value));
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(date)
      : String(value);
  }
  if (
    field.type === "DateControl" &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(value))
  ) {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat(locale, { timeZone: "UTC" }).format(date)
      : String(value);
  }
  const label = recordOptionLabel(value, field.options);
  return Array.isArray(label)
    ? label.join(", ")
    : typeof label === "object"
      ? JSON.stringify(label)
      : String(label);
}
