import {
  tenants,
  identityTenantMemberships,
  identityGlobalRoles,
  identityPrincipals,
} from "@savia/db/core-schema";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { isRegisteredAgencyRole } from "./access-policy";
import {
  TenantMembershipInvariantError,
  assertPrincipalCanLoseActiveMembership,
  assignOrTransferMembership,
  syncPlatformAdministratorMembership,
} from "./tenant-membership-invariants";
import type {
  AgencyMembership,
  AgencyRole,
  AppActor,
  ExternalIdentity,
  GlobalRole,
  IdentityPrincipal,
} from "./types";

function database(d1: D1Database) {
  return drizzle(d1, {
    schema: {
      tenants,
      identityTenantMemberships,
      identityGlobalRoles,
      identityPrincipals,
    },
  });
}

function timestamp(): string {
  return new Date().toISOString();
}

function principal(
  row: typeof identityPrincipals.$inferSelect,
): IdentityPrincipal {
  return row;
}

function membership(
  row: typeof identityTenantMemberships.$inferSelect,
): AgencyMembership {
  if (!isRegisteredAgencyRole(row.role)) {
    throw new Error("Invalid agency membership role in D1");
  }
  return { ...row, agencyId: row.tenantId, role: row.role };
}

function globalRole(row: typeof identityGlobalRoles.$inferSelect): GlobalRole {
  if (row.role !== "platform_admin")
    throw new Error("Invalid global role in D1");
  return row.role;
}

export async function upsertPrincipal(
  d1: D1Database,
  external: ExternalIdentity,
): Promise<IdentityPrincipal> {
  const db = database(d1);
  const now = timestamp();
  const [saved] = await db
    .insert(identityPrincipals)
    .values({
      id: crypto.randomUUID(),
      issuer: external.issuer,
      subject: external.subject,
      email: external.email,
      displayName: external.displayName,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [identityPrincipals.issuer, identityPrincipals.subject],
      set: {
        email: external.email,
        displayName: external.displayName,
        updatedAt: now,
      },
    })
    .returning();
  if (!saved) throw new Error("Unable to create identity principal");
  return principal(saved);
}

export async function findPrincipal(
  d1: D1Database,
  principalId: string,
): Promise<IdentityPrincipal | undefined> {
  const row = await database(d1)
    .select()
    .from(identityPrincipals)
    .where(eq(identityPrincipals.id, principalId))
    .get();
  return row ? principal(row) : undefined;
}

export async function deletePrincipal(
  d1: D1Database,
  principalId: string,
): Promise<void> {
  await database(d1)
    .delete(identityPrincipals)
    .where(eq(identityPrincipals.id, principalId));
}

export async function updatePrincipal(
  d1: D1Database,
  principalId: string,
  input: { displayName?: string },
): Promise<IdentityPrincipal> {
  const [updated] = await database(d1)
    .update(identityPrincipals)
    .set({ ...input, updatedAt: timestamp() })
    .where(eq(identityPrincipals.id, principalId))
    .returning();
  if (!updated) throw new Error("Unable to update identity principal");
  return principal(updated);
}

export async function setPrincipalActive(
  d1: D1Database,
  principalId: string,
  isActive: boolean,
): Promise<IdentityPrincipal> {
  if (!isActive) await assertPrincipalCanLoseActiveMembership(d1, principalId);
  const [updated] = await database(d1)
    .update(identityPrincipals)
    .set({ isActive, updatedAt: timestamp() })
    .where(eq(identityPrincipals.id, principalId))
    .returning();
  if (!updated) throw new Error("Unable to update identity principal state");
  return principal(updated);
}

export async function listMemberships(
  d1: D1Database,
  principalId: string,
): Promise<AgencyMembership[]> {
  const rows = await database(d1)
    .select({
      membership: identityTenantMemberships,
      tenantActive: tenants.isActive,
      tenantName: tenants.name,
      tenantSlug: tenants.idSlug,
    })
    .from(identityTenantMemberships)
    .innerJoin(tenants, eq(tenants.id, identityTenantMemberships.tenantId))
    .where(eq(identityTenantMemberships.principalId, principalId))
    .orderBy(identityTenantMemberships.tenantId)
    .all();
  return rows.map((row) => ({
    ...membership({
      ...row.membership,
      isActive: row.membership.isActive && row.tenantActive,
    }),
    tenantName: row.tenantName,
    tenantSlug: row.tenantSlug,
  }));
}

