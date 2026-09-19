import {
  fieldEntries,
  R2_ATTACHMENT_TYPE,
  validateRecord,
  type CrmObject,
} from "./metadata";

export function parseCsv(
  text: string,
  maxRows = 1000,
): { headers: string[]; rows: string[][] } {
  text = text.replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter =
    !firstLine.includes(",") && firstLine.includes(";") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    endedQuote = false;
  const finishCell = () => {
    row.push(cell);
    cell = "";
    endedQuote = false;
  };
  const finishRow = () => {
    finishCell();
    if (row.some((v) => v !== "")) rows.push(row);
    row = [];
    if (rows.length > maxRows + 1)
      throw new Error(`Máximo ${maxRows} filas por importación.`);
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          endedQuote = true;
        }
      } else cell += ch;
    } else if (ch === '"') {
      if (cell || endedQuote)
        throw new Error(
          "CSV inválido: comillas fuera de una celda entrecomillada.",
        );
      quoted = true;
    } else if (ch === delimiter) finishCell();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      finishRow();
    } else {
      if (endedQuote)
        throw new Error(
          "CSV inválido: texto después de las comillas de cierre.",
        );
      cell += ch;
    }
  }
  if (quoted) throw new Error("CSV inválido: faltan comillas de cierre.");
  if (cell || row.length || endedQuote) finishRow();
  const headers = (rows.shift() ?? []).map((h) => h.trim());
  if (!headers.length || headers.some((h) => !h))
    throw new Error("El CSV necesita encabezados no vacíos.");
  if (new Set(headers).size !== headers.length)
    throw new Error("Los encabezados del CSV deben ser únicos.");
  if (headers.length > 105) throw new Error("Máximo 105 columnas.");
  for (const [i, values] of rows.entries())
    if (values.length !== headers.length)
      throw new Error(
        `Fila ${i + 2}: se esperaban ${headers.length} columnas y hay ${values.length}.`,
      );
  return { headers, rows };
}

export function mapCsvRow(
  object: CrmObject,
  headers: string[],
  values: string[],
  mapping: Record<string, string>,
) {
  const input: Record<string, unknown> = {};
  const conversionErrors: Record<string, string> = {};
  headers.forEach((header, index) => {
    const key = mapping[header];
    if (!key) return;
    const field = object.config.fields[key];
    if (!field) {
      conversionErrors[key] = `Campo desconocido: ${key}`;
      return;
    }
    const raw = values[index] ?? "";
    if (raw === "") {
      if (field.defaultValue === undefined) input[key] = null;
      return;
    }
    if (field.config?.multiple || field.type === "MultiSelect") {
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error();
        input[key] = parsed;
      } catch {
        conversionErrors[key] =
          `${field.label}: use a JSON array for multiple values.`;
      }
    } else if (field.type === "Number" || field.type === "Currency") {
      input[key] = Number(raw);
      if (!Number.isFinite(input[key]))
        conversionErrors[key] = `${field.label}: número inválido.`;
    } else if (field.type === "Toggle") {
      if (/^(true|1|sí|si)$/i.test(raw)) input[key] = true;
      else if (/^(false|0|no)$/i.test(raw)) input[key] = false;
      else
        conversionErrors[key] = `${field.label}: usa true/false, sí/no o 1/0.`;
    } else input[key] = raw;
  });
  const validated = validateRecord(object, input);
  return {
    data: validated.data,
    errors: { ...validated.errors, ...conversionErrors },
  };
}

export function csvCell(value: unknown): string {
  let text =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  // Prevent spreadsheet formula execution while retaining negative numeric values.
  if (typeof value === "string" && /^[\s]*[=+\-@\t\r]/.test(text))
    text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
export function csvHeaders(object: CrmObject) {
  return [
    "id",
    ...fieldEntries(object)
      .filter(([, field]) => field.type !== R2_ATTACHMENT_TYPE)
      .map(([key]) => key),
    "created_at",
    "updated_at",
  ];
}
export function csvLine(values: unknown[]) {
  return values.map(csvCell).join(",") + "\r\n";
}
