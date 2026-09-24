import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import {
  AssistantConfigurationRepository,
  type AssistantModelCatalog,
} from "../src/assistant/configuration";
import type { AssistantService } from "../src/assistant/contracts";
import { createOAuthResourceAuthenticator } from "../src/auth/oauth-resource";
import { platformAdministratorAuthenticator } from "./auth-fixtures";

const migrationSqls = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([, sql]) => sql);

async function applyMigrations() {
  for (const migration of migrationSqls) {
    for (const statement of migration
      .split("--> statement-breakpoint")
      .map((part) =>
        part
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean)) {
      await env.DB.exec(statement);
    }
  }
}

function createTestApp() {
  const authenticator = platformAdministratorAuthenticator("admin-user-1");
  const assistantConfig = new AssistantConfigurationRepository(env.DB, {
    encryptionKey: btoa("k".repeat(32)),
  });

  return createApp(
    env.DB,
    env.DOCUMENTS,
    undefined,
    authenticator,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    assistantConfig,
  );
}

describe("Virtual Employees API Routes", () => {
  beforeAll(applyMigrations);

  it("lists virtual employees including seeded defaults", async () => {
    const app = createTestApp();
    const response = await app.request("/api/assistant/employees", {
      headers: { authorization: "Bearer admin-token" },
    });

    expect(response.status).toBe(200);
    const json = (await response.json()) as { data: Array<{ handle: string }> };
    const handles = json.data.map((e) => e.handle);
    expect(handles).toContain("ventas");
    expect(handles).toContain("soporte");
  });

  it("lists available CRM collections for virtual employees", async () => {
    const app = createTestApp();
    await env.DB.prepare(
      "INSERT OR REPLACE INTO studio_objects (tenant_id, name, label, description, config, version) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(
        "domain:platform",
        "clientes_test",
        "Clientes de Prueba",
        "Colección de clientes",
        JSON.stringify({ fields: {} }),
        1,
      )
      .run();

    const response = await app.request("/api/assistant/collections", {
      headers: { authorization: "Bearer admin-token" },
    });

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      data: Array<{ name: string; label: string; description: string }>;
    };
    expect(Array.isArray(json.data)).toBe(true);
    const names = json.data.map((c) => c.name);
    expect(names).toContain("clientes_test");
    const found = json.data.find((c) => c.name === "clientes_test");
    expect(found?.label).toBe("Clientes de Prueba");
  });

  it("creates, retrieves, updates, and deletes a new virtual employee", async () => {
    const app = createTestApp();

    // 1. Create
    const createRes = await app.request("/api/assistant/employees", {
      method: "POST",
      headers: {
        authorization: "Bearer admin-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Mariana - Siniestros",
        handle: "siniestros",
        position: "Especialista en Reclamos",
        avatar: "shield",
        greeting: "Hola, te ayudo a radicar o consultar siniestros.",
        systemPrompt: "Eres Mariana, especialista en siniestros y reclamos.",
        allowedCollections: ["claims", "customers"],
      }),
    });

    expect(createRes.status).toBe(201);
    const created = ((await createRes.json()) as any).data;
    expect(created.handle).toBe("siniestros");
    expect(created.allowedCollections).toEqual(["claims", "customers"]);

    // 2. Duplicate handle rejection
    const duplicateRes = await app.request("/api/assistant/employees", {
      method: "POST",
      headers: {
        authorization: "Bearer admin-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Otro Siniestros",
        handle: "siniestros",
        systemPrompt: "Prompt",
      }),
    });
    expect(duplicateRes.status).toBe(409);

    // 3. Get by ID
    const getRes = await app.request(`/api/assistant/employees/${created.id}`, {
      headers: { authorization: "Bearer admin-token" },
    });
    expect(getRes.status).toBe(200);
    const fetched = ((await getRes.json()) as any).data;
    expect(fetched.id).toBe(created.id);
    expect(fetched.name).toBe("Mariana - Siniestros");

    // 4. Update
    const patchRes = await app.request(`/api/assistant/employees/${created.id}`, {
      method: "PATCH",
      headers: {
        authorization: "Bearer admin-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        position: "Coordinadora de Siniestros",
        allowedCollections: ["*"],
      }),
    });
    expect(patchRes.status).toBe(200);
    const updated = ((await patchRes.json()) as any).data;
    expect(updated.position).toBe("Coordinadora de Siniestros");
    expect(updated.allowedCollections).toEqual(["*"]);

    // 5. Delete
    const deleteRes = await app.request(`/api/assistant/employees/${created.id}`, {
      method: "DELETE",
      headers: { authorization: "Bearer admin-token" },
    });
    expect(deleteRes.status).toBe(200);

    const getAfterDelete = await app.request(`/api/assistant/employees/${created.id}`, {
      headers: { authorization: "Bearer admin-token" },
    });
    expect(getAfterDelete.status).toBe(404);
  });

  it("handles document upload, Cloudflare RAG indexing, and file deletion", async () => {
    const app = createTestApp();

    // Create an employee first
    const createRes = await app.request("/api/assistant/employees", {
      method: "POST",
      headers: {
        authorization: "Bearer admin-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Roberto - Operaciones",
        handle: "operaciones",
        systemPrompt: "Eres Roberto.",
      }),
    });
    const employee = ((await createRes.json()) as any).data;

    // Upload file using JSON payload
    const uploadRes = await app.request(`/api/assistant/employees/${employee.id}/files`, {
      method: "POST",
      headers: {
        authorization: "Bearer admin-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "manual_operaciones.md",
        contentType: "text/markdown",
        content: `
          # Manual Operativo 2026
          Para emitir una póliza colectiva se requiere la aprobación de gerencia técnica.
          Los tiempos de respuesta máximos son de 48 horas hábiles.
        `,
      }),
    });

    expect(uploadRes.status).toBe(201);
    const file = ((await uploadRes.json()) as any).data;
    expect(file.id).toBeDefined();
    expect(file.name).toBe("manual_operaciones.md");
    expect(file.ragStatus).toBe("indexed");

    // Check employee detail now includes the file
    const detailRes = await app.request(`/api/assistant/employees/${employee.id}`, {
      headers: { authorization: "Bearer admin-token" },
    });
    const detail = ((await detailRes.json()) as any).data;
    expect(detail.files).toHaveLength(1);
    expect(detail.files[0].id).toBe(file.id);

    // Delete file
    const deleteFileRes = await app.request(
      `/api/assistant/employees/${employee.id}/files/${file.id}`,
      {
        method: "DELETE",
        headers: { authorization: "Bearer admin-token" },
      },
    );
    expect(deleteFileRes.status).toBe(200);

    const detailAfterFileDelete = await app.request(
      `/api/assistant/employees/${employee.id}`,
      { headers: { authorization: "Bearer admin-token" } },
    );
    const detailAfter = ((await detailAfterFileDelete.json()) as any).data;
    expect(detailAfter.files).toHaveLength(0);

    // Clean up employee
    await app.request(`/api/assistant/employees/${employee.id}`, {
      method: "DELETE",
      headers: { authorization: "Bearer admin-token" },
    });
  });
});
