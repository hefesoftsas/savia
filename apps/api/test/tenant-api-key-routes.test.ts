import { env } from "cloudflare:workers";
import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeAll, describe, expect, it } from "vitest";
import { registerPersonalApiKeyRoutes } from "../src/auth/personal-api-key-routes";
import { PersonalApiKeys } from "../src/auth/personal-api-keys";
import {
  authenticationMiddleware,
  authenticationErrorResponse,
} from "../src/auth/middleware";
import {
  upsertPrincipal,
  grantMembership,
  loadActor,
  ensureBootstrapAdministrator,
} from "../src/auth/identity-repository";
import { seedTenantAgency } from "./tenant-fixtures";
import { AuthenticationError, type AppActor } from "../src/auth/types";
const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([a], [b]) => a.localeCompare(b));
beforeAll(async () => {
  for (const [, sql] of migrations)
    for (const part of sql.split("--> statement-breakpoint")) {
      const statement = part
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (statement) await env.DB.exec(statement);
    }
  await seedTenantAgency(env.DB, 801);
  await seedTenantAgency(env.DB, 802);
});
async function member(tenantId = 801, role = "viewer") {
  const principal = await upsertPrincipal(env.DB, {
    issuer: "savia:better-auth",
    subject: crypto.randomUUID(),
    email: `${crypto.randomUUID()}@test.example`,
    displayName: "Key owner",
  });
  await grantMembership(env.DB, principal.id, tenantId, role);
  return loadActor(env.DB, principal);
}
function app(actor: AppActor, deployment = "preview") {
  const app = new OpenAPIHono();
  // Match the API shell error handler; Hono consumes downstream exceptions.
  app.onError((error) => {
    if (error instanceof AuthenticationError)
      return authenticationErrorResponse(error);
    throw error;
  });
  app.use(
    "*",
    authenticationMiddleware(env.DB, {
      async authenticate() {
        return actor;
      },
    }),
  );
  registerPersonalApiKeyRoutes(
    app,
    new PersonalApiKeys(env.DB, deployment),
    "https://preview.example",
  );
  return app;
}
const base = "/v1/tenants/801/api-keys";
const input = (owner: AppActor) => ({
  principalId: owner.principal.id,
  name: "Companion laptop",
  scopes: ["recordings:read", "recordings:upload"],
  lifetimeDays: 30,
});
const post = (application: OpenAPIHono, owner: AppActor, path = base) =>
  application.request(path, {
    method: "POST",
    headers: {
      origin: "https://preview.example",
      "content-type": "application/json",
    },
    body: JSON.stringify(input(owner)),
  });
