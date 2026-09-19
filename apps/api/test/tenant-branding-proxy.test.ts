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
