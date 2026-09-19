import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  grantMembership,
  listMemberships,
  removeMembership,
  setPlatformAdministrator,
  setPrincipalActive,
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
  for (const [, sql] of migrations) {
    for (const statement of sql
      .split("--> statement-breakpoint")
      .map((entry) =>
        entry
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean)) {
      await env.DB.exec(statement);
    }
  }
});

beforeEach(async () => {
  await env.DB.exec("DELETE FROM identity_tenant_membership");
  await env.DB.exec("DELETE FROM identity_global_role");
  await env.DB.exec("DELETE FROM identity_principal");
  await env.DB.exec(
    "INSERT OR IGNORE INTO tenants (id, id_slug, name, is_active, created_at, updated_at) VALUES (9101, 'tenant-one', 'Tenant One', 1, '2026-09-09', '2026-09-09'), (9102, 'tenant-two', 'Tenant Two', 1, '2026-09-09', '2026-09-09')",
  );
});

async function user() {
  return upsertPrincipal(env.DB, {
    issuer: "test",
    subject: crypto.randomUUID(),
    email: "tenant@example.test",
    displayName: "Tenant User",
  });
}

describe("required single tenant membership", () => {
  it("assigns a generic tenant without an agency profile and updates its role", async () => {
    const principal = await user();
    expect(await listMemberships(env.DB, principal.id)).toEqual([]);
    const first = await grantMembership(env.DB, principal.id, 9101, "viewer");
    const updated = await grantMembership(
      env.DB,
      principal.id,
      9101,
      "operator",
    );
    expect(updated).toMatchObject({
      id: first.id,
      tenantId: 9101,
      agencyId: 9101,
      role: "operator",
    });
    expect(await listMemberships(env.DB, principal.id)).toHaveLength(1);
  });

  it("transfers a member directly without an unassigned state", async () => {
    const principal = await user();
    const remainingMember = await user();
    await grantMembership(env.DB, principal.id, 9101, "viewer");
    await grantMembership(env.DB, remainingMember.id, 9101, "tenant_admin");
    await expect(grantMembership(env.DB, principal.id, 9102, "operator"))
      .resolves.toMatchObject({ tenantId: 9102, role: "operator" });
    expect(await listMemberships(env.DB, principal.id)).toEqual([
      expect.objectContaining({ tenantId: 9102, isActive: true }),
    ]);
  });

  it("rejects removal and deactivation of a commercial tenant's last active member", async () => {
    const principal = await user();
    await grantMembership(env.DB, principal.id, 9101, "tenant_admin");
    await expect(removeMembership(env.DB, principal.id, 9101)).rejects.toMatchObject({
      code: "LAST_ACTIVE_MEMBER",
    });
    await expect(setPrincipalActive(env.DB, principal.id, false)).rejects.toMatchObject({
      code: "LAST_ACTIVE_MEMBER",
    });
  });

  it("moves a promoted platform administrator to the internal tenant", async () => {
    const principal = await user();
    const remainingMember = await user();
    await grantMembership(env.DB, principal.id, 9101, "tenant_admin");
    await grantMembership(env.DB, remainingMember.id, 9101, "viewer");
    await setPlatformAdministrator(env.DB, principal.id, true);
    expect(await listMemberships(env.DB, principal.id)).toEqual([
      expect.objectContaining({ tenantId: 0, role: "tenant_admin" }),
    ]);
    await expect(grantMembership(env.DB, principal.id, 9102, "viewer")).rejects.toMatchObject({
      code: "PLATFORM_ADMIN_REQUIRES_REVOCATION",
    });
  });

  it("rejects the internal tenant as an ordinary membership target", async () => {
    const principal = await user();
    await expect(
      grantMembership(env.DB, principal.id, 0, "viewer"),
    ).rejects.toMatchObject({ code: "PLATFORM_TENANT_RESERVED" });
  });

  it("rejects missing tenants", async () => {
    const principal = await user();
    await expect(
      grantMembership(env.DB, principal.id, 9199, "viewer"),
    ).rejects.toMatchObject({ code: "TENANT_NOT_FOUND" });
  });
});
