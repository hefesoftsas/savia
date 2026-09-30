import { env } from "cloudflare:workers";
import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeAll, expect, it } from "vitest";
import { authenticationMiddleware } from "../src/auth/middleware";
import { platformAdministratorAuthenticator } from "./auth-fixtures";
import { registerTenantRegistrationSettingsRoutes } from "../src/tenant-registration/settings-routes";
const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, sql]) => sql);
beforeAll(async () => {
  for (const sql of migrations)
    for (const part of sql
      .split("--> statement-breakpoint")
      .map((s) =>
        s
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean))
      await env.DB.exec(part);
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at) VALUES(731004,'registration-settings','Registration',1,'now','now')",
  ).run();
});
const safe = {
  allowEmailRegistration: false,
  captchaMode: "inherit",
  siteKey: "",
  secretConfigured: false,
  emailReady: true,
  revision: "rev",
};
function appFor(allowed = true) {
  const app = new OpenAPIHono();
  app.use(
    "/v1/*",
    authenticationMiddleware(env.DB, {
      async authenticate(req, db) {
        const actor = await platformAdministratorAuthenticator().authenticate(
          req,
          db,
        );
        return allowed ? actor : { ...actor, globalRoles: [], memberships: [] };
      },
    }),
  );
  registerTenantRegistrationSettingsRoutes(
    app,
    env.DB,
    {
      async fetch(req) {
        if (req.method === "PUT") {
          const body = (await req.json()) as Record<string, unknown>;
          return Response.json({
            ...safe,
            ...body,
            secretKey: "should-never-leak",
          });
        }
        return Response.json(safe);
      },
    },
    "bridge",
    {
      captchaProvider: "altcha",
      altchaSecret: "a".repeat(32),
      publicOrigin: "https://api.test",
      rateLimiter: { limit: async () => ({ success: true }) },
    },
  );
  return app;
}
const path = "https://api.test/v1/tenants/731004/registration-settings";
it("returns safe effective Docker readiness with registration off", async () => {
  const res = await appFor().request(path);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    allowEmailRegistration: false,
    captchaProvider: "altcha",
    captchaReady: true,
    registrationReady: false,
  });
});
it("rejects_cross_tenant_admin and client readiness spoofing", async () => {
  expect((await appFor(false).request(path)).status).toBe(403);
  const res = await appFor().request(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      allowEmailRegistration: true,
      captchaMode: "inherit",
      captchaReady: true,
    }),
  });
  expect(res.status).toBe(400);
});
it("strips hidden secrets and cannot enable missing deployment credentials", async () => {
  const res = await appFor().request(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      allowEmailRegistration: true,
      captchaMode: "inherit",
    }),
  });
  expect(res.status).toBe(200);
  expect(await res.text()).not.toContain("should-never-leak");
  const app = new OpenAPIHono();
  app.use(
    "/v1/*",
    authenticationMiddleware(env.DB, platformAdministratorAuthenticator()),
  );
  registerTenantRegistrationSettingsRoutes(
    app,
    env.DB,
    { fetch: async () => Response.json(safe) },
    "bridge",
  );
  expect(
    (
      await app.request(path, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          allowEmailRegistration: true,
          captchaMode: "inherit",
        }),
      })
    ).status,
  ).toBe(400);
});
