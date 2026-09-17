import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { VirtualEmployeesRepository } from "../src/assistant/virtual-employees";

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

describe("VirtualEmployeesRepository", () => {
  beforeAll(applyMigrations);

  const repo = new VirtualEmployeesRepository(env.DB);

  it("lists default seeded virtual employees", async () => {
    const list = await repo.list();
    expect(list.length).toBeGreaterThanOrEqual(2);

    const handles = list.map((e) => e.handle);
    expect(handles).toContain("ventas");
    expect(handles).toContain("soporte");
  });

  it("finds an employee by handle with or without @ symbol", async () => {
    const emp1 = await repo.getByHandle("ventas");
    const emp2 = await repo.getByHandle("@ventas");
    expect(emp1).not.toBeNull();
    expect(emp2).not.toBeNull();
    expect(emp1?.id).toBe(emp2?.id);
    expect(emp1?.name).toContain("Laura");
  });

  it("creates, updates, and fetches a new agency virtual employee", async () => {
    const created = await repo.create({
      name: "Andrés - Analista de Riesgos",
      handle: "@riesgos",
      position: "Especialista en Evaluación de Riesgos",
      avatar: "shield-alert",
      greeting: "Hola, analizo los riesgos de tus clientes.",
      systemPrompt: "Eres Andrés, analista de riesgos. Tu labor es verificar siniestralidad.",
      allowedCollections: ["customers", "policies"],
      createdBy: "test-admin",
    });

    expect(created.id).toBeDefined();
    expect(created.handle).toBe("riesgos");
    expect(created.allowedCollections).toEqual(["customers", "policies"]);

    // Fetch by handle
    const fetched = await repo.getByHandle("riesgos");
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.avatar).toBe("shield-alert");

    // Update
    const updated = await repo.update(created.id, {
      position: "Senior Risk Analyst",
      allowedCollections: ["*"],
    });

    expect(updated?.position).toBe("Senior Risk Analyst");
    expect(updated?.allowedCollections).toEqual(["*"]);

    // Clean up
    await repo.delete(created.id);
    const deleted = await repo.getById(created.id);
    expect(deleted).toBeNull();
  });

  it("manages attached files for an employee", async () => {
    const emp = await repo.getByHandle("ventas");
    expect(emp).not.toBeNull();

    const fileId = crypto.randomUUID();
    const addedFile = await repo.addFile({
      id: fileId,
      employeeId: emp!.id,
      name: "politica_precios.pdf",
      contentType: "application/pdf",
      sizeBytes: 1024,
      r2Key: `assistant/employees/${emp!.id}/files/${fileId}`,
      ragStatus: "indexed",
    });

    expect(addedFile.id).toBe(fileId);
    expect(addedFile.name).toBe("politica_precios.pdf");

    const files = await repo.listFiles(emp!.id);
    expect(files.some((f) => f.id === fileId)).toBe(true);

    const fileDetails = await repo.getFile(fileId);
    expect(fileDetails?.name).toBe("politica_precios.pdf");

    await repo.removeFile(fileId);
    const afterDelete = await repo.getFile(fileId);
    expect(afterDelete).toBeNull();
  });
});
