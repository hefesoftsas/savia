import type { SaviaCollectionField } from "@savia/studio-shared/savia-flows";

export type SaviaFieldControl =
  | { kind: "select"; options: Array<{ value: string; label: string }> }
  | { kind: "number" | "boolean" | "date" | "json" | "text" };

export function saviaFieldControl(
  field: SaviaCollectionField,
): SaviaFieldControl {
  const type = field.type.toLowerCase();
  if (type.includes("dropdown") || type === "select") {
    const raw = Array.isArray(field.options)
      ? field.options
      : field.options &&
          typeof field.options === "object" &&
          "choices" in field.options
        ? (field.options as { choices: unknown }).choices
        : [];
    const options = Array.isArray(raw)
      ? raw.map((option) => {
          if (typeof option === "string" || typeof option === "number") {
            return { value: String(option), label: String(option) };
          }
          if (option && typeof option === "object") {
            const entry = option as Record<string, unknown>;
            const value = String(entry.value ?? entry.name ?? entry.id ?? "");
            return { value, label: String(entry.label ?? entry.name ?? value) };
          }
          return { value: String(option), label: String(option) };
        })
      : [];
    return { kind: "select", options };
  }
  if (type.includes("bool") || type.includes("checkbox"))
    return { kind: "boolean" };
  if (type.includes("number") || type.includes("integer"))
    return { kind: "number" };
  if (type.includes("date")) return { kind: "date" };
  if (type.includes("json")) return { kind: "json" };
  return { kind: "text" };
}

export function coerceSaviaFieldValue(
  field: SaviaCollectionField,
  value: unknown,
): unknown {
  const control = saviaFieldControl(field);
  if (control.kind === "number") {
    if (value === "" || value === undefined || value === null) return null;
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? number : null;
  }
  if (control.kind === "boolean") {
    return value === true || value === "true" || value === 1;
  }
  if (control.kind === "json" && typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value ?? "";
}

export function updateSaviaFieldMap(
  current: Record<string, unknown>,
  field: SaviaCollectionField,
  value: unknown,
): Record<string, unknown> {
  const next = { ...current };
  if (
    (value === "" || value === null || value === undefined) &&
    !field.required
  ) {
    delete next[field.name];
  } else {
    next[field.name] = coerceSaviaFieldValue(field, value);
  }
  return next;
}

export function parseValidSaviaJson(
  value: string,
): { valid: true; value: unknown } | { valid: false } {
  try {
    return { valid: true, value: JSON.parse(value) as unknown };
  } catch {
    return { valid: false };
  }
}
