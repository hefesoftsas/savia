import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  chunkText,
  extractTextFromFile,
  indexDocument,
  retrieveRelevantChunks,
  deleteFileVectors,
} from "../src/assistant/rag";

const migrationSqls = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([, sql]) => sql);

function migrationStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((statement) =>
      statement
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

async function applyMigrations() {
  for (const migration of migrationSqls) {
    for (const statement of migrationStatements(migration)) {
      await env.DB.exec(statement);
    }
  }
}

describe("Assistant RAG", () => {
  beforeAll(applyMigrations);

  beforeEach(async () => {
    await env.DB.exec("DELETE FROM assistant_virtual_employee_chunks");
    await env.DB.exec("DELETE FROM assistant_virtual_employee_files");
  });

  describe("chunkText", () => {
    it("returns empty array for empty or whitespace text", () => {
      expect(chunkText("")).toEqual([]);
      expect(chunkText("   \n\n   ")).toEqual([]);
    });

    it("splits long text by paragraphs with overlap", () => {
      const p1 = "Este es el primer párrafo de las políticas de la aseguradora para vehículos.";
      const p2 = "Este es el segundo párrafo con detalles de cotizaciones y tarifas comerciales.";
      const p3 = "Este es el tercer párrafo que describe las exclusiones generales de la póliza.";
      const full = `${p1}\n\n${p2}\n\n${p3}`;

      const chunks = chunkText(full, 120, 30);
      expect(chunks.length).toBeGreaterThanOrEqual(2);
      expect(chunks[0]).toContain("primer párrafo");
    });
  });

  describe("extractTextFromFile", () => {
    it("extracts text from plain string or text buffer", () => {
      const text = "Reglas de suscripción 2026";
      const buffer = new TextEncoder().encode(text).buffer;
      expect(extractTextFromFile(buffer, "text/plain", "reglas.txt")).toBe(text);
    });

    it("extracts and formats JSON content", () => {
      const data = { cobertura: "amplia", deducible: 5 };
      const jsonStr = JSON.stringify(data);
      const buffer = new TextEncoder().encode(jsonStr).buffer;
      const extracted = extractTextFromFile(buffer, "application/json", "coberturas.json");
      expect(extracted).toContain('"cobertura": "amplia"');
    });
  });

  describe("indexing and retrieval (Local D1 Fallback & Vectorize Mock)", () => {
    it("indexes document chunks and retrieves relevant content using local fallback", async () => {
      const employeeId = "emp-default-ventas";
      const fileId = "file-123";

      // Insert dummy file first for foreign key
      await env.DB.prepare(
        `INSERT INTO assistant_virtual_employee_files (id, employee_id, name, content_type, size_bytes, r2_key, rag_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(fileId, employeeId, "tarifas.md", "text/markdown", 100, "r2/key", "indexed", new Date().toISOString())
        .run();

      const docText = `
        Tarifas y Cotizaciones 2026 para Autos Comerciales.
        Para cotizar autos comerciales se requiere tarjeta de propiedad y cédula del tomador.
        El deducible estándar es del 10% del valor comercial.

        Políticas de Descuentos Especiales:
        Los clientes con más de 3 vehículos reciben un 15% de descuento adicional en la prima anual.
      `;

      const result = await indexDocument(
        { DB: env.DB },
        employeeId,
        fileId,
        "tarifas.md",
        docText,
      );

      expect(result.chunksCount).toBeGreaterThan(0);

      // Verify retrieval for "descuento clientes vehículos"
      const chunks = await retrieveRelevantChunks(
        { DB: env.DB },
        employeeId,
        "descuento para clientes con vehículos",
      );

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].text).toContain("descuento adicional");
    });

    it("uses Cloudflare Vectorize and Workers AI when available", async () => {
      const employeeId = "emp-default-ventas";
      const fileId = "file-mock-ai";

      await env.DB.prepare(
        `INSERT INTO assistant_virtual_employee_files (id, employee_id, name, content_type, size_bytes, r2_key, rag_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(fileId, employeeId, "manual.txt", "text/plain", 50, "r2/manual", "indexed", new Date().toISOString())
        .run();

      const insertedVectors: unknown[] = [];
      const mockAi = {
        async run(model: string, input: { text: string[] | string }) {
          const count = Array.isArray(input.text) ? input.text.length : 1;
          const fakeVectors = Array.from({ length: count }, () => [0.1, 0.2, 0.3]);
          return { data: fakeVectors };
        },
      };

      const mockVectorize = {
        async insert(vectors: Array<{ id: string; values: number[]; metadata?: Record<string, unknown> }>) {
          insertedVectors.push(...vectors);
          return { count: vectors.length };
        },
        async query() {
          return {
            matches: [
              {
                id: "vec-1",
                score: 0.95,
                metadata: {
                  file_id: fileId,
                  chunk_index: 0,
                  text: "Contenido recuperado desde Vectorize",
                },
              },
            ],
          };
        },
        async deleteByIds() {
          return { success: true };
        },
      };

      await indexDocument(
        { DB: env.DB, AI: mockAi, VECTORIZE: mockVectorize },
        employeeId,
        fileId,
        "manual.txt",
        "Texto de prueba para indexación vectorial con Cloudflare.",
      );

      expect(insertedVectors.length).toBeGreaterThan(0);

      const matches = await retrieveRelevantChunks(
        { DB: env.DB, AI: mockAi, VECTORIZE: mockVectorize },
        employeeId,
        "prueba vectorial",
      );

      expect(matches.length).toBe(1);
      expect(matches[0].text).toBe("Contenido recuperado desde Vectorize");
      expect(matches[0].score).toBe(0.95);
    });

    it("deletes file vectors and chunks", async () => {
      const employeeId = "emp-default-ventas";
      const fileId = "file-to-delete";

      await env.DB.prepare(
        `INSERT INTO assistant_virtual_employee_files (id, employee_id, name, content_type, size_bytes, r2_key, rag_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(fileId, employeeId, "delete.txt", "text/plain", 10, "r2/del", "indexed", new Date().toISOString())
        .run();

      await indexDocument(
        { DB: env.DB },
        employeeId,
        fileId,
        "delete.txt",
        "Contenido que será eliminado.",
      );

      await deleteFileVectors({ DB: env.DB }, employeeId, fileId);

      const chunks = await retrieveRelevantChunks(
        { DB: env.DB },
        employeeId,
        "eliminado",
      );
      expect(chunks).toHaveLength(0);
    });
  });
});
