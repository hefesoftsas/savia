import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import {
  AssistantConfigurationRepository,
  type AssistantModelCatalog,
} from "../src/assistant/configuration";
import type { AssistantService } from "../src/assistant/contracts";
import { createOAuthResourceAuthenticator } from "../src/auth/oauth-resource";
import type { Authenticator } from "../src/auth/types";
import {
  agencyAdministratorAuthenticator,
  agencyMemberAuthenticator,
  platformAdministratorAuthenticator,
} from "./auth-fixtures";
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

function createTestApp(
  authenticator: Authenticator = platformAdministratorAuthenticator(
    "admin-user-1",
  ),
) {
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

  it("lets tenant admins assign employee models but blocks ordinary members", async () => {
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO tenants(id,id_slug,name,is_active,created_at,updated_at,kind) VALUES(101,'assistant-model-tenant-101','Assistant Model Tenant',1,?,?,'commercial')",
    )
      .bind(now, now)
      .run();
    for (const [principalId, issuer, email, name, membershipId, role] of [
      [
        "test-agency-member",
        "savia:better-auth",
        "member@savia.test",
        "Savia Test Member",
        "assistant-model-member-101",
        "viewer",
      ],
      [
        "test-agency-administrator",
        "savia:better-auth",
        "administrator@savia.test",
        "Savia Test Agency Administrator",
        "assistant-model-admin-101",
        "agency_admin",
      ],
    ]) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO identity_principal (
          id, issuer, subject, email, display_name, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      )
        .bind(principalId, issuer, principalId, email, name, now, now)
        .run();
      await env.DB.prepare(
        `INSERT OR REPLACE INTO identity_tenant_membership (
          id, principal_id, tenant_id, role, is_active, created_at, updated_at
        ) VALUES (?, ?, 101, ?, 1, ?, ?)`,
      )
        .bind(membershipId, principalId, role, now, now)
        .run();
    }

    const membersApp = createTestApp(agencyMemberAuthenticator());
    const deniedCreate = await membersApp.request("/api/assistant/employees", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Member model attempt",
        handle: `member-model-${crypto.randomUUID()}`,
        systemPrompt: "Translate text",
        model: "openai/gpt-5",
      }),
    });
    expect(deniedCreate.status).toBe(403);

    const createdWithoutModel = await membersApp.request(
      "/api/assistant/employees",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Member inherited model",
          handle: `member-inherited-${crypto.randomUUID()}`,
          systemPrompt: "Translate text",
        }),
      },
    );
    expect(createdWithoutModel.status).toBe(201);
    const memberEmployee = (await createdWithoutModel.json()) as {
      data: { id: string };
    };
    const deniedPatch = await membersApp.request(
      `/api/assistant/employees/${memberEmployee.data.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "openai/gpt-5" }),
      },
    );
    expect(deniedPatch.status).toBe(403);

    const adminsApp = createTestApp(agencyAdministratorAuthenticator());
    const adminCreate = await adminsApp.request("/api/assistant/employees", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Admin model assignment",
        handle: `admin-model-${crypto.randomUUID()}`,
        systemPrompt: "Translate text",
        model: "openai/gpt-5",
      }),
    });
    expect(adminCreate.status).toBe(201);
    const adminEmployee = (await adminCreate.json()) as {
      data: { id: string; model: string };
    };
    expect(adminEmployee.data.model).toBe("openai/gpt-5");

    const updated = await adminsApp.request(
      `/api/assistant/employees/${adminEmployee.data.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "google/gemini-2.5-flash" }),
      },
    );
    expect(updated.status).toBe(200);
    await new VirtualEmployeesRepository(env.DB).delete(
      memberEmployee.data.id,
      101,
    );
    await new VirtualEmployeesRepository(env.DB).delete(
      adminEmployee.data.id,
      101,
    );
    await env.DB.prepare(
      "DELETE FROM identity_tenant_membership WHERE id IN (?, ?)",
    )
      .bind("assistant-model-member-101", "assistant-model-admin-101")
      .run();
  });

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

  it.each(["missing", "ambiguous"])(
    "rejects employee access with %s tenant membership",
    async (membershipState) => {
      const actor = await agencyAdministratorAuthenticator().authenticate(
        new Request("http://localhost"),
        env.DB,
      );
      const principalId = `employee-scope-${membershipState}`;
      actor.principal.id = principalId;
      actor.memberships =
        membershipState === "missing"
          ? []
          : [101, 202].map((tenantId) => ({
              ...actor.memberships[0],
              id: `${principalId}-${tenantId}`,
              principalId,
              tenantId,
              agencyId: tenantId,
            }));
      const app = createTestApp({ authenticate: async () => actor });
      for (const path of [
        "/api/assistant/employees",
        "/api/assistant/collections",
        "/api/assistant/mcp/employees",
      ]) {
        const response = await app.request(path);
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({
          error: { code: "AUTHORIZATION_FORBIDDEN" },
        });
      }
      const created = await app.request("/api/assistant/employees", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Unscoped employee",
          handle: `unscoped-${membershipState}`,
          systemPrompt: "Must never be created globally",
        }),
      });
      expect(created.status).toBe(403);
      expect(
        await new VirtualEmployeesRepository(env.DB).getByHandle(
          `unscoped-${membershipState}`,
        ),
      ).toBeNull();
    },
  );

  it("keeps employee routes tenant-scoped without an active selection", async () => {
    const now = "2026-09-29T00:00:00.000Z";
    await env.DB.prepare(
      "INSERT OR IGNORE INTO tenants(id,id_slug,name,is_active,created_at,updated_at,kind) VALUES(101,'employee-route-101','Employee Route Tenant 101',1,?,?,'commercial'),(202,'employee-route-202','Employee Route Tenant 202',1,?,?,'commercial')",
    )
      .bind(now, now, now, now)
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO identity_principal (
        id, issuer, subject, email, display_name, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    )
      .bind(
        "test-agency-administrator",
        "savia:better-auth",
        "test-agency-administrator",
        "administrator@savia.test",
        "Savia Test Agency Administrator",
        now,
        now,
      )
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO identity_tenant_membership (
        id, principal_id, tenant_id, role, is_active, created_at, updated_at
      ) VALUES (?, ?, 101, 'agency_admin', 1, ?, ?)`,
    )
      .bind(
        "employee-route-membership-101",
        "test-agency-administrator",
        now,
        now,
      )
      .run();

    const repo = new VirtualEmployeesRepository(env.DB);
    const global = await repo.create({
      name: "Global Employee Route Test",
      handle: `global-route-${crypto.randomUUID()}`,
      systemPrompt: "Global employee prompt",
    });
    const tenantEmployee = await repo.create({
      agencyId: 101,
      name: "Tenant Employee Route Test",
      handle: `tenant-route-${crypto.randomUUID()}`,
      systemPrompt: "Tenant employee prompt",
    });
    const otherTenantEmployee = await repo.create({
      agencyId: 202,
      name: "Other Tenant Employee Route Test",
      handle: `other-route-${crypto.randomUUID()}`,
      systemPrompt: "Other tenant employee prompt",
    });
    const otherTenantFile = await repo.addFile({
      id: crypto.randomUUID(),
      employeeId: otherTenantEmployee.id,
      name: "private.txt",
      contentType: "text/plain",
      sizeBytes: 6,
      r2Key: `assistant/employees/${otherTenantEmployee.id}/private.txt`,
      ragStatus: "indexed",
    });

    const app = createTestApp(agencyAdministratorAuthenticator());
    const headers = { authorization: "Bearer admin-token" };
    for (const [tenant, name] of [
      ["tenant:0", "employee_global_collection"],
      ["tenant:101", "employee_tenant_collection"],
      ["tenant:202", "employee_other_collection"],
    ]) {
      await env.DB.prepare(
        "INSERT OR REPLACE INTO studio_objects (tenant_id, name, label, description, config, version) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind(tenant, name, name, "employee scope test", JSON.stringify({}), 1)
        .run();
    }
    const listResponse = await app.request("/api/assistant/employees", {
      headers,
    });
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as {
      data: Array<{ id: string }>;
    };
    expect(listed.data.map(({ id }) => id)).toContain(tenantEmployee.id);
    expect(listed.data.map(({ id }) => id)).not.toContain(global.id);
    expect(listed.data.map(({ id }) => id)).not.toContain(
      otherTenantEmployee.id,
    );

    const collectionResponse = await app.request("/api/assistant/collections", {
      headers,
    });
    const collections = (await collectionResponse.json()) as {
      data: Array<{ name: string }>;
    };
    const collectionNames = collections.data.map(({ name }) => name);
    expect(collectionNames).toContain("employee_tenant_collection");
    expect(collectionNames).not.toContain("employee_global_collection");
    expect(collectionNames).not.toContain("employee_other_collection");

    expect(
      (
        await app.request(
          `/api/assistant/employees/${otherTenantEmployee.id}`,
          {
            headers,
          },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(
          `/api/assistant/employees/${otherTenantEmployee.id}`,
          {
            method: "PATCH",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({ name: "Cross tenant edit" }),
          },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(
          `/api/assistant/employees/${otherTenantEmployee.id}`,
          {
            method: "DELETE",
            headers,
          },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(
          `/api/assistant/employees/${otherTenantEmployee.id}/files`,
          {
            method: "POST",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({ name: "secret.txt", content: "secret" }),
          },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(
          `/api/assistant/employees/${otherTenantEmployee.id}/files/${otherTenantFile.id}`,
          { method: "DELETE", headers },
        )
      ).status,
    ).toBe(404);
    expect(await repo.getFile(otherTenantFile.id)).not.toBeNull();

    const createResponse = await app.request("/api/assistant/employees", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        name: "New Tenant Employee",
        handle: `new-tenant-${crypto.randomUUID()}`,
        systemPrompt: "Tenant scoped creation",
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as {
      data: { id: string; agencyId: number };
    };
    expect(created.data.agencyId).toBe(101);

    await repo.delete(global.id);
    await repo.delete(tenantEmployee.id, 101);
    await repo.delete(otherTenantEmployee.id, 202);
    await repo.delete(created.data.id, 101);
  });

  it("lists available CRM collections for virtual employees", async () => {
    const app = createTestApp();
    await env.DB.prepare(
      "INSERT OR REPLACE INTO studio_objects (tenant_id, name, label, description, config, version) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(
        "tenant:0",
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
    const patchRes = await app.request(
      `/api/assistant/employees/${created.id}`,
      {
        method: "PATCH",
        headers: {
          authorization: "Bearer admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          position: "Coordinadora de Siniestros",
          allowedCollections: ["*"],
        }),
      },
    );
    expect(patchRes.status).toBe(200);
    const updated = ((await patchRes.json()) as any).data;
    expect(updated.position).toBe("Coordinadora de Siniestros");
    expect(updated.allowedCollections).toEqual(["*"]);

    // 5. Delete
    const deleteRes = await app.request(
      `/api/assistant/employees/${created.id}`,
      {
        method: "DELETE",
        headers: { authorization: "Bearer admin-token" },
      },
    );
    expect(deleteRes.status).toBe(200);

    const getAfterDelete = await app.request(
      `/api/assistant/employees/${created.id}`,
      {
        headers: { authorization: "Bearer admin-token" },
      },
    );
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
    const uploadRes = await app.request(
      `/api/assistant/employees/${employee.id}/files`,
      {
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
      },
    );

    expect(uploadRes.status).toBe(201);
    const file = ((await uploadRes.json()) as any).data;
    expect(file.id).toBeDefined();
    expect(file.name).toBe("manual_operaciones.md");
    expect(file.ragStatus).toBe("indexed");

    // Check employee detail now includes the file
    const detailRes = await app.request(
      `/api/assistant/employees/${employee.id}`,
      {
        headers: { authorization: "Bearer admin-token" },
      },
    );
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
