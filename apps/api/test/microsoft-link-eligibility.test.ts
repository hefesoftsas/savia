import { env } from "cloudflare:workers";
import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeAll, expect, it } from "vitest";
import { registerSocialRegistrationRoutes } from "../src/tenant-social/registration";
const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, s]) => s);
beforeAll(async () => {
  for (const sql of migrations)
    for (const s of sql
      .split("--> statement-breakpoint")
      .map((s) =>
        s
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean))
      await env.DB.exec(s);
  await env.DB.exec(
    "INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at) VALUES(743004,'ms-link','Microsoft link',1,'now','now')",
  );
  await env.DB.exec(
    "INSERT INTO identity_principal(id,issuer,subject,email,display_name,is_active,created_at,updated_at) VALUES('ms-existing','savia:better-auth','existing-subject','member@example.test','Member',1,'now','now')",
  );
  await env.DB.exec(
    "INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at) VALUES('ms-membership','ms-existing',743004,'viewer',1,'now','now')",
  );
});
function request(body: unknown, key = "bridge") {
  const app = new OpenAPIHono();
  registerSocialRegistrationRoutes(
    app,
    env.DB,
    {
      fetch: async () =>
        Response.json({
          active: true,
          microsoftEnabled: true,
          allowMicrosoftPersonalAccounts: true,
          allowRegistration: false,
          revision: "current",
        }),
    },
    "bridge",
  );
  return app.request(
    "https://api.test/_internal/social-registration/eligible",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-savia-bridge-key": key,
      },
      body: JSON.stringify(body),
    },
  );
}
const body = {
  attemptId: "d0463d28-778b-4071-8ef7-2db8089b5802",
  tenantId: 743004,
  subject: "existing-subject",
  email: "member@example.test",
  displayName: "Member",
  provider: "microsoft",
  revision: "current",
};
it("allows precreated members with both registrations off, without provisioning", async () => {
  expect((await request(body)).status).toBe(200);
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM identity_principal WHERE subject='existing-subject'",
    ).first(),
  ).toEqual({ count: 1 });
});
it("denies missing members, foreign identities, stale policy, and unauthorized bridges", async () => {
  for (const override of [
    { subject: "new-subject" },
    { email: "other@example.test" },
    { revision: "stale" },
    { tenantId: 743005 },
  ])
    expect((await request({ ...body, ...override })).status).toBe(403);
  expect((await request(body, "wrong")).status).toBe(401);
});
it("denies platform administrators even with tenant membership", async () => {
  await env.DB.exec(
    "INSERT INTO identity_global_role(principal_id,role,created_at) VALUES('ms-existing','platform_admin','now')",
  );
  expect((await request(body)).status).toBe(403);
});
