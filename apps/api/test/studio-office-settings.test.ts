import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppActor, Authenticator } from "../src/auth/types";
import { authenticationMiddleware } from "../src/auth/middleware";
import { registerStudioRoutes } from "../src/routes/studio";
import type { createCollectionGateway } from "../src/studio/collection-gateway";

const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([a], [b]) => a.localeCompare(b));

async function applyMigrations() {
  for (const [, sql] of migrations)
    for (const statement of sql.split("--> statement-breakpoint")) {
      const normalized = statement
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (normalized) await env.DB.exec(normalized);
    }
}

describe("Studio Office editor settings gate", () => {
  beforeAll(async () => {
    await applyMigrations();
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO tenants(id,id_slug,name,is_active,created_at,updated_at) VALUES(9481,'studio-office-one','Studio Office One',1,?,?)",
    )
      .bind(now, now)
      .run();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO identity_principal(id,issuer,subject,email,display_name,is_active,created_at,updated_at) VALUES('studio-office-admin','savia:test','studio-office-admin','studio-office-admin@savia.test','Studio Office Admin',1,?,?)",
    )
      .bind(now, now)
      .run();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at) VALUES('studio-office-membership','studio-office-admin',9481,'tenant_admin',1,?,?)",
    )
      .bind(now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO office_settings(tenant_id,platform_allowed,tenant_enabled,updated_at) VALUES(9481,1,0,?) ON CONFLICT(tenant_id) DO UPDATE SET platform_allowed=1,tenant_enabled=0,updated_at=excluded.updated_at",
    )
      .bind(now)
      .run();
  });

  it("blocks the editor API before constructing the Studio gateway", async () => {
    const actor: AppActor = {
      principal: {
        id: "studio-office-admin",
        issuer: "savia:test",
        subject: "studio-office-admin",
        email: "studio-office-admin@savia.test",
        displayName: "Studio Office Admin",
        isActive: true,
        createdAt: "",
        updatedAt: "",
      },
      globalRoles: [],
      memberships: [
        {
          id: "studio-office-membership",
          principalId: "studio-office-admin",
          agencyId: 9481,
          tenantId: 9481,
          role: "tenant_admin",
          isActive: true,
          createdAt: "",
          updatedAt: "",
        },
      ],
    };
    const auth: Authenticator = {
      async authenticate() {
        return actor;
      },
    };
    const app = new OpenAPIHono();
    app.use("*", authenticationMiddleware(env.DB, auth));
    let gatewayCalled = false;
    const gatewayFactory = (() => {
      gatewayCalled = true;
      return {
        async prepare() {},
        async fetch() {
          return new Response("unexpected gateway call", { status: 200 });
        },
      };
    }) as typeof createCollectionGateway;
    registerStudioRoutes(
      app,
      env.DB,
      env.DOCUMENTS,
      undefined,
      undefined,
      undefined,
      gatewayFactory,
    );

    for (const suffix of ["office", "revisions", "revisions/1/download"]) {
      const response = await app.request(
        `/v1/studio/9481/api/file/document-1/${suffix}`,
      );
      expect(response.status, await response.clone().text()).toBe(403);
      expect(await response.json()).toMatchObject({
        error: { code: "OFFICE_SUITE_DISABLED" },
      });
    }
    expect(gatewayCalled).toBe(false);
    const generalAttachment = await app.request(
      "/v1/studio/9481/api/file/document-1/download",
    );
    expect(generalAttachment.status).toBe(200);
    expect(gatewayCalled).toBe(true);
  });
});
