import type { StudioObject } from "@savia/studio-shared/metadata";
export function parseCsv(source: string): Record<string, string>[] {
  if (source.length > 2_000_000) throw Error("El archivo supera 2 MB.");
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  const input = source.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
      continue;
    }
    if (c === '"') {
      if (cell || closed) throw Error("Comillas fuera de posición.");
      quoted = true;
    } else if (c === "," || c === "\n" || c === "\r") {
      row.push(cell);
      cell = "";
      closed = false;
      if (c !== ",") {
        if (c === "\r" && input[i + 1] === "\n") i++;
        if (row.some((v) => v !== "")) rows.push(row);
        row = [];
      }
    } else {
      if (closed) throw Error("Contenido después de comillas.");
      cell += c;
    }
  }
  if (quoted) throw Error("Comillas sin cerrar.");
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const headers = rows.shift()?.map((s) => s.trim()) ?? [];
  if (
    !headers.length ||
    new Set(headers).size !== headers.length ||
    headers.some(
      (h) => !h || ["__proto__", "constructor", "prototype"].includes(h),
    )
  )
    throw Error("Los encabezados deben ser únicos y no vacíos.");
  if (rows.length > 1000) throw Error("Importa máximo 1.000 filas por lote.");
  return rows.map((values, index) => {
    if (values.length !== headers.length)
      throw Error(`Fila ${index + 2}: número de columnas incorrecto.`);
    return Object.fromEntries(headers.map((key, i) => [key, values[i]]));
  });
}
export function duplicateGroups(
  records: Record<string, unknown>[],
  field: string,
): string[][] {
  const groups = new Map<string, string[]>();
  for (const row of records) {
    const key = String(row[field] ?? "")
      .trim()
      .toLocaleLowerCase();
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), String(row.id)]);
  }
  return [...groups.values()].filter((ids) => ids.length > 1);
}
export type ImportRow = {
  line: number;
  status: "ready" | "invalid" | "exists";
  data: Record<string, unknown>;
  error?: string;
};
export function planImport(
  rows: Record<string, string>[],
  fields: StudioObject["config"]["fields"],
  existing: Record<string, unknown>[],
  matchField: string,
): ImportRow[] {
  if (!matchField || !fields[matchField]?.config?.unique)
    throw Error(
      "Selecciona un campo único para poder reintentar sin duplicar registros.",
    );
  const seen = new Set(existing.map((row) => String(row[matchField] ?? "")));
  return rows.map((row, index) => {
    const data: Record<string, unknown> = {};
    let error = "";
    for (const [key, raw] of Object.entries(row)) {
      const field = fields[key];
      if (!field) {
        error = `Campo desconocido: ${key}`;
        continue;
      }
      const value = raw.trim();
      if (
        ["Textbox", "Textarea", "Dropdown", "DateControl", "Number"].includes(
          field.type,
        ) === false
      ) {
        error = `Campo no importable: ${key}`;
        continue;
      }
      if (field.type === "Number" && value) {
        if (
          !/^-?\d+(?:\.\d+)?$/.test(value) ||
          !Number.isFinite(Number(value)) ||
          Math.abs(Number(value)) > Number.MAX_SAFE_INTEGER ||
          (/^[-+]?\d+$/.test(value) && !Number.isSafeInteger(Number(value)))
        )
          error = `Número inválido: ${key}`;
        data[key] = Number(value);
      } else if (field.type === "DateControl" && value) {
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isFinite(Date.parse(value)) ||
          new Date(value).toISOString().slice(0, 10) !== value
        )
          error = `Fecha inválida: ${key}`;
        data[key] = value;
      } else data[key] = value || null;
      const config = field.config ?? {};
      if (
        typeof data[key] === "number" &&
        ((typeof config.minimum === "number" &&
          (data[key] as number) < config.minimum) ||
          (typeof config.maximum === "number" &&
            (data[key] as number) > config.maximum))
      )
        error = `Valor fuera del rango: ${key}`;
      if (
        typeof data[key] === "string" &&
        typeof config.maxLength === "number" &&
        (data[key] as string).length > config.maxLength
      )
        error = `Texto demasiado largo: ${key}`;
      if (field.type === "Dropdown" && (config.relation || config.multiple))
        error = `La relación o lista múltiple ${key} requiere el editor de colección.`;
      if (
        field.type === "Dropdown" &&
        value &&
        field.options?.length &&
        !field.options.some((option) => option.value === value)
      )
        error = `Opción inválida: ${key}`;
    }
    for (const [key, field] of Object.entries(fields))
      if (
        field.required &&
        (data[key] === null || data[key] === undefined || data[key] === "")
      )
        error = `Falta el campo obligatorio: ${key}`;
    const key = String(data[matchField] ?? "");
    if (!key) error = "La clave única no puede estar vacía.";
    if (error) return { line: index + 2, status: "invalid", data, error };
    if (seen.has(key)) return { line: index + 2, status: "exists", data };
    seen.add(key);
    return { line: index + 2, status: "ready", data };
  });
}
