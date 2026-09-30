import type { AuthPermissions } from "@/auth/auth-session";

const adminRoles = new Set(["tenant_admin", "agency_admin"]);

/** Return a tenant only when the actor has one unambiguous admin membership. */
export function tenantAdminTenantId(
  memberships: AuthPermissions["memberships"] | undefined,
): number | undefined {
  const tenantIds = new Set<number>();
  for (const membership of memberships ?? []) {
    if (!adminRoles.has(membership.role)) continue;
    const tenantId = membership.tenantId ?? membership.agencyId;
    if (
      tenantId !== undefined &&
      Number.isSafeInteger(tenantId) &&
      tenantId > 0
    ) {
      tenantIds.add(tenantId);
    }
  }
  return tenantIds.size === 1 ? tenantIds.values().next().value : undefined;
}

export function userCreateScope(permissions: AuthPermissions | undefined) {
  const platformCanEdit = Boolean(permissions?.canManageIdentity);
  const tenantId = platformCanEdit
    ? undefined
    : tenantAdminTenantId(permissions?.memberships);
  return {
    platformCanEdit,
    tenantId,
    defaultValues: {
      platformAdmin: false,
      agencyRole: "viewer" as const,
      ...(tenantId !== undefined ? { tenantId } : {}),
    },
  };
}

/** Tenant administrators may edit identity fields, never platform or tenant scope. */
export function tenantAdminUserUpdateData<T extends Record<string, unknown>>(
  data: T,
): Omit<T, "platformAdmin" | "tenantId" | "agencyId" | "memberships"> {
  const {
    platformAdmin: _platformAdmin,
    tenantId: _tenantId,
    agencyId: _agencyId,
    memberships: _memberships,
    ...identityData
  } = data;
  return identityData;
}