export async function listGlobalRoles(
  d1: D1Database,
  principalId: string,
): Promise<GlobalRole[]> {
  const rows = await database(d1)
    .select()
    .from(identityGlobalRoles)
    .where(eq(identityGlobalRoles.principalId, principalId))
    .all();
  return rows.map(globalRole);
}

export async function loadActor(
  d1: D1Database,
  entry: IdentityPrincipal,
): Promise<AppActor> {
  const [globalRoles, memberships] = await Promise.all([
    listGlobalRoles(d1, entry.id),
    listMemberships(d1, entry.id),
  ]);
  return { principal: entry, globalRoles, memberships };
}

export async function ensureBootstrapAdministrator(
  d1: D1Database,
  principalId: string,
): Promise<void> {
  const db = database(d1);
  await syncPlatformAdministratorMembership(d1, principalId, true);
  await db
    .insert(identityGlobalRoles)
    .values({
      principalId,
      role: "platform_admin",
      createdAt: timestamp(),
    })
    .onConflictDoNothing();
}

export async function setPlatformAdministrator(
  d1: D1Database,
  principalId: string,
  enabled: boolean,
  commercialTenantId?: number,
  commercialRole: AgencyRole = "viewer",
): Promise<void> {
  const db = database(d1);
  if (enabled) {
    await syncPlatformAdministratorMembership(d1, principalId, true);
    await db
      .insert(identityGlobalRoles)
      .values({
        principalId,
        role: "platform_admin",
        createdAt: timestamp(),
      })
      .onConflictDoNothing();
    return;
  }
  await syncPlatformAdministratorMembership(
    d1,
    principalId,
    false,
    commercialTenantId,
    commercialRole,
  );
  await db
    .delete(identityGlobalRoles)
    .where(
      and(
        eq(identityGlobalRoles.principalId, principalId),
        eq(identityGlobalRoles.role, "platform_admin"),
      ),
    );
}

export async function activePlatformAdministratorCount(
  d1: D1Database,
): Promise<number> {
  const rows = await database(d1)
    .select({ id: identityPrincipals.id })
    .from(identityPrincipals)
    .innerJoin(
      identityGlobalRoles,
      eq(identityGlobalRoles.principalId, identityPrincipals.id),
    )
    .where(
      and(
        eq(identityPrincipals.isActive, true),
        eq(identityGlobalRoles.role, "platform_admin"),
      ),
    )
    .all();
  return rows.length;
}

export { TenantMembershipInvariantError as TenantMembershipError };

export async function grantMembership(
  d1: D1Database,
  principalId: string,
  tenantId: number,
  role: AgencyRole,
): Promise<AgencyMembership> {
  if (!isRegisteredAgencyRole(role)) throw new Error("Invalid tenant membership role");
  const platformAdministrator = await database(d1)
    .select({ role: identityGlobalRoles.role })
    .from(identityGlobalRoles)
    .where(
      and(
        eq(identityGlobalRoles.principalId, principalId),
        eq(identityGlobalRoles.role, "platform_admin"),
      ),
    )
    .get();
  if (platformAdministrator) {
    throw new TenantMembershipInvariantError(
      "PLATFORM_ADMIN_REQUIRES_REVOCATION",
      "Revoke platform administration with a commercial tenant before transferring this user",
    );
  }
  return assignOrTransferMembership(d1, principalId, tenantId, role);
}

export async function removeMembership(
  d1: D1Database,
  principalId: string,
  agencyId: number,
): Promise<void> {
  const current = await database(d1)
    .select({ tenantId: identityTenantMemberships.tenantId })
    .from(identityTenantMemberships)
    .where(eq(identityTenantMemberships.principalId, principalId))
    .get();
  if (!current || current.tenantId !== agencyId) return;
  await assertPrincipalCanLoseActiveMembership(d1, principalId);
  throw new TenantMembershipInvariantError(
    "COMMERCIAL_TENANT_REQUIRED",
    "Transfer the user to another commercial tenant instead of removing membership",
  );
}
