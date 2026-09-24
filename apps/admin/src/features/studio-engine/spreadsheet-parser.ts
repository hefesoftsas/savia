import * as XLSX from "xlsx";
import { parseCsv } from "@savia/studio-shared/csv";

export type ParsedSpreadsheet = {
  fileName: string;
  sheetNames: string[];
  selectedSheet: string;
  headers: string[];
  rows: (string | number | boolean | Date | null)[][];
  totalRowsCount: number;
};

/**
 * Parses an Excel (.xlsx, .xls) or CSV File in the browser.
 */
export async function parseSpreadsheetFile(
  file: File,
  targetSheetName?: string,
): Promise<ParsedSpreadsheet> {
  const fileName = file.name;
  const isCsv =
    fileName.toLowerCase().endsWith(".csv") ||
    file.type === "text/csv" ||
    file.type === "application/vnd.ms-excel";

  if (isCsv && !fileName.toLowerCase().endsWith(".xls")) {
    const text = await file.text();
    const { headers, rows } = parseCsv(text, 5000);
    return {
      fileName,
      sheetNames: ["CSV"],
      selectedSheet: "CSV",
      headers,
      rows,
      totalRowsCount: rows.length,
    };
  }

  // Excel (.xlsx, .xls, etc.)
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: true,
  });

  const sheetNames = workbook.SheetNames;
  if (!sheetNames || sheetNames.length === 0) {
    throw new Error("El archivo Excel no contiene ninguna hoja válida.");
  }

  const selectedSheet =
    targetSheetName && sheetNames.includes(targetSheetName)
      ? targetSheetName
      : sheetNames[0];

  const worksheet = workbook.Sheets[selectedSheet];
  if (!worksheet) {
    throw new Error(`No se pudo leer la hoja "${selectedSheet}".`);
  }

  const rawGrid = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    blankrows: false,
    raw: true,
  }) as unknown[][];

  if (!rawGrid || rawGrid.length === 0) {
    throw new Error(`La hoja "${selectedSheet}" está vacía.`);
  }

  // First non-empty row serves as headers
  let headerRowIndex = 0;
  while (
    headerRowIndex < rawGrid.length &&
    (!rawGrid[headerRowIndex] ||
      (rawGrid[headerRowIndex] as unknown[]).every(
        (cell) =>
          cell === null || cell === undefined || String(cell).trim() === "",
      ))
  ) {
    headerRowIndex++;
  }

  if (headerRowIndex >= rawGrid.length) {
    throw new Error("No se encontraron encabezados de columna en la hoja.");
  }

  const rawHeaders = (rawGrid[headerRowIndex] as unknown[]).map((h) =>
    h !== null && h !== undefined ? String(h).trim() : "",
  );

  // Find last non-empty header column
  let lastColIndex = rawHeaders.length - 1;
  while (lastColIndex >= 0 && !rawHeaders[lastColIndex]) {
    lastColIndex--;
  }

  if (lastColIndex < 0) {
    throw new Error("Los encabezados de columna están vacíos.");
  }

  const headers = rawHeaders
    .slice(0, lastColIndex + 1)
    .map((h, i) => h || `Columna_${i + 1}`);

  const rows: (string | number | boolean | Date | null)[][] = [];
  for (let r = headerRowIndex + 1; r < rawGrid.length; r++) {
    const rawRow = (rawGrid[r] as unknown[]) ?? [];
    const isRowEmpty = rawRow.every(
      (cell) =>
        cell === null || cell === undefined || String(cell).trim() === "",
    );
    if (isRowEmpty) continue;

    const rowCells: (string | number | boolean | Date | null)[] = [];
    for (let c = 0; c <= lastColIndex; c++) {
      const cell = rawRow[c];
      if (cell === null || cell === undefined) {
        rowCells.push(null);
      } else if (cell instanceof Date) {
        rowCells.push(cell);
      } else if (typeof cell === "number" || typeof cell === "boolean") {
        rowCells.push(cell);
      } else {
        rowCells.push(String(cell));
      }
    }
    rows.push(rowCells);
  }

  return {
    fileName,
    sheetNames,
    selectedSheet,
    headers,
    rows,
    totalRowsCount: rows.length,
  };
}
