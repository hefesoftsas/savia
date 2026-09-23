import { describe, it, expect } from "vitest";
import {
  normalizeHeaderToIdentifier,
  detectColumnType,
  inferSpreadsheetSchema,
} from "../src/spreadsheet-inference";
import { objectSchema } from "../src/metadata";

describe("spreadsheet-inference", () => {
  describe("normalizeHeaderToIdentifier", () => {
    it("converts spaces, accents and special characters into a valid identifier", () => {
      const existing = new Set<string>();
      expect(
        normalizeHeaderToIdentifier("Número de Póliza ($)", existing),
      ).toBe("numero_de_poliza");
      expect(
        normalizeHeaderToIdentifier("Fecha Emisión / Vencimiento", existing),
      ).toBe("fecha_emision_vencimiento");
    });

    it("prefixes numbers or non-letter starts", () => {
      const existing = new Set<string>();
      expect(normalizeHeaderToIdentifier("123 Campo", existing)).toBe(
        "col_123_campo",
      );
      expect(normalizeHeaderToIdentifier("", existing)).toBe("col_field");
    });

    it("resolves collisions by appending unique suffixes", () => {
      const existing = new Set<string>();
      const k1 = normalizeHeaderToIdentifier("Nombre", existing);
      const k2 = normalizeHeaderToIdentifier("Nombre", existing);
      const k3 = normalizeHeaderToIdentifier("Nombre", existing);
      expect(k1).toBe("nombre");
      expect(k2).toBe("nombre_2");
      expect(k3).toBe("nombre_3");
    });
  });

  describe("detectColumnType", () => {
    it("detects boolean toggles", () => {
      expect(detectColumnType(["true", "false", "true"]).type).toBe("Toggle");
      expect(detectColumnType(["si", "no", "sí"]).type).toBe("Toggle");
      expect(detectColumnType([true, false]).type).toBe("Toggle");
    });

    it("detects dates", () => {
      expect(
        detectColumnType(["2026-05-12", "2026-06-15", "2026-07-20"]).type,
      ).toBe("DateControl");
      expect(
        detectColumnType(["12/05/2026", "15/06/2026", "20/07/2026"]).type,
      ).toBe("DateControl");
      expect(
        detectColumnType([new Date("2026-05-12"), new Date("2026-06-15")]).type,
      ).toBe("DateControl");
    });

    it("detects currency symbols and formats", () => {
      const res = detectColumnType(["$ 1,500.00", "$ 2,300.50", "$ 400.00"]);
      expect(res.type).toBe("Currency");
      expect(res.config?.currency).toBe("USD");

      const eurRes = detectColumnType(["150 €", "200.50 €"]);
      expect(eurRes.type).toBe("Currency");
      expect(eurRes.config?.currency).toBe("EUR");
    });

    it("detects numbers and integers", () => {
      const intRes = detectColumnType([10, 25, 30]);
      expect(intRes.type).toBe("Number");
      expect(intRes.config?.integer).toBe(true);

      const decRes = detectColumnType(["12.5", "14.8", "20.1"]);
      expect(decRes.type).toBe("Number");
      expect(decRes.config?.integer).toBe(false);
    });

    it("detects currency when header implies amount/price", () => {
      const res = detectColumnType([150000, 250000], "Valor Prima");
      expect(res.type).toBe("Currency");
    });

    it("detects emails, phones and URLs", () => {
      expect(detectColumnType(["ana@savia.io", "carlos@gmail.com"]).type).toBe(
        "Email",
      );
      expect(
        detectColumnType(["https://savia.io", "http://example.com/item"]).type,
      ).toBe("Url");
      expect(
        detectColumnType(["+57 300 123 4567", "+57 310 987 6543"]).type,
      ).toBe("Phone");
    });

    it("detects dropdown for low-cardinality values", () => {
      const res = detectColumnType(
        ["Activo", "Inactivo", "Activo", "Pendiente", "Activo"],
        "Estado",
      );
      expect(res.type).toBe("Dropdown");
      expect(res.options).toEqual([
        { value: "Activo", label: "Activo" },
        { value: "Inactivo", label: "Inactivo" },
        { value: "Pendiente", label: "Pendiente" },
      ]);
    });

    it("detects textarea for long text", () => {
      const longText =
        "Este es un texto explicativo bastante largo que supera el límite estándar de ciento veinte caracteres para una casilla corta normal.";
      expect(detectColumnType([longText, "Texto breve"]).type).toBe("Textarea");
    });
  });

  describe("inferSpreadsheetSchema", () => {
    it("generates a valid Savia CRM object configuration with pipeline and screen layout", () => {
      const headers = [
        "Cliente",
        "Email Contacto",
        "Teléfono",
        "Estado del Lead",
        "Valor Estimado",
        "Fecha Contacto",
        "Notas",
      ];
      const rows = [
        [
          "Acme Corp",
          "contacto@acme.com",
          "+57 300 111 2233",
          "Prospecto",
          "$ 5,000,000",
          "2026-09-01",
          "Primer contacto realizado.",
        ],
        [
          "Beta Ltd",
          "info@beta.com",
          "+57 300 444 5566",
          "Calificado",
          "$ 12,000,000",
          "2026-09-05",
          "Interesado en póliza colectiva.",
        ],
      ];

      const schema = inferSpreadsheetSchema({
        fileName: "prospectos_comerciales.xlsx",
        headers,
        rows,
      });

      expect(schema.collectionName).toBe("prospectos_comerciales");
      expect(schema.columns).toHaveLength(7);

      // Verify inferred types
      const types = schema.columns.map((c) => ({ key: c.key, type: c.type }));
      expect(types).toEqual([
        { key: "cliente", type: "Textbox" },
        { key: "email_contacto", type: "Email" },
        { key: "telefono", type: "Phone" },
        { key: "estado_del_lead", type: "Dropdown" },
        { key: "valor_estimado", type: "Currency" },
        { key: "fecha_contacto", type: "DateControl" },
        { key: "notas", type: "Textbox" },
      ]);

      // Verify suggested pipeline
      expect(schema.suggestedPipeline).toEqual({
        field: "estado_del_lead",
        amountField: "valor_estimado",
      });

      // Verify studio screen layout
      expect(schema.config.studio?.screen).toEqual(
        expect.objectContaining({
          hidden: false,
          section: "operation",
          createMode: "drawer-long",
          editMode: "drawer-long",
        }),
      );

      // Validate that the generated object satisfies Savia's strict objectSchema
      const studioObject = {
        name: schema.collectionName,
        label: schema.collectionLabel,
        description: schema.description,
        config: schema.config,
      };

      const parsed = objectSchema.safeParse(studioObject);
      expect(parsed.success).toBe(true);
    });

    it("detects product formula when column equals quantity * unit price", () => {
      const headers = ["Item", "Cantidad", "Precio Unitario", "Total"];
      const rows = [
        ["Laptop", 2, 1000, 2000],
        ["Monitor", 4, 250, 1000],
        ["Teclado", 5, 50, 250],
      ];

      const schema = inferSpreadsheetSchema({
        fileName: "pedidos.csv",
        headers,
        rows,
      });

      const totalCol = schema.columns.find((c) => c.key === "total");
      expect(totalCol?.formula).toEqual({
        op: "product",
        fields: ["cantidad", "precio_unitario"],
      });
      expect(schema.config.fields.total?.config?.formula).toEqual({
        op: "product",
        fields: ["cantidad", "precio_unitario"],
      });
    });

    it("detects foreign key relations when column matches known collection", () => {
      const headers = ["ID Póliza", "Cliente ID", "Valor"];
      const rows = [
        ["POL-1", "CLI-101", 150000],
        ["POL-2", "CLI-102", 250000],
      ];

      const knownCollections = [
        { name: "clientes", label: "Clientes Asegurados" },
        { name: "agencias", label: "Agencias" },
      ];

      const schema = inferSpreadsheetSchema({
        fileName: "polizas.csv",
        headers,
        rows,
        knownCollections,
      });

      const clientCol = schema.columns.find((c) => c.key === "cliente_id");
      expect(clientCol?.relation).toEqual({
        targetObject: "clientes",
        label: "Clientes Asegurados",
      });
      expect(schema.config.fields.cliente_id?.config).toEqual(
        expect.objectContaining({
          relation: "clientes",
          collectionRelation: "manual",
        }),
      );
    });

    it("generates form sections when column count exceeds threshold", () => {
      const headers = [
        "Nombre",
        "Email",
        "Teléfono",
        "Ciudad",
        "Prima Anual",
        "Valor Asegurado",
        "Fecha Inicio",
        "Activo",
        "Comentarios",
      ];
      const rows = [
        [
          "Carlos",
          "carlos@savia.io",
          "+57 300 1234567",
          "Bogotá",
          "$ 1,200,000",
          "$ 50,000,000",
          "2026-01-01",
          true,
          "Cliente preferencial",
        ],
      ];

      const schema = inferSpreadsheetSchema({
        fileName: "clientes_completos.xlsx",
        headers,
        rows,
      });

      expect(schema.config.studio?.sections).toBeDefined();
      expect(schema.config.studio?.sections?.length).toBeGreaterThanOrEqual(2);

      // Verify fields have section assignment
      expect(schema.config.fields.nombre?.config?.section).toBe("sec_general");
      expect(schema.config.fields.email?.config?.section).toBe("sec_contacto");
      expect(schema.config.fields.prima_anual?.config?.section).toBe(
        "sec_valores",
      );
      expect(schema.config.fields.fecha_inicio?.config?.section).toBe(
        "sec_estado",
      );

      // Verify Savia's objectSchema parses correctly with studio.sections
      const parsed = objectSchema.safeParse({
        name: schema.collectionName,
        label: schema.collectionLabel,
        description: schema.description,
        config: schema.config,
      });
      expect(parsed.success).toBe(true);
    });
  });
});
