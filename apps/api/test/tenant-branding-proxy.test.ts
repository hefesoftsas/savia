import { env } from "cloudflare:workers";
import { beforeAll, expect, it, vi } from "vitest";
import { createTestApp } from "./test-app";

it("removes caller supplied branding before proxying authentication", async () => {
  const fetch = vi.fn(async (request: Request) =>
    Response.json({ branding: request.headers.get("x-savia-tenant-branding") }),
  );
  const app = createTestApp({ authService: { fetch } });
  const response = await app.request(
    "https://savia.app.hefesoft.com/api/auth/login",
    { headers: { "x-savia-tenant-branding": "spoofed" } },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ branding: null });
  expect(fetch).toHaveBeenCalledOnce();
});

it.each([
  ["POST", "sign-in/social"],
  ["GET", "savia-social/providers"],
])(
  "binds %s %s to a resolved tenant and strips spoofed canonical context",
  async (method, path) => {
    const fetch = vi.fn(async (request: Request) =>
      Response.json({
        tenantId: request.headers.get("x-savia-social-tenant-id"),
        key: request.headers.get("x-savia-bridge-key"),
      }),
    );
    const app = createTestApp({
      authService: { fetch },
      identityBridgeKey: "trusted-bridge-key",
    });
    const init = {
      method,
      headers: {
        "content-type": "application/json",
        "x-savia-social-tenant-id": "999",
        "x-savia-bridge-key": "spoofed",
      },
      ...(method === "POST"
        ? { body: JSON.stringify({ provider: "google" }) }
        : {}),
    };
    const canonical = await app.request(
      `https://savia.app.hefesoft.com/api/auth/${path}`,
      init,
    );
    expect(await canonical.json()).toEqual({ tenantId: null, key: null });
    const tenant = await app.request(
      `https://branding-preview.savia.app.hefesoft.com/api/auth/${path}`,
      init,
    );
    expect(await tenant.json()).toEqual({
      tenantId: "919191",
      key: "trusted-bridge-key",
    });
  },
);

it("adds tenant email context only to tenant recovery HTML and strips caller bridge headers", async () => {
  const fetch = vi.fn(async (request: Request) =>
    Response.json({
      bridgeKey: request.headers.get("x-savia-bridge-key"),
      tenantId: request.headers.get("x-savia-tenant-email-id"),
    }),
  );
  const app = createTestApp({
    authService: { fetch },
    identityBridgeKey: "trusted-bridge-key",
  });
  const recovery = await app.request(
    "https://branding-preview.savia.app.hefesoft.com/api/auth/forgot-password",
    {
      headers: {
        "x-savia-bridge-key": "caller-key",
        "x-savia-tenant-email-id": "999999",
      },
    },
  );
  expect(await recovery.json()).toEqual({
    bridgeKey: "trusted-bridge-key",
    tenantId: "919191",
  });

  const apiCall = await app.request(
    "https://branding-preview.savia.app.hefesoft.com/api/auth/sign-in/email",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-savia-bridge-key": "caller-key",
        "x-savia-tenant-email-id": "919191",
      },
      body: JSON.stringify({ email: "user@example.test", password: "pw" }),
    },
  );
  expect(apiCall.status).toBe(200);
  expect(await apiCall.json()).toEqual({ bridgeKey: null, tenantId: null });
});

beforeAll(async () => {
  const migrations = Object.entries(
    import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
      eager: true,
      import: "default",
      query: "?raw",
    }),
  ).sort(([a], [b]) => a.localeCompare(b));
  for (const [, sql] of migrations)
    for (const statement of sql
      .split("--> statement-breakpoint")
      .map((s) =>
        s
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean))
      await env.DB.exec(statement);
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,kind,is_active,created_at,updated_at) VALUES(919191,'branding-preview','Agencia Ñ','commercial',1,?,?)",
  )
    .bind(new Date().toISOString(), new Date().toISOString())
    .run();
});
it("renders server-owned branding on dedicated and canonical OAuth pages", async () => {
  const fetch = vi.fn(async (request: Request) =>
    Response.json({
      branding: JSON.parse(
        decodeURIComponent(
          request.headers.get("x-savia-tenant-branding") ?? "null",
        ),
      ),
    }),
  );
  const app = createTestApp({ authService: { fetch } });
  for (const [url, headers] of [
    [
      "https://branding-preview.savia.app.hefesoft.com/api/auth/login",
      { "x-savia-tenant-branding": "spoofed" },
    ],
    [
      "https://savia.app.hefesoft.com/api/auth/login",
      {
        cookie:
          "savia.return_origin=https%3A%2F%2Fbranding-preview.savia.app.hefesoft.com",
      },
    ],
    [
      "https://savia.app.hefesoft.com/api/auth/oauth-ui.css",
      {
        cookie:
          "savia.return_origin=https%3A%2F%2Fbranding-preview.savia.app.hefesoft.com",
      },
    ],
  ] as const) {
    const response = await app.request(url, { headers });
    expect(response.status).toBe(200);
    expect(((await response.json()) as any).branding.displayName).toBe(
      "Agencia Ñ",
    );
  }
});
it.each([
  ["GET", "sso-complete"],
  ["GET", "email-verified"],
  ["GET", "chatgpt-email-verification"],
  ["GET", "chatgpt-email-verification/verify"],
  ["POST", "chatgpt-email-verification/send"],
  ["POST", "microsoft-email-verification/send"],
])("preserves tenant identity on %s %s", async (method, path) => {
  const fetch = vi.fn(async (request: Request) =>
    Response.json({
      branding: JSON.parse(
        decodeURIComponent(
          request.headers.get("x-savia-tenant-branding") ?? "null",
        ),
      ),
    }),
  );
  const app = createTestApp({ authService: { fetch } });
  for (const hostname of [
    "branding-preview.savia.app.hefesoft.com",
    "savia.app.hefesoft.com",
  ]) {
    const response = await app.request(`https://${hostname}/api/auth/${path}`, {
      method,
      headers: {
        "x-savia-tenant-branding": "spoofed",
        cookie:
          "savia.return_origin=https%3A%2F%2Fbranding-preview.savia.app.hefesoft.com",
      },
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as any).branding?.displayName).toBe(
      "Agencia Ñ",
    );
  }
});

it("ignores an external OAuth return origin for branding", async () => {
  const fetch = vi.fn(async (request: Request) =>
    Response.json({ branding: request.headers.get("x-savia-tenant-branding") }),
  );
  const app = createTestApp({ authService: { fetch } });
  const response = await app.request(
    "https://savia.app.hefesoft.com/api/auth/login",
    {
      headers: { cookie: "savia.return_origin=https%3A%2F%2Fattacker.example" },
    },
  );
  expect(await response.json()).toEqual({ branding: null });
});
