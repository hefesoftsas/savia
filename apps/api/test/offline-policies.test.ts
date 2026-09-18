import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./combined-app";
import {
  agencyAdministratorAuthenticator,
  agencyMemberAuthenticator,
  platformAdministratorAuthenticator,
} from "./auth-fixtures";

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

async function seedTenant(id = 101): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO tenants (id, id_slug, name, is_active, created_at, updated_at, kind) VALUES (?, ?, ?, 1, '2026-01-01', '2026-01-01', 'commercial')",
  )
    .bind(id, `offline-tenant-${id}`, `Offline Tenant ${id}`)
    .run();
}

const json = { "content-type": "application/json" };

describe("Offline collection policies", () => {
  beforeAll(applyMigrations);
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM offline_collection_policies");
    await env.DB.exec("DELETE FROM identity_tenant_membership");
    await env.DB.exec("DELETE FROM identity_global_role");
    await env.DB.exec("DELETE FROM identity_principal");
    await env.DB.exec("DELETE FROM agencies");
    await env.DB.exec("DELETE FROM tenants");
    await seedTenant();
  });

  it("lets platform admins manage any tenant and members only their own", async () => {
    const administratorApp = createApp(
      env.DB,
      env.DOCUMENTS,
      undefined,
      platformAdministratorAuthenticator(),
    );
    const memberApp = createApp(
      env.DB,
      env.DOCUMENTS,
      undefined,
      agencyMemberAuthenticator(),
    );

    const empty = await administratorApp.request(
      "/v1/offline/collections?tenantId=101",
    );
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ data: [] });

    const saved = await administratorApp.request("/v1/offline/collections", {
      method: "PUT",
      headers: json,
      body: JSON.stringify({
        tenantId: 101,
        collection: "cotizaciones",
        enabled: true,
        refreshSeconds: 120,
      }),
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({
      data: expect.objectContaining({
        collection: "cotizaciones",
        enabled: true,
        refreshSeconds: 120,
      }),
    });

    const memberRead = await memberApp.request(
      "/v1/offline/collections?tenantId=101",
    );
    expect(memberRead.status).toBe(200);
    expect((await memberRead.json()) as unknown).toEqual({
      data: [expect.objectContaining({ collection: "cotizaciones" })],
    });

    const foreignRead = await memberApp.request(
      "/v1/offline/collections?tenantId=999",
    );
    expect(foreignRead.status).toBe(403);

    const memberWrite = await memberApp.request("/v1/offline/collections", {
      method: "PUT",
      headers: json,
      body: JSON.stringify({
        tenantId: 101,
        collection: "clientes",
        enabled: true,
        refreshSeconds: 120,
      }),
    });
    // Viewer members cannot manage policies.
    expect(memberWrite.status).toBe(403);
  });

  it("lets tenant admins manage their own tenant", async () => {
    const tenantAdminApp = createApp(
      env.DB,
      env.DOCUMENTS,
      undefined,
      agencyAdministratorAuthenticator(),
    );
    const saved = await tenantAdminApp.request("/v1/offline/collections", {
      method: "PUT",
      headers: json,
      body: JSON.stringify({
        tenantId: 101,
        collection: "polizas",
        enabled: false,
        refreshSeconds: 300,
      }),
    });
    expect(saved.status).toBe(200);

    const removed = await tenantAdminApp.request(
      "/v1/offline/collections?tenantId=101&collection=polizas",
      { method: "DELETE" },
    );
    expect(removed.status).toBe(204);

    const missing = await tenantAdminApp.request(
      "/v1/offline/collections?tenantId=101&collection=polizas",
      { method: "DELETE" },
    );
    expect(missing.status).toBe(404);
  });

  it("validates collection names and refresh intervals", async () => {
    const administratorApp = createApp(
      env.DB,
      env.DOCUMENTS,
      undefined,
      platformAdministratorAuthenticator(),
    );
    const badName = await administratorApp.request("/v1/offline/collections", {
      method: "PUT",
      headers: json,
      body: JSON.stringify({
        tenantId: 101,
        collection: "Clientes!",
        enabled: true,
        refreshSeconds: 120,
      }),
    });
    expect(badName.status).toBe(400);

    const badInterval = await administratorApp.request(
      "/v1/offline/collections",
      {
        method: "PUT",
        headers: json,
        body: JSON.stringify({
          tenantId: 101,
          collection: "clientes",
          enabled: true,
          refreshSeconds: 5,
        }),
      },
    );
    expect(badInterval.status).toBe(400);
  });
});
