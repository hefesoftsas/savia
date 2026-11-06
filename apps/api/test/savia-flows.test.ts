import { env } from "cloudflare:workers";
import { jwtVerify, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestApp } from "./test-app";
import {
  agencyAdministratorAuthenticator,
  agencyMemberAuthenticator,
  platformAdministratorAuthenticator,
} from "./auth-fixtures";
import type { Authenticator } from "../src/auth/types";
import type { SaviaFlowsOptions } from "../src/routes/savia-flows";

const bridgeSecret = "savia-flows-test-bridge-secret-32-bytes-minimum";
const tenant = "tenant:101";
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
    for (const statement of migration.split("--> statement-breakpoint")) {
      const normalized = statement
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (normalized) await env.DB.exec(normalized);
    }
  }
}

async function seedWebSocketMembership(role = "tenant_admin") {
  const principalId = "test-agency-administrator";
  await env.DB.prepare(
    "INSERT OR IGNORE INTO tenants(id,id_slug,name,is_active,created_at,updated_at,kind) VALUES(101,'savia-flows-test-tenant','Flows test tenant',1,'2026-01-01','2026-01-01','commercial')",
  ).run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO identity_principal(id,issuer,subject,email,display_name,is_active,created_at,updated_at) VALUES(?,?,?,?,?,1,'2026-01-01','2026-01-01')",
  )
    .bind(
      principalId,
      "savia:better-auth",
      principalId,
      "administrator@savia.test",
      "Savia Test Agency Administrator",
    )
    .run();
  await env.DB.prepare(
    "INSERT OR REPLACE INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at) VALUES('test-agency-administrator-membership',?,?,?,1,'2026-01-01','2026-01-01')",
  )
    .bind(principalId, 101, role)
    .run();
  return principalId;
}

beforeAll(async () => {
  await applyMigrations();
  await seedWebSocketMembership();
});

afterAll(async () => {
  await env.DB.prepare(
    "DELETE FROM savia_flows_ws_tickets WHERE principal_id='test-agency-administrator'",
  ).run();
  await env.DB.prepare(
    "DELETE FROM identity_tenant_membership WHERE principal_id='test-agency-administrator'",
  ).run();
  await env.DB.prepare(
    "DELETE FROM identity_principal WHERE id='test-agency-administrator'",
  ).run();
});

function appFor(auth: Authenticator, options: SaviaFlowsOptions = {}) {
  const app = createTestApp({
    auth,
    saviaFlows: { bridgeSecret, ...options },
  });
  const request = app.request.bind(app);
  app.request = (input, init, requestEnv, executionCtx) =>
    request(input, init, requestEnv ?? env, executionCtx);
  return app;
}