describe("tenant API key administration", () => {
  it("creates for a member, lists safe metadata, audits the administrator and revokes immediately", async () => {
    const admin = await member(801, "tenant_admin"),
      owner = await member();
    const application = app(admin),
      response = await post(application, owner);
    expect(response.status).toBe(201);
    const created = (await response.json()) as any;
    const repo = new PersonalApiKeys(env.DB, "preview");
    expect((await repo.authenticate(created.secret)).actor.principal.id).toBe(
      owner.principal.id,
    );
    const listed = await application.request(base);
    expect(listed.status).toBe(200);
    expect(listed.headers.get("cache-control")).toBe("no-store");
    const body = (await listed.json()) as any;
    expect(body.keys.find((k: any) => k.id === created.key.id)).toMatchObject({
      principalId: owner.principal.id,
      ownerName: owner.principal.displayName,
      ownerEmail: owner.principal.email,
      tenantId: 801,
    });
    expect(JSON.stringify(body)).not.toContain(created.secret);
    expect(JSON.stringify(body)).not.toContain("secret_digest");
    const revoked = await application.request(`${base}/${created.key.id}`, {
      method: "DELETE",
      headers: { origin: "https://preview.example" },
    });
    expect(revoked.status).toBe(204);
    await expect(repo.authenticate(created.secret)).rejects.toThrow();
    expect(
      (
        await application.request(`${base}/${created.key.id}`, {
          method: "DELETE",
          headers: { origin: "https://preview.example" },
        })
      ).status,
    ).toBe(204);
    const audits = await env.DB.prepare(
      "SELECT actor_id,action,after_state FROM access_audit WHERE target_id=? ORDER BY action",
    )
      .bind(created.key.id)
      .all<any>();
    expect(audits.results).toHaveLength(2);
    expect(
      audits.results.every((a: any) => a.actor_id === admin.principal.id),
    ).toBe(true);
    expect(JSON.stringify(audits)).not.toContain(created.secret);
  });
  it("denies members, foreign administrators, stale roles and API keys", async () => {
    const viewer = await member(),
      foreign = await member(802, "tenant_admin"),
      admin = await member(801, "tenant_admin");
    const keyActor = {
      ...admin,
      credential: {
        kind: "personal-api-key" as const,
        keyId: "key",
        tenantId: 801,
        scopes: ["recordings:read" as const],
      },
    };
    for (const actor of [viewer, foreign, keyActor]) {
      const application = app(actor);
      expect((await application.request(base)).status).toBe(403);
      expect((await application.request(`${base}/members`)).status).toBe(403);
      expect((await post(application, viewer)).status).toBe(403);
      expect(
        (
          await application.request(`${base}/${crypto.randomUUID()}`, {
            method: "DELETE",
            headers: { origin: "https://preview.example" },
          })
        ).status,
      ).toBe(403);
    }
    await env.DB.prepare(
      "UPDATE identity_tenant_membership SET role='viewer' WHERE principal_id=?",
    )
      .bind(admin.principal.id)
      .run();
    expect((await app(admin).request(base)).status).toBe(403);
  });
  it("isolates tenants and deployments, including revoke by known foreign id", async () => {
    const admin = await member(801, "tenant_admin"),
      owner = await member(),
      foreign = await member(802),
      repo = new PersonalApiKeys(env.DB, "preview");
    const foreignKey = await repo.create(foreign, {
      name: "Foreign",
      tenantId: 802,
      scopes: ["recordings:read"],
    });
    const oldKey = await new PersonalApiKeys(env.DB, "old").create(owner, {
      name: "Old deployment",
      tenantId: 801,
      scopes: ["recordings:read"],
    });
    const application = app(admin),
      body = (await (await application.request(base)).json()) as any;
    expect(
      body.keys.some((k: any) =>
        [foreignKey.key.id, oldKey.key.id].includes(k.id),
      ),
    ).toBe(false);
    for (const id of [foreignKey.key.id, oldKey.key.id])
      expect(
        (
          await application.request(`${base}/${id}`, {
            method: "DELETE",
            headers: { origin: "https://preview.example" },
          })
        ).status,
      ).toBe(204);
    expect((await repo.authenticate(foreignKey.secret)).key.id).toBe(
      foreignKey.key.id,
    );
    expect(
      (await new PersonalApiKeys(env.DB, "old").authenticate(oldKey.secret)).key
        .id,
    ).toBe(oldKey.key.id);
    expect((await post(application, foreign)).status).toBe(403);
    const eligible = (await (
      await application.request(`${base}/members`)
    ).json()) as any;
    expect(eligible.members.some((m: any) => m.id === owner.principal.id)).toBe(
      true,
    );
    expect(
      eligible.members.some((m: any) => m.id === foreign.principal.id),
    ).toBe(false);
    await env.DB.prepare("UPDATE identity_principal SET is_active=0 WHERE id=?")
      .bind(owner.principal.id)
      .run();
    expect((await post(application, owner)).status).toBe(403);
  });
  it("permits platform administration without making the administrator the owner", async () => {
    const owner = await member(),
      platform = await member();
    await ensureBootstrapAdministrator(env.DB, platform.principal.id);
    const actor = await loadActor(env.DB, platform.principal);
    const response = await post(app(actor), owner);
    expect(response.status).toBe(201);
    const created = (await response.json()) as any;
    expect(
      (
        await new PersonalApiKeys(env.DB, "preview").authenticate(
          created.secret,
        )
      ).actor.principal.id,
    ).toBe(owner.principal.id);
  });
  it("denies management after disabling the tenant or administrator", async () => {
    const admin = await member(801, "tenant_admin"),
      owner = await member(),
      application = app(admin);
    await env.DB.prepare("UPDATE identity_principal SET is_active=0 WHERE id=?")
      .bind(admin.principal.id)
      .run();
    expect((await application.request(base)).status).toBe(403);
    await env.DB.prepare("UPDATE identity_principal SET is_active=1 WHERE id=?")
      .bind(admin.principal.id)
      .run();
    await env.DB.prepare("UPDATE tenants SET is_active=0 WHERE id=801").run();
    try {
      expect((await application.request(base)).status).toBe(403);
      expect((await application.request(`${base}/members`)).status).toBe(403);
      expect((await post(application, owner)).status).toBe(403);
      expect(
        (
          await application.request(`${base}/${crypto.randomUUID()}`, {
            method: "DELETE",
            headers: { origin: "https://preview.example" },
          })
        ).status,
      ).toBe(403);
    } finally {
      await env.DB.prepare("UPDATE tenants SET is_active=1 WHERE id=801").run();
    }
  });
  it("protects cookie mutations and rejects invalid scope, lifetime and path tenant overrides", async () => {
    const admin = await member(801, "tenant_admin"),
      owner = await member(),
      application = app(admin);
    for (const origin of [undefined, "https://evil.example"]) {
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (origin) headers.origin = origin;
      expect(
        (
          await application.request(base, {
            method: "POST",
            headers,
            body: JSON.stringify(input(owner)),
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await application.request(`${base}/${crypto.randomUUID()}`, {
            method: "DELETE",
            headers,
          })
        ).status,
      ).toBe(403);
    }
    for (const patch of [
      { scopes: ["*"] },
      { lifetimeDays: 365 },
      { tenantId: 802 },
    ])
      expect(
        (
          await application.request(base, {
            method: "POST",
            headers: {
              origin: "https://preview.example",
              "content-type": "application/json",
            },
            body: JSON.stringify({ ...input(owner), ...patch }),
          })
        ).status,
      ).toBe(400);
  });
});
