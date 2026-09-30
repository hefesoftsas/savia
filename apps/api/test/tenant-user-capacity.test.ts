import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { createTestApp } from "./test-app";
import { platformAdministratorAuthenticator } from "./auth-fixtures";
import {
  grantMembership,
  loadActor,
  upsertPrincipal,
} from "../src/auth/identity-repository";

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
});
let sequence = 985000;
async function fixture() {
  const tenantId = ++sequence;
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,kind,is_active,created_at,updated_at) VALUES(?,?,?,'commercial',1,'2026-09-29','2026-09-29')",
  )
    .bind(tenantId, `capacity-${tenantId}`, `Capacity ${tenantId}`)
    .run();
  const admin = await principal();
  await grantMembership(env.DB, admin.id, tenantId, "tenant_admin");
  const platform = createTestApp({
    auth: platformAdministratorAuthenticator(),
  });
  const tenantAdmin = createTestApp({
    auth: { authenticate: async () => loadActor(env.DB, admin) },
  });
  return {
    tenantId,
    admin,
    platform,
    tenantAdmin,
    path: `/v1/tenants/${tenantId}/user-capacity`,
  };
}
async function principal(active = true) {
  const key = crypto.randomUUID();
  const result = await upsertPrincipal(env.DB, {
    issuer: "savia:test",
    subject: key,
    email: `${key}@test.example`,
    displayName: "Capacity member",
  });
  if (!active)
    await env.DB.prepare("UPDATE identity_principal SET is_active=0 WHERE id=?")
      .bind(result.id)
      .run();
  return result;
}
const put = (maxActiveUsers: number | null) => ({
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ maxActiveUsers }),
});

it("defaults to unlimited and allows only platform admins to change the cap", async () => {
  const f = await fixture();
  const initial = await f.tenantAdmin.request(f.path);
  expect(initial.status).toBe(200);
  expect(await initial.json()).toEqual({
    data: { tenantId: f.tenantId, maxActiveUsers: null, activeUsers: 1 },
  });
  expect((await f.tenantAdmin.request(f.path, put(10))).status).toBe(403);
  const updated = await f.platform.request(f.path, put(2));
  expect(updated.status).toBe(200);
  expect(await updated.json()).toMatchObject({
    data: { maxActiveUsers: 2, activeUsers: 1 },
  });
  const other = await fixture();
  expect((await f.tenantAdmin.request(other.path)).status).toBe(403);
  expect((await f.platform.request(f.path, put(-1))).status).toBe(400);
  expect((await f.platform.request(f.path, put(2147483648))).status).toBe(400);
  const viewer = await principal();
  await grantMembership(env.DB, viewer.id, f.tenantId, "viewer");
  const viewerApp = createTestApp({
    auth: { authenticate: async () => loadActor(env.DB, viewer) },
  });
  expect((await viewerApp.request(f.path)).status).toBe(403);
  expect((await viewerApp.request(f.path, put(null))).status).toBe(403);
});

it("enforces the last seat atomically and permits updates to existing active members", async () => {
  const f = await fixture();
  expect((await f.platform.request(f.path, put(2))).status).toBe(200);
  const [a, b] = await Promise.all([principal(), principal()]);
  const outcomes = await Promise.allSettled(
    [a, b].map((p) => grantMembership(env.DB, p.id, f.tenantId, "viewer")),
  );
  expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
  const failure = outcomes.find(
    (o) => o.status === "rejected",
  ) as PromiseRejectedResult;
  expect(String(failure.reason)).toContain("TENANT_ACTIVE_USER_LIMIT_REACHED");
  expect(
    (await f.tenantAdmin.request(f.path).then((r) => r.json())).data
      .activeUsers,
  ).toBe(2);
  await expect(
    grantMembership(env.DB, f.admin.id, f.tenantId, "tenant_admin"),
  ).resolves.toMatchObject({ agencyId: f.tenantId });
});

it("counts active principals only and blocks reactivation until a seat is available", async () => {
  const f = await fixture();
  expect((await f.platform.request(f.path, put(1))).status).toBe(200);
  const inactive = await principal(false);
  await grantMembership(env.DB, inactive.id, f.tenantId, "viewer");
  await expect(
    env.DB.prepare("UPDATE identity_principal SET is_active=1 WHERE id=?")
      .bind(inactive.id)
      .run(),
  ).rejects.toThrow("TENANT_ACTIVE_USER_LIMIT_REACHED");
  expect((await f.platform.request(f.path, put(null))).status).toBe(200);
  await env.DB.prepare("UPDATE identity_principal SET is_active=1 WHERE id=?")
    .bind(inactive.id)
    .run();
  expect(
    (await f.tenantAdmin.request(f.path).then((r) => r.json())).data
      .activeUsers,
  ).toBe(2);
  expect((await f.platform.request(f.path, put(0))).status).toBe(200);
  expect(
    (await f.tenantAdmin.request(f.path).then((r) => r.json())).data
      .activeUsers,
  ).toBe(2);
});

it("applies the cap to transfers and membership reactivation without disturbing the current tenant", async () => {
  const source = await fixture();
  const target = await fixture();
  const user = await principal();
  await grantMembership(env.DB, user.id, source.tenantId, "viewer");
  await target.platform.request(target.path, put(1));
  await expect(
    grantMembership(env.DB, user.id, target.tenantId, "viewer"),
  ).rejects.toThrow("TENANT_ACTIVE_USER_LIMIT_REACHED");
  expect(
    await env.DB.prepare(
      "SELECT tenant_id FROM identity_tenant_membership WHERE principal_id=?",
    )
      .bind(user.id)
      .first("tenant_id"),
  ).toBe(source.tenantId);
  await source.platform.request(source.path, put(1));
  await env.DB.prepare(
    "UPDATE identity_tenant_membership SET is_active=0 WHERE principal_id=?",
  )
    .bind(user.id)
    .run();
  await expect(
    env.DB.prepare(
      "UPDATE identity_tenant_membership SET is_active=1 WHERE principal_id=?",
    )
      .bind(user.id)
      .run(),
  ).rejects.toThrow("TENANT_ACTIVE_USER_LIMIT_REACHED");
  expect(
    await env.DB.prepare(
      "SELECT is_active FROM identity_tenant_membership WHERE principal_id=?",
    )
      .bind(user.id)
      .first("is_active"),
  ).toBe(0);
  await source.platform.request(source.path, put(2));
  await grantMembership(env.DB, user.id, source.tenantId, "viewer");
  expect(
    (await source.tenantAdmin.request(source.path).then((r) => r.json())).data
      .activeUsers,
  ).toBe(2);
});
