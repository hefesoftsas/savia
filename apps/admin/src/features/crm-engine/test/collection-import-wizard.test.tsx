// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CollectionImportWizard } from "../collection-import-wizard";
import { parseSpreadsheetFile } from "../spreadsheet-parser";
import * as XLSX from "xlsx";
import * as apiModule from "../api";

vi.mock("../api", () => ({
  api: vi.fn(),
}));

beforeEach(() => {
  (apiModule.api as any).mockImplementation((path: string) => {
    if (path === "/objects") {
      return Promise.resolve({
        data: [
          { name: "clientes", label: "Clientes" },
          { name: "polizas", label: "Pólizas" },
        ],
      });
    }
    return Promise.resolve({ data: {} });
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Spreadsheet Parser", () => {
  it("parses CSV file into headers and rows", async () => {
    const csvContent =
      "Nombre,Email,Edad\nAna,ana@example.com,28\nCarlos,carlos@example.com,34";
    const file = new File([csvContent], "clientes.csv", { type: "text/csv" });

    const result = await parseSpreadsheetFile(file);
    expect(result.fileName).toBe("clientes.csv");
    expect(result.headers).toEqual(["Nombre", "Email", "Edad"]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual(["Ana", "ana@example.com", "28"]);
    expect(result.rows[1]).toEqual(["Carlos", "carlos@example.com", "34"]);
  });

  it("parses Excel (.xlsx) file with XLSX utility and supports multiple sheets", async () => {
    const wb = XLSX.utils.book_new();
    const wsPolizas = XLSX.utils.aoa_to_sheet([
      ["Póliza", "Valor", "Activo"],
      ["POL-100", 150000, true],
      ["POL-200", 250000, false],
    ]);
    const wsSiniestros = XLSX.utils.aoa_to_sheet([
      ["Numero", "Fecha"],
      ["SIN-1", "2026-01-01"],
    ]);
    XLSX.utils.book_append_sheet(wb, wsPolizas, "Polizas");
    XLSX.utils.book_append_sheet(wb, wsSiniestros, "Siniestros");
    const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });

    const file = new File([buffer], "datos.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const result = await parseSpreadsheetFile(file);
    expect(result.fileName).toBe("datos.xlsx");
    expect(result.sheetNames).toEqual(["Polizas", "Siniestros"]);
    expect(result.selectedSheet).toBe("Polizas");
    expect(result.headers).toEqual(["Póliza", "Valor", "Activo"]);
    expect(result.rows).toHaveLength(2);

    // Switch sheet
    const switched = await parseSpreadsheetFile(file, "Siniestros");
    expect(switched.selectedSheet).toBe("Siniestros");
    expect(switched.headers).toEqual(["Numero", "Fecha"]);
    expect(switched.rows).toHaveLength(1);
  });
});

describe("CollectionImportWizard Component", () => {
  it("renders wizard header, stepper and dropzone on mount", async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();

    render(<CollectionImportWizard onClose={onClose} onCreated={onCreated} />);

    expect(
      screen.getByText("Crear Colección y Pantalla desde Archivo"),
    ).toBeInTheDocument();
    expect(screen.getByText("Archivo")).toBeInTheDocument();
    expect(screen.getByText("Pantalla")).toBeInTheDocument();
    expect(screen.getByText("Campos y Tipos")).toBeInTheDocument();
    expect(screen.getByText("Confirmar")).toBeInTheDocument();
    expect(
      screen.getByText(/Arrastra y suelta tu archivo Excel/i),
    ).toBeInTheDocument();
  });

  it("allows switching to blank object creation if callback provided", async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    const onSwitchToBlank = vi.fn();
    const user = userEvent.setup();

    render(
      <CollectionImportWizard
        onClose={onClose}
        onCreated={onCreated}
        onSwitchToBlank={onSwitchToBlank}
      />,
    );

    const switchBtn = screen.getByText(
      /¿Prefieres diseñar un objeto en blanco desde cero\?/i,
    );
    await user.click(switchBtn);
    expect(onSwitchToBlank).toHaveBeenCalledTimes(1);
  });

  it("progresses through wizard steps, detects relations/formulas and creates object on submit", async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    const user = userEvent.setup();

    (apiModule.api as any).mockImplementation(
      (path: string, method?: string) => {
        if (path === "/objects" && (!method || method === "GET")) {
          return Promise.resolve({
            data: [
              { name: "clientes", label: "Clientes" },
              { name: "polizas", label: "Pólizas" },
            ],
          });
        }
        if (path === "/objects" && method === "POST") {
          return Promise.resolve({ data: { name: "cotizaciones" } });
        }
        if (path.includes("/import") && path.includes("/preview")) {
          return Promise.resolve({ importId: "import_123" });
        }
        if (path.includes("/import") && path.includes("/commit")) {
          return Promise.resolve({ ok: true });
        }
        return Promise.resolve({ data: [] });
      },
    );

    render(<CollectionImportWizard onClose={onClose} onCreated={onCreated} />);

    // File with:
    // 1. Cliente ID (FK to 'clientes')
    // 2. Cantidad, Precio, Total (Formula: total = cantidad * precio)
    const csvContent =
      "Cliente ID,Cantidad,Precio,Total\n" +
      "cli_1,2,500,1000\n" +
      "cli_2,3,100,300";
    const file = new File([csvContent], "cotizaciones.csv", {
      type: "text/csv",
    });

    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText("cotizaciones.csv")).toBeInTheDocument();
      expect(screen.getByText("2 registros")).toBeInTheDocument();
    });

    // Step 1 -> Step 2
    const toScreenBtn = screen.getByRole("button", {
      name: /Continuar a Pantalla/i,
    });
    await user.click(toScreenBtn);

    expect(screen.getByDisplayValue("Cotizaciones")).toBeInTheDocument();
    expect(screen.getByDisplayValue("cotizaciones")).toBeInTheDocument();

    // Step 2 -> Step 3
    const toFieldsBtn = screen.getByRole("button", { name: /Revisar Campos/i });
    await user.click(toFieldsBtn);

    expect(screen.getByText("Etiqueta en pantalla")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Cliente ID")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Cantidad")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Precio")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Total")).toBeInTheDocument();

    // Verify formula detection badge and relation badge exist
    expect(screen.getByText(/cantidad × precio/i)).toBeInTheDocument();
    expect(screen.getByText(/Relación:/i)).toBeInTheDocument();

    // Step 3 -> Step 4
    const toConfirmBtn = screen.getByRole("button", {
      name: /Confirmar e Importar/i,
    });
    await user.click(toConfirmBtn);

    expect(
      screen.getByText("Resumen de la nueva Pantalla"),
    ).toBeInTheDocument();

    // Execute create
    const createBtn = screen.getByRole("button", {
      name: /Crear e Importar 2 registros/i,
    });
    await user.click(createBtn);

    await waitFor(() => {
      expect(apiModule.api).toHaveBeenCalledWith(
        "/objects",
        "POST",
        expect.objectContaining({
          name: "cotizaciones",
          label: "Cotizaciones",
          config: expect.objectContaining({
            version: 2,
            fields: expect.objectContaining({
              cliente_id: expect.objectContaining({
                type: "Textbox",
                config: expect.objectContaining({
                  relation: "clientes",
                  collectionRelation: "manual",
                }),
              }),
              total: expect.objectContaining({
                config: expect.objectContaining({
                  formula: expect.objectContaining({
                    op: "product",
                    fields: ["cantidad", "precio"],
                  }),
                }),
              }),
            }),
          }),
        }),
      );
      expect(onCreated).toHaveBeenCalledWith("cotizaciones");
    });
  });

  it("handles sequential chunked batch import for > 1,000 rows (Item 2)", async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    const user = userEvent.setup();

    const previewCalls: any[] = [];
    const commitCalls: any[] = [];

    (apiModule.api as any).mockImplementation(
      (path: string, method: string, body: any) => {
        if (path === "/objects" && method === "POST") {
          return Promise.resolve({ data: { name: "grandes_polizas" } });
        }
        if (path.includes("/import") && path.includes("/preview")) {
          previewCalls.push({ path, body });
          return Promise.resolve({
            importId: `import_chunk_${previewCalls.length}`,
          });
        }
        if (path.includes("/import") && path.includes("/commit")) {
          commitCalls.push({ path, body });
          return Promise.resolve({ ok: true });
        }
        return Promise.resolve({ data: [] });
      },
    );

    render(<CollectionImportWizard onClose={onClose} onCreated={onCreated} />);

    // Generate 2,250 rows to trigger 3 sequential chunks: [1..1000], [1001..2000], [2001..2250]
    let csvContent = "Codigo,Descripcion\n";
    for (let i = 1; i <= 2250; i++) {
      csvContent += `POL-${i},Seguro ${i}\n`;
    }
    const file = new File([csvContent], "grandes_polizas.csv", {
      type: "text/csv",
    });

    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText("2250 registros")).toBeInTheDocument();
      expect(screen.getByText(/3 lotes automáticos/i)).toBeInTheDocument();
    });

    // Advance to Step 2
    await user.click(
      screen.getByRole("button", { name: /Continuar a Pantalla/i }),
    );
    // Advance to Step 3
    await user.click(screen.getByRole("button", { name: /Revisar Campos/i }));
    // Advance to Step 4
    await user.click(
      screen.getByRole("button", { name: /Confirmar e Importar/i }),
    );

    // Confirm button shows 3 lotes notice
    const createBtn = screen.getByRole("button", {
      name: /Crear e Importar 2250 registros/i,
    });
    expect(createBtn).toBeInTheDocument();
    await user.click(createBtn);

    // Verify all 3 chunks were previewed and committed in sequence!
    await waitFor(() => {
      expect(previewCalls).toHaveLength(3);
      expect(commitCalls).toHaveLength(3);
    });

    // Chunk 1: rows 0 to 1000
    expect(previewCalls[0].body.csv).toContain("POL-1");
    expect(previewCalls[0].body.csv).toContain("POL-1000");
    expect(previewCalls[0].body.csv).not.toContain("POL-1001");
    expect(commitCalls[0].body.importId).toBe("import_chunk_1");

    // Chunk 2: rows 1000 to 2000
    expect(previewCalls[1].body.csv).toContain("POL-1001");
    expect(previewCalls[1].body.csv).toContain("POL-2000");
    expect(previewCalls[1].body.csv).not.toContain("POL-2001");
    expect(commitCalls[1].body.importId).toBe("import_chunk_2");

    // Chunk 3: remaining 250 rows
    expect(previewCalls[2].body.csv).toContain("POL-2001");
    expect(previewCalls[2].body.csv).toContain("POL-2250");
    expect(commitCalls[2].body.importId).toBe("import_chunk_3");

    // Final navigation called
    expect(onCreated).toHaveBeenCalledWith("grandes_polizas");
  });
});
