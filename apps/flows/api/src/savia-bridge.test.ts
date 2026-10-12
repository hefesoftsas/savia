import { Hono } from "hono";
import { SignJWT } from "jose";
import { applyD1Migrations, env as workerEnv } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { ApiContext } from "./context";
import { jwtMiddleware } from "./auth";
import { registerLocalScheduledRoute } from "./local-scheduled-route";
import { saviaBridgeMiddleware } from "./savia-bridge";

const secret = "savia-flows-test-bridge-secret-32-bytes-minimum";
const now = Math.floor(Date.now() / 1000);
const testEnv = workerEnv as unknown as {
  DB: D1Database;
  SAVIA_FLOWS_BRIDGE_SECRET: string;
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
};

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

async function bridgeToken(
  overrides: Record<string, unknown> = {},
  signingSecret = secret,
) {
  return new SignJWT({
    name: "Host User",
    email: "host@savia.test",
    organization: {
      id: "tenant:101",
      name: "Tenant 101",
      role: "tenant_admin",
    },
    platformAdmin: false,
    ...overrides,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("savia")
    .setAudience("savia-flows")
    .setSubject("host-principal")
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .sign(new TextEncoder().encode(signingSecret));
}

function appFor() {
  const app = new Hono<ApiContext>();
  app.use("*", saviaBridgeMiddleware);
  app.get("/tenant:101/workflows", jwtMiddleware, (c) =>
    c.json({
      user: c.get("jwtPayload"),
      organizationId: c.get("organizationId"),
      bridgeContextHeader: c.req.header("x-savia-flows-context") ?? null,
    }),
  );
  app.get("/tenant:999/workflows", jwtMiddleware, (c) => c.json({ ok: true }));
  app.get("/auth/login", (c) => c.json({ login: true }));
  app.get("/organizations", (c) => c.json({ organizations: [] }));
  app.get("/oauth/github/connect", (c) => c.json({ connected: true }));
  app.get("/tenant:101/integrations/providers", (c) =>
    c.json({ providers: ["github"] }),
  );
  app.post("/http", (c) => c.json({ public: true }));
  return app;
}

const env = {
  ...testEnv,
  SAVIA_FLOWS_BRIDGE_SECRET: secret,
  SAVIA_FLOWS_LOCAL_ONLY: "true",
  JWT_SECRET: "unused-cookie-secret-with-at-least-32-chars",
} as unknown as ApiContext["Bindings"];

describe("Savia host identity bridge", () => {
  it("lets only a signed host context bypass upstream cookie auth", async () => {
    const token = await bridgeToken();
    const response = await appFor().request(
      "/tenant:101/workflows",
      { headers: { "x-savia-flows-context": token } },
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      organizationId: "tenant:101",
      bridgeContextHeader: null,
      user: {
        sub: "host-principal",
        email: "host@savia.test",
        provider: "savia",
        role: "admin",
        organization: { id: "tenant:101", role: "admin" },
      },
    });
    const mirrored = await testEnv.DB.prepare(
      "SELECT o.compute_credits,u.role user_role,m.role membership_role FROM organizations o JOIN users u ON u.organization_id=o.id JOIN memberships m ON m.organization_id=o.id AND m.user_id=u.id WHERE o.id='tenant:101' AND u.id='host-principal'",
    ).first<{
      compute_credits: number;
      user_role: string;
      membership_role: string;
    }>();
    expect(mirrored).toEqual({
      compute_credits: 0,
      user_role: "user",
      membership_role: "admin",
    });

    const viewerToken = await bridgeToken({
      organization: { id: "tenant:101", name: "Tenant 101", role: "viewer" },
    });
    await appFor().request(
      "/tenant:101/workflows",
      { headers: { "x-savia-flows-context": viewerToken } },
      env,
    );
    const refreshed = await testEnv.DB.prepare(
      "SELECT role FROM memberships WHERE user_id='host-principal' AND organization_id='tenant:101'",
    ).first<{ role: string }>();
    expect(refreshed?.role).toBe("member");
  });

  it("rejects absent, forged, and expired host contexts", async () => {
    const app = appFor();
    const absent = await app.request("/tenant:101/workflows", {}, env);
    const login = await app.request("/auth/login", {}, env);
    const organizations = await app.request("/organizations", {}, env);
    const publicTrigger = await app.request("/http", { method: "POST" }, env);
    const forged = await app.request(
      "/tenant:101/workflows",
      {
        headers: {
          "x-savia-flows-context": await bridgeToken(
            {},
            "wrong-secret-which-is-long-enough-32",
          ),
        },
      },
      env,
    );
    const expired = await new SignJWT({
      name: "Host User",
      organization: {
        id: "tenant:101",
        name: "Tenant 101",
        role: "tenant_admin",
      },
      platformAdmin: false,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("savia")
      .setAudience("savia-flows")
      .setSubject("host-principal")
      .setIssuedAt(now - 120)
      .setExpirationTime(now - 60)
      .sign(new TextEncoder().encode(secret));
    const expiredResponse = await app.request(
      "/tenant:101/workflows",
      { headers: { "x-savia-flows-context": expired } },
      env,
    );
    expect(absent.status).toBe(401);
    expect(login.status).toBe(401);
    expect(organizations.status).toBe(401);
    expect(publicTrigger.status).toBe(200);
    expect(forged.status).toBe(401);
    expect(expiredResponse.status).toBe(401);
  });

  it("rejects a signed host context for a different tenant URL", async () => {
    const app = appFor();
    const response = await app.request(
      "/tenant:999/workflows",
      { headers: { "x-savia-flows-context": await bridgeToken() } },
      env,
    );
    expect(response.status).toBe(403);
  });

  it("disables OAuth activation and hides external integration providers", async () => {
    const app = appFor();
    const token = await bridgeToken();
    const headers = { "x-savia-flows-context": token };
    const oauth = await app.request("/oauth/github/connect", { headers }, env);
    const providers = await app.request(
      "/tenant:101/integrations/providers",
      { headers },
      env,
    );
    expect(oauth.status).toBe(503);
    expect(await oauth.json()).toMatchObject({
      error: { code: "EXTERNAL_SERVICES_DISABLED" },
    });
    expect(await providers.json()).toEqual({ providers: [] });
  });

  it("keeps the local scheduler private and platform-admin-only", async () => {
    const app = new Hono<ApiContext>();
    app.use("*", saviaBridgeMiddleware);
    registerLocalScheduledRoute(app);
    const absent = await app.request(
      "/_local/scheduled",
      { method: "POST" },
      env,
    );
    const tenantAdmin = await app.request(
      "/_local/scheduled",
      {
        method: "POST",
        headers: { "x-savia-flows-context": await bridgeToken() },
      },
      env,
    );
    const notLocal = await app.request(
      "/_local/scheduled",
      {
        method: "POST",
        headers: {
          "x-savia-flows-context": await bridgeToken({
            organization: null,
            platformAdmin: true,
          }),
        },
      },
      { ...env, SAVIA_FLOWS_LOCAL_ONLY: "false" },
    );
    expect(absent.status).toBe(401);
    expect(tenantAdmin.status).toBe(403);
    expect(notLocal.status).toBe(404);
  });
});
