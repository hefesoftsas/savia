import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  agencyMemberAuthenticator,
  platformAdministratorAuthenticator,
} from "./auth-fixtures";
import { createTestApp } from "./test-app";

const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([a], [b]) => a.localeCompare(b));

beforeAll(async () => {
  for (const [, sql] of migrations) {
    for (const statement of sql
      .split("--> statement-breakpoint")
      .map((entry) =>
        entry
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean)) {
      await env.DB.exec(statement);
    }
  }
});

beforeEach(async () => {
  // These fixtures recreate tenant IDs; clear their scoped ACL state as well.
  await env.DB.exec("DELETE FROM access_roles WHERE scope LIKE 'tenant:%'");
  await env.DB.exec("DELETE FROM access_revisions WHERE scope LIKE 'tenant:%'");
  await env.DB.exec("DELETE FROM tenants");
  await env.DB.exec(
    "INSERT INTO tenants (id, id_slug, name, is_active, kind, created_at, updated_at) VALUES (101, 'merkaseguros', 'Merka Seguros', 1, 'commercial', '2026-09-09', '2026-09-09'), (202, 'other-agency', 'Other Agency', 1, 'commercial', '2026-09-09', '2026-09-09')",
  );
});

describe("tenantHostGuard", () => {
  it("allows access when the host matches the actor's commercial tenant slug", async () => {
    const app = createTestApp({
      auth: agencyMemberAuthenticator(), // membership is tenant 101 ('merkaseguros')
    });

    const response = await app.request(
      "https://merkaseguros.savia.app.hefesoft.com/v1/identity/me",
    );
    expect(response.status).toBe(200);
  });

  it("blocks access with 403 TENANT_HOST_MISMATCH when accessing another tenant's subdomain", async () => {
    const app = createTestApp({
      auth: agencyMemberAuthenticator(), // membership is tenant 101 ('merkaseguros')
    });

    const response = await app.request(
      "https://other-agency.savia.app.hefesoft.com/v1/identity/me",
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as {
      error: { code: string };
      expectedHost?: string;
    };
    expect(body.error.code).toBe("TENANT_HOST_MISMATCH");
    expect(body.expectedHost).toBe("merkaseguros.savia.app.hefesoft.com");
  });

  it("blocks access with 403 when tenant slug is passed via x-savia-tenant-slug header", async () => {
    const app = createTestApp({
      auth: agencyMemberAuthenticator(),
    });

    const response = await app.request("http://127.0.0.1:8787/v1/identity/me", {
      headers: {
        "x-savia-tenant-slug": "other-agency",
      },
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as {
      error: { code: string };
      expectedHost?: string;
    };
    expect(body.error.code).toBe("TENANT_HOST_MISMATCH");
    expect(body.expectedHost).toBe("merkaseguros.savia.app.hefesoft.com");
  });

  it("allows platform administrators to access any tenant subdomain", async () => {
    const app = createTestApp({
      auth: platformAdministratorAuthenticator(),
    });

    const response = await app.request(
      "https://other-agency.savia.app.hefesoft.com/v1/identity/me",
    );
    expect(response.status).toBe(200);
  });

  it("allows requests on the canonical host without tenant restrictions", async () => {
    const app = createTestApp({
      auth: agencyMemberAuthenticator(),
    });

    const response = await app.request(
      "https://savia.app.hefesoft.com/v1/identity/me",
    );
    expect(response.status).toBe(200);
  });
});

describe("GET /v1/tenants/current", () => {
  it("returns canonical platform info when requesting canonical host", async () => {
    const app = createTestApp({
      auth: agencyMemberAuthenticator(),
    });

    const response = await app.request(
      "https://savia.app.hefesoft.com/v1/tenants/current",
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Record<string, unknown> };
    expect(body.data).toEqual({
      isDedicated: false,
      slug: null,
      name: "Savia",
      kind: "platform",
      id: null,
    });
  });

  it("returns tenant info when requesting a tenant subdomain", async () => {
    const app = createTestApp({
      auth: agencyMemberAuthenticator(),
    });

    const response = await app.request(
      "https://merkaseguros.savia.app.hefesoft.com/v1/tenants/current",
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Record<string, unknown> };
    expect(body.data).toEqual({
      isDedicated: true,
      slug: "merkaseguros",
      name: "Merka Seguros",
      kind: "commercial",
      id: 101,
    });
  });

  it("returns 404 when tenant slug does not exist", async () => {
    const app = createTestApp({
      auth: platformAdministratorAuthenticator(),
    });

    const response = await app.request(
      "https://non-existent.savia.app.hefesoft.com/v1/tenants/current",
    );
    expect(response.status).toBe(404);
  });
});
