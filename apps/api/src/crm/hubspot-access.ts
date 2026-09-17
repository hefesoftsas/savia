import type { AppActor } from "../auth/types";

export function canAccessSharedCrm(actor: AppActor, tenant: string): boolean {
  if (!actor.principal.isActive) return false;
  if (actor.globalRoles.includes("platform_admin")) return true;
  const match = /^agency:(\d+)$/.exec(tenant);
  return Boolean(
    match &&
    actor.memberships.some(
      (membership) =>
        membership.isActive &&
        (membership.tenantId ?? membership.agencyId) === Number(match[1]),
    ),
  );
}

export function canManageSharedCrm(actor: AppActor, tenant: string): boolean {
  if (!canAccessSharedCrm(actor, tenant)) return false;
  if (actor.globalRoles.includes("platform_admin")) return true;
  const tenantId = Number(tenant.slice("agency:".length));
  return actor.memberships.some(
    (membership) =>
      membership.isActive &&
      (membership.tenantId ?? membership.agencyId) === tenantId &&
      ["agency_admin", "tenant_admin"].includes(membership.role),
  );
}
