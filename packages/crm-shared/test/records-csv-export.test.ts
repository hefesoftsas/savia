import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/csv";
import { makeConfig } from "../src/metadata";
import {
  buildRecordsCsv,
  formatRecordCsvValue,
  parseCsvExportColumns,
  recordsCsvFilename,
} from "../src/records-csv-export";

const object = {
  name: "test",
  label: "Test",
  description: "",
  config: makeConfig({
    nombre: { type: "Textbox", label: "Nombre" },
    activo: { type: "Toggle", label: "Activo" },
    etiquetas: { type: "Textbox", label: "Etiquetas", config: { multiple: true } },
  }),
};

describe("records CSV export", () => {
  it("formats display values for spreadsheet export", () => {
    expect(formatRecordCsvValue(true)).toBe("Sí");
    expect(formatRecordCsvValue(false)).toBe("No");
    expect(formatRecordCsvValue(["uno", "dos"])).toBe("uno, dos");
    expect(formatRecordCsvValue("=SUM(1,2)")).toBe("=SUM(1,2)");
    expect(formatRecordCsvValue(null)).toBe("");
  });

  it("builds a CSV with escaped commas, quotes, and newlines", () => {
    const csv = buildRecordsCsv(
      ["nombre"],
      ["Nombre"],
      [{ id: "1", nombre: 'Uno, dos\n"Tres"' }],
    );
    expect(parseCsv(csv).rows).toEqual([['Uno, dos\n"Tres"']]);
  });

  it("validates visible export columns against the object schema", () => {
    expect(
      parseCsvExportColumns(
        {
          columns: JSON.stringify(["nombre", "activo"]),
          headers: JSON.stringify(["Nombre", "Activo"]),
        },
        object,
      ),
    ).toEqual({
      columns: ["nombre", "activo"],
      headers: ["Nombre", "Activo"],
    });
    expect(() =>
      parseCsvExportColumns(
        {
          columns: JSON.stringify(["desconocido"]),
          headers: JSON.stringify(["Desconocido"]),
        },
        object,
      ),
    ).toThrow("columna no declarada");
  });

  it("names export files with the object and current date", () => {
    expect(recordsCsvFilename("test", new Date("2026-09-10T12:00:00Z"))).toBe(
      "test-registros-2026-09-10.csv",
    );
  });
});
