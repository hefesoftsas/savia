/** Only authentication uses native booleans, dates and arrays. Shared stores retain SQLite values. */
export function mapSqliteValue(value: unknown, type: string): unknown {
  if (value === null) return null;
  if (type === "boolean") {
    if (![0, 1, 0n, 1n, false, true].includes(value as boolean))
      throw new Error("Invalid source boolean.");
    return value === 1 || value === 1n || value === true;
  }
  if (type.startsWith("timestamp")) {
    const date = new Date(
      typeof value === "number" || typeof value === "bigint"
        ? Number(value)
        : String(value),
    );
    if (!Number.isFinite(date.getTime()))
      throw new Error("Invalid source timestamp.");
    return date;
  }
  if (type === "ARRAY") {
    const parsed: unknown = JSON.parse(String(value));
    if (!Array.isArray(parsed)) throw new Error("Invalid source array.");
    return parsed;
  }
  return value;
}
export function quote(name: string) {
  return '"' + name.replaceAll('"', '""') + '"';
}
export function valueDigest(value: unknown): string {
  if (value === null) return JSON.stringify(["null"]);
  if (value === undefined) return JSON.stringify(["undefined"]);
  if (value instanceof Date)
    return JSON.stringify(["scalar", value.toISOString()]);
  if (value instanceof Uint8Array)
    return JSON.stringify(["bytes", Buffer.from(value).toString("hex")]);
  if (Array.isArray(value)) return JSON.stringify(["array", value]);
  // PostgreSQL returns int8 as text on a native client; values were checked on insert.
  return JSON.stringify(["scalar", String(value)]);
}

export function columnDigest(value: unknown, type: string): string {
  if (value !== null && (type === "json" || type === "jsonb")) {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    const canonical = (item: unknown): unknown =>
      Array.isArray(item)
        ? item.map(canonical)
        : item && typeof item === "object"
          ? Object.fromEntries(
              Object.entries(item)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, entry]) => [key, canonical(entry)]),
            )
          : item;
    return JSON.stringify(["json", canonical(parsed)]);
  }
  return valueDigest(value);
}
