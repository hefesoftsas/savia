import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";

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

const adminClient = {
  clientId: "savia-admin-client",
  redirectUri: "http://127.0.0.1:5173/auth/callback",
  resource: "http://127.0.0.1:8787",
  scopes: ["openid", "profile", "email", "savia.api.read", "savia.api.write"],
};

describe("admin OAuth bridge", () => {
  beforeAll(applyMigrations);
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM admin_oauth_transactions");
  });

  it("rotates an HttpOnly refresh cookie for the admin OAuth session", async () => {
    const authFetch = vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname === "/_internal/oauth/admin-client") {
        return Response.json(adminClient);
      }
      if (url.pathname === "/api/auth/oauth2/authorize") {
        return Response.json({
          redirect: true,
          url: `/api/auth/login?${url.searchParams.toString()}`,
        });
      }
      if (url.pathname === "/api/auth/oauth2/token") {
        expect(request.method).toBe("POST");
        expect(request.headers.get("content-type")).toContain(
          "application/x-www-form-urlencoded",
        );
        const input = await request.formData();
        expect(input.get("client_id")).toBe(adminClient.clientId);
        if (input.get("grant_type") === "authorization_code") {
          expect(input.get("code")).toBe("authorization-code");
          expect(input.get("redirect_uri")).toBe(adminClient.redirectUri);
          expect(input.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
          expect(input.get("resource")).toBe(adminClient.resource);
          return Response.json({
            access_token: "access-token",
            refresh_token: "refresh-token",
            token_type: "Bearer",
            expires_in: 300,
            scope: "openid savia.api.read savia.api.write",
          });
        }
        expect(input.get("grant_type")).toBe("refresh_token");
        expect(input.get("refresh_token")).toBe("refresh-token");
        expect(input.get("resource")).toBe(adminClient.resource);
        return Response.json({
          access_token: "renewed-access-token",
          refresh_token: "rotated-refresh-token",
          token_type: "Bearer",
          expires_in: 300,
          scope: "openid savia.api.read savia.api.write",
        });
      }
      if (url.pathname === "/api/auth/sign-out") {
        expect(request.method).toBe("POST");
        expect(request.headers.get("cookie")).toContain(
          "savia.session_token=provider-session",
        );
        expect(request.headers.get("origin")).toBe("http://127.0.0.1:5173");
        expect(request.headers.get("content-type")).toContain(
          "application/json",
        );
        expect(await request.json()).toEqual({});
        return Response.json({ success: true });
      }
      return new Response("Not found", { status: 404 });
    });
    const app = createApp(
      env.DB,
      env.DOCUMENTS,
      undefined,
      undefined,
      undefined,
      undefined,
      { fetch: authFetch },
    );

    const authorization = await app.request(
      "http://127.0.0.1:8787/api/auth/admin/authorize",
    );

    expect(authorization.status).toBe(302);
    expect(authorization.headers.get("cache-control")).toBe("no-store");
    const location = new URL(authorization.headers.get("location") ?? "");
    expect(location.pathname).toBe("/api/auth/login");
    expect(location.searchParams.get("client_id")).toBe(adminClient.clientId);
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("redirect_uri")).toBe(
      adminClient.redirectUri,
    );
    expect(location.searchParams.get("resource")).toBe(adminClient.resource);
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(location.searchParams.get("scope")).toBe(
      adminClient.scopes.join(" "),
    );
    const state = location.searchParams.get("state");
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(location.searchParams.get("code_challenge")).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );

    const callback = await app.request(
      "http://127.0.0.1:8787/api/auth/admin/callback",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://127.0.0.1:5173",
        },
        body: JSON.stringify({ code: "authorization-code", state }),
      },
    );

    expect(callback.status).toBe(200);
    expect(callback.headers.get("access-control-allow-origin")).toBe(
      "http://127.0.0.1:5173",
    );
    expect(callback.headers.get("cache-control")).toBe("no-store");
    expect(await callback.json()).toEqual({
      access_token: "access-token",
      token_type: "Bearer",
      expires_in: 300,
      scope: "openid savia.api.read savia.api.write",
    });
    const refreshCookie = callback.headers.get("set-cookie");
    expect(refreshCookie).toContain("savia.admin_refresh_token=refresh-token");
    expect(refreshCookie).toContain("HttpOnly");
    expect(refreshCookie).toContain("SameSite=Lax");
    expect(refreshCookie).toContain("Path=/api/auth/admin");

    const refresh = await app.request(
      "http://127.0.0.1:8787/api/auth/admin/refresh",
      {
        method: "POST",
        headers: {
          cookie: "savia.admin_refresh_token=refresh-token",
          origin: "http://127.0.0.1:5173",
        },
      },
    );

    expect(refresh.status).toBe(200);
    expect(refresh.headers.get("access-control-allow-origin")).toBe(
      "http://127.0.0.1:5173",
    );
    expect(await refresh.json()).toEqual({
      access_token: "renewed-access-token",
      token_type: "Bearer",
      expires_in: 300,
      scope: "openid savia.api.read savia.api.write",
    });
    expect(refresh.headers.get("set-cookie")).toContain(
      "savia.admin_refresh_token=rotated-refresh-token",
    );

    const logout = await app.request(
      "http://127.0.0.1:8787/api/auth/admin/logout",
      {
        method: "POST",
        headers: {
          cookie:
            "savia.session_token=provider-session; savia.admin_refresh_token=refresh-token",
          origin: "http://127.0.0.1:5173",
        },
      },
    );

    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie")).toContain(
      "savia.admin_refresh_token=",
    );
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(logout.headers.get("set-cookie")).toContain("savia.session_token=");
    expect(logout.headers.get("set-cookie")).toContain("savia.session_data=");
    expect(logout.headers.get("set-cookie")).toContain("savia.dont_remember=");
    expect(logout.headers.get("set-cookie")).toContain("savia_two_factor=");

    const replay = await app.request(
      "http://127.0.0.1:8787/api/auth/admin/callback",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "authorization-code", state }),
      },
    );
    expect(replay.status).toBe(400);
    expect(authFetch).toHaveBeenCalledTimes(9);
  });

  it("identifies a rejected authorization-code exchange without exposing the code", async () => {
    const authFetch = vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname;
      if (path === "/_internal/oauth/admin-client") {
        return Response.json(adminClient);
      }
      if (path === "/api/auth/oauth2/authorize") {
        return Response.json({
          redirect: true,
          url: `/api/auth/login?${new URL(request.url).searchParams.toString()}`,
        });
      }
      if (path === "/api/auth/oauth2/token") {
        return Response.json(
          {
            error: "invalid_request",
            error_description: "code verification failed",
          },
          { status: 400 },
        );
      }
      return new Response("Not found", { status: 404 });
    });
    const app = createApp(
      env.DB,
      env.DOCUMENTS,
      undefined,
      undefined,
      undefined,
      undefined,
      { fetch: authFetch },
    );

    const authorization = await app.request(
      "http://127.0.0.1:8787/api/auth/admin/authorize",
    );
    const state = new URL(
      authorization.headers.get("location") ?? "",
    ).searchParams.get("state");
    const callback = await app.request(
      "http://127.0.0.1:8787/api/auth/admin/callback",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "authorization-code", state }),
      },
    );

    expect(callback.status).toBe(401);
    await expect(callback.json()).resolves.toEqual({
      error: {
        code: "OAUTH_TOKEN_EXCHANGE_FAILED",
        message:
          "Better Auth rejected the authorization code (invalid_request)",
      },
    });
  });

  it("permits CORS and scopes cookies for allowed tenant subdomains", async () => {
    const authFetch = vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname === "/_internal/oauth/admin-client") {
        return Response.json(adminClient);
      }
      return new Response("Not found", { status: 404 });
    });
    const app = createApp(
      env.DB,
      env.DOCUMENTS,
      undefined,
      undefined,
      undefined,
      undefined,
      { fetch: authFetch },
    );

    // OPTIONS preflight from tenant subdomain
    const preflight = await app.request(
      "https://merkaseguros.savia.app.hefesoft.com/api/auth/admin/refresh",
      {
        method: "OPTIONS",
        headers: {
          origin: "https://merkaseguros.savia.app.hefesoft.com",
        },
      },
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(
      "https://merkaseguros.savia.app.hefesoft.com",
    );
    expect(preflight.headers.get("access-control-allow-credentials")).toBe(
      "true",
    );

    // OPTIONS preflight from untrusted origin
    const rejected = await app.request(
      "https://merkaseguros.savia.app.hefesoft.com/api/auth/admin/refresh",
      {
        method: "OPTIONS",
        headers: {
          origin: "https://evil.com",
        },
      },
    );
    expect(rejected.status).toBe(204);
    expect(rejected.headers.get("access-control-allow-origin")).toBeNull();

    // Refresh without token clears cookies with Domain=.savia.app.hefesoft.com
    const refresh = await app.request(
      "https://merkaseguros.savia.app.hefesoft.com/api/auth/admin/refresh",
      {
        method: "POST",
        headers: {
          origin: "https://merkaseguros.savia.app.hefesoft.com",
        },
      },
    );
    expect(refresh.status).toBe(401);
    const setCookie = refresh.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("Domain=.savia.app.hefesoft.com");
  });
});