describe("Savia Flows host gateway", () => {
  it("authorizes editor commands from fresh host roles and rejects other JWT audiences", async () => {
    const principalId = await seedWebSocketMembership();
    const app = appFor(agencyAdministratorAuthenticator());
    async function authorize(
      audience = "savia-flows-host",
      scopedTenant = tenant,
    ) {
      const token = await new SignJWT({
        tenant: scopedTenant,
        workflowId: "workflow-1",
      })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(principalId)
        .setIssuer("savia-flows")
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime("10s")
        .sign(new TextEncoder().encode(bridgeSecret));
      return app.request("/api/public/savia-flows/authorize-editor", {
        method: "POST",
        headers: { authorization: "Bearer " + token },
      });
    }
    expect((await authorize()).status).toBe(200);
    expect((await authorize("savia-flows")).status).toBe(401);
    expect((await authorize("savia-flows-host", "tenant:999")).status).toBe(
      403,
    );
    await env.DB.prepare(
      "UPDATE identity_tenant_membership SET role='viewer' WHERE principal_id=? AND tenant_id=101",
    )
      .bind(principalId)
      .run();
    expect((await authorize()).status).toBe(403);
    await seedWebSocketMembership();
    expect(
      (
        await app.request("/api/public/savia-flows/authorize-editor", {
          method: "POST",
        })
      ).status,
    ).toBe(401);
  });

  it("allows platform administrators to edit the platform workspace and rejects non-platform principals", async () => {
    const principalId = await seedWebSocketMembership();
    const app = appFor(agencyAdministratorAuthenticator());
    async function authorizePlatform() {
      const token = await new SignJWT({
        tenant: "tenant:0",
        workflowId: "workflow-1",
      })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(principalId)
        .setIssuer("savia-flows")
        .setAudience("savia-flows-host")
        .setIssuedAt()
        .setExpirationTime("10s")
        .sign(new TextEncoder().encode(bridgeSecret));
      return app.request("/api/public/savia-flows/authorize-editor", {
        method: "POST",
        headers: { authorization: "Bearer " + token },
      });
    }
    await env.DB.prepare(
      "INSERT OR IGNORE INTO tenants(id,id_slug,name,is_active,kind,created_at,updated_at) VALUES(0,'platform','Platform',1,'platform','2026-01-01','2026-01-01')",
    ).run();
    expect((await authorizePlatform()).status).toBe(403);
    await env.DB.prepare(
      "INSERT OR IGNORE INTO identity_global_role(principal_id,role,created_at) VALUES(?,'platform_admin','2026-01-01')",
    )
      .bind(principalId)
      .run();
    try {
      expect((await authorizePlatform()).status).toBe(200);
    } finally {
      await env.DB.prepare(
        "DELETE FROM identity_global_role WHERE principal_id=?",
      )
        .bind(principalId)
        .run();
    }
  });

  it("lets an active tenant member read and execute, but not mutate", async () => {
    const fetcher = vi.fn(() => Response.json({ ok: true }));
    const app = appFor(agencyMemberAuthenticator(), {
      service: { fetch: fetcher },
    });
    const read = await app.request(
      "/v1/savia-flows/tenant:101/workflows?tenant=tenant%3A101",
    );
    const execute = await app.request(
      "/v1/savia-flows/tenant:101/workflows/wf-1/execute?tenant=tenant%3A101",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    const mutate = await app.request(
      "/v1/savia-flows/tenant:101/workflows/wf-1?tenant=tenant%3A101",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );

    expect(read.status).toBe(200);
    expect(execute.status).toBe(200);
    expect(mutate.status).toBe(403);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("permits only tenant administrators to manage Savia Flows API keys", async () => {
    const fetcher = vi.fn(() => Response.json({ apiKeys: [] }));
    const path = "/v1/savia-flows/tenant:101/api-keys?tenant=tenant%3A101";
    const memberResponse = await appFor(agencyMemberAuthenticator(), {
      service: { fetch: fetcher },
    }).request(path);
    const adminResponse = await appFor(agencyAdministratorAuthenticator(), {
      service: { fetch: fetcher },
    }).request(path);
    expect(memberResponse.status).toBe(403);
    expect(adminResponse.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("forwards a short-lived signed context and strips client credentials and identity headers", async () => {
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.url).toBe(
        "https://savia-flows.internal/tenant:101/workflows?tenant=tenant%3A101",
      );
      expect(request.headers.get("authorization")).toBeNull();
      expect(request.headers.get("cookie")).toBeNull();
      expect(request.headers.get("x-savia-tenant")).toBeNull();
      expect(request.headers.get("x-savia-flows-context")).toBeTruthy();
      const token = request.headers.get("x-savia-flows-context")!;
      const { payload, protectedHeader } = await jwtVerify(
        token,
        new TextEncoder().encode(bridgeSecret),
        { issuer: "savia", audience: "savia-flows" },
      );
      expect(protectedHeader.alg).toBe("HS256");
      expect(payload.sub).toBe("test-agency-member");
      expect(payload.organization).toMatchObject({
        id: tenant,
        role: "viewer",
      });
      expect(payload.platformAdmin).toBe(false);
      expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(60);
      return Response.json({ ok: true });
    });
    const response = await appFor(agencyMemberAuthenticator(), {
      service: { fetch: fetcher },
    }).request("/v1/savia-flows/tenant:101/workflows?tenant=tenant%3A101", {
      headers: {
        authorization: "Bearer user-token",
        cookie: "savia_session=secret",
        "x-savia-tenant": "tenant:999",
        "x-savia-flows-context": "attacker-token",
        "x-savia-actor": "attacker",
      },
    });

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects a mismatched organization, malformed tenant and unscoped non-admin", async () => {
    const fetcher = vi.fn(() => Response.json({ ok: true }));
    const app = appFor(agencyAdministratorAuthenticator(), {
      service: { fetch: fetcher },
    });
    expect(
      (
        await app.request(
          "/v1/savia-flows/tenant:999/workflows?tenant=tenant%3A101",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(
          "/v1/savia-flows/tenant:101/workflows?tenant=agency%3A101",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await appFor(agencyMemberAuthenticator(), {
          service: { fetch: fetcher },
        }).request("/v1/savia-flows/templates")
      ).status,
    ).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("blocks personal API keys until Savia Flows scopes are defined", async () => {
    const auth: Authenticator = {
      authenticate: async () => ({
        principal: {
          id: "key-principal",
          issuer: "savia:better-auth",
          subject: "key-principal",
          email: "key@savia.test",
          displayName: "API Key",
          isActive: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        globalRoles: [],
        memberships: [
          {
            id: "m1",
            principalId: "key-principal",
            agencyId: 101,
            role: "tenant_admin",
            isActive: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        credential: {
          kind: "personal-api-key",
          keyId: "k1",
          tenantId: 101,
          scopes: ["savia.api.read"],
        },
      }),
    };
    const fetcher = vi.fn(() => Response.json({ ok: true }));
    const response = await appFor(auth, {
      service: { fetch: fetcher },
    }).request("/v1/savia-flows/tenant:101/workflows?tenant=tenant%3A101");
    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("maps user and organization reads from the authorized host actor", async () => {
    const fetcher = vi.fn(() => Response.json({ unexpected: true }));
    const app = appFor(agencyAdministratorAuthenticator(), {
      service: { fetch: fetcher },
    });
    const user = await app.request(
      "/v1/savia-flows/auth/user?tenant=tenant%3A101",
    );
    const organizations = await app.request(
      "/v1/savia-flows/organizations?tenant=tenant%3A101",
    );
    expect(await user.json()).toMatchObject({
      user: {
        sub: "test-agency-administrator",
        email: "administrator@savia.test",
        organization: { id: tenant, role: "admin" },
      },
    });
    expect(await organizations.json()).toEqual({
      organizations: [{ id: tenant, name: "", role: "admin" }],
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("includes the selected platform workspace for an administrator without a membership", async () => {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO tenants(id,id_slug,name,is_active,kind,created_at,updated_at) VALUES(0,'platform','Platform',1,'platform','2026-01-01','2026-01-01')",
    ).run();
    const platform = await env.DB.prepare(
      "SELECT name FROM tenants WHERE id=0",
    ).first<{ name: string }>();
    expect(platform).not.toBeNull();
    const fetcher = vi.fn(() => Response.json({ unexpected: true }));
    const app = appFor(platformAdministratorAuthenticator(), {
      service: { fetch: fetcher },
    });
    const user = await app.request(
      "/v1/savia-flows/auth/user?tenant=tenant%3A0",
    );
    const organizations = await app.request(
      "/v1/savia-flows/organizations?tenant=tenant%3A0",
    );
    expect(user.status).toBe(200);
    expect(await user.json()).toMatchObject({
      user: {
        sub: "test-platform-admin",
        platformAdmin: true,
        organization: { id: "tenant:0", name: platform!.name, role: "admin" },
      },
    });
    expect(organizations.status).toBe(200);
    expect(await organizations.json()).toEqual({
      organizations: [{ id: "tenant:0", name: platform!.name, role: "admin" }],
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("preserves streamed content, status and headers from the private service", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('data: {"ready":true}\n\n'),
        );
        controller.close();
      },
    });
    const response = await appFor(agencyMemberAuthenticator(), {
      service: {
        fetch: () =>
          new Response(body, {
            status: 202,
            headers: {
              "content-type": "text/event-stream",
              "x-flow-version": "3",
            },
          }),
      },
    }).request(
      "/v1/savia-flows/tenant:101/executions/stream?tenant=tenant%3A101",
    );
    expect(response.status).toBe(202);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("x-flow-version")).toBe("3");
    expect(await response.text()).toBe('data: {"ready":true}\n\n');
  });

  it("does not forward upstream auth or organization administration routes", async () => {
    const fetcher = vi.fn(() => Response.json({ ok: true }));
    const app = appFor(agencyAdministratorAuthenticator(), {
      service: { fetch: fetcher },
    });
    for (const path of [
      "/auth/login",
      "/tenant:101/billing",
      "/tenant:101/organizations",
    ]) {
      expect(
        (
          await app.request(`/v1/savia-flows${path}?tenant=tenant%3A101`, {
            method: "GET",
          })
        ).status,
        path,
      ).toBe(404);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("allows a platform administrator to use the explicit unscoped catalog", async () => {
    const fetcher = vi.fn((request: Request) => {
      expect(request.headers.get("x-savia-flows-context")).toBeTruthy();
      return Response.json([{ id: "template-1" }]);
    });
    const response = await appFor(platformAdministratorAuthenticator(), {
      service: { fetch: fetcher },
    }).request("/v1/savia-flows/templates");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: "template-1" }]);
  });

  it("issues a one-use path-bound socket URL without exposing the private bridge JWT", async () => {
    await seedWebSocketMembership();
    const fetcher = vi.fn((request: Request) => {
      expect(request.url).toBe(
        "https://savia-flows.internal/tenant:101/ws/workflow-1",
      );
      expect(request.headers.get("x-savia-flows-context")).toBeTruthy();
      expect(request.headers.get("authorization")).toBeNull();
      return Response.json({ forwarded: true });
    });
    const app = appFor(agencyAdministratorAuthenticator(), {
      service: { fetch: fetcher },
    });
    const issue = await app.request(
      "/v1/savia-flows/ws-ticket?tenant=tenant%3A101",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: "/tenant:101/ws/workflow-1" }),
      },
    );
    expect(issue.status).toBe(201);
    const { url } = await issue.json<{ url: string }>();
    const socketUrl = new URL(url);
    expect(socketUrl.protocol).toBe("ws:");
    expect(socketUrl.pathname).toBe("/api/public/savia-flows/ws");
    expect(socketUrl.searchParams.has("ticket")).toBe(true);
    expect(socketUrl.searchParams.get("tenant")).toBeNull();

    const first = await app.request(url.replace("ws://", "http://"), {
      headers: { upgrade: "websocket" },
    });
    const replay = await app.request(url.replace("ws://", "http://"), {
      headers: { upgrade: "websocket" },
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ forwarded: true });
    expect(replay.status).toBe(401);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects socket paths for another tenant and only issues editor tickets to tenant admins", async () => {
    const fetcher = vi.fn(() => Response.json({ ok: true }));
    const adminApp = appFor(agencyAdministratorAuthenticator(), {
      service: { fetch: fetcher },
    });
    const crossOrigin = await adminApp.request(
      "/v1/savia-flows/ws-ticket?tenant=tenant%3A101",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
        },
        body: JSON.stringify({ path: "/tenant:101/ws/workflow-1" }),
      },
    );
    const mismatched = await adminApp.request(
      "/v1/savia-flows/ws-ticket?tenant=tenant%3A101",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: "/tenant:999/ws/workflow-1" }),
      },
    );
    const member = await appFor(agencyMemberAuthenticator(), {
      service: { fetch: fetcher },
    }).request("/v1/savia-flows/ws-ticket?tenant=tenant%3A101", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "/tenant:101/ws/workflow-1" }),
    });
    expect(mismatched.status).toBe(400);
    expect(member.status).toBe(403);
    expect(crossOrigin.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects socket tickets after the host membership is revoked", async () => {
    await seedWebSocketMembership();
    const fetcher = vi.fn(() => Response.json({ ok: true }));
    const app = appFor(agencyAdministratorAuthenticator(), {
      service: { fetch: fetcher },
    });
    const issue = await app.request(
      "/v1/savia-flows/ws-ticket?tenant=tenant%3A101",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: "/tenant:101/generate/workflow-2" }),
      },
    );
    const { url } = await issue.json<{ url: string }>();
    await env.DB.prepare(
      "UPDATE identity_tenant_membership SET is_active=0 WHERE principal_id='test-agency-administrator' AND tenant_id=101",
    ).run();
    const response = await app.request(url.replace("ws://", "http://"), {
      headers: { upgrade: "websocket" },
    });
    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects forged and expired websocket JWTs", async () => {
    const app = appFor(agencyAdministratorAuthenticator(), {
      service: { fetch: () => Response.json({ ok: true }) },
    });
    const invalid = await app.request(
      "/api/public/savia-flows/ws?ticket=not-a-jwt",
      { headers: { upgrade: "websocket" } },
    );
    const expired = await new SignJWT({
      sub: "test-agency-administrator",
      name: "Test Admin",
      organization: {
        id: tenant,
        name: "Flows test tenant",
        role: "tenant_admin",
      },
      platformAdmin: false,
      tenant,
      path: "/tenant:101/ws/workflow-1",
      jti: "expired-flows-ticket",
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("savia")
      .setAudience("savia-flows-websocket")
      .setSubject("test-agency-administrator")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 60)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 30)
      .sign(new TextEncoder().encode(bridgeSecret));
    const expiredResponse = await app.request(
      `/api/public/savia-flows/ws?ticket=${encodeURIComponent(expired)}`,
      { headers: { upgrade: "websocket" } },
    );
    const wrongPath = await new SignJWT({
      sub: "test-agency-administrator",
      name: "Test Admin",
      organization: {
        id: tenant,
        name: "Flows test tenant",
        role: "tenant_admin",
      },
      platformAdmin: false,
      tenant,
      path: "/tenant:999/ws/workflow-1",
      jti: "wrong-path-flows-ticket",
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("savia")
      .setAudience("savia-flows-websocket")
      .setSubject("test-agency-administrator")
      .setIssuedAt(Math.floor(Date.now() / 1000))
      .setExpirationTime(Math.floor(Date.now() / 1000) + 30)
      .sign(new TextEncoder().encode(bridgeSecret));
    const wrongPathResponse = await app.request(
      `/api/public/savia-flows/ws?ticket=${encodeURIComponent(wrongPath)}`,
      { headers: { upgrade: "websocket" } },
    );
    expect(invalid.status).toBe(401);
    expect(expiredResponse.status).toBe(401);
    expect(wrongPathResponse.status).toBe(401);
  });
});
