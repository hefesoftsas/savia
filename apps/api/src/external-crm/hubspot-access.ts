import type { AppActor } from "../auth/types";

export function canAccessSharedCrm(actor: AppActor, tenant: string): boolean {
  if (!actor.principal.isActive) return false;
  if (actor.globalRoles.includes("platform_admin")) return true;
  const match = /^(?:agency|tenant):(\d+)$/.exec(tenant);
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
  const match = /^(?:agency|tenant):(\d+)$/.exec(tenant);
  const tenantId = match
    ? Number(match[1])
    : Number(tenant.replace(/^(?:agency|tenant):/, ""));
  return actor.memberships.some(
    (membership) =>
      membership.isActive &&
      (membership.tenantId ?? membership.agencyId) === tenantId &&
      ["agency_admin", "tenant_admin", "admin"].includes(membership.role),
  );
}

