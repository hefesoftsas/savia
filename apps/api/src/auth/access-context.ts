import type { AccessScope } from "@savia/studio-shared/access-control";
import { accessScopeSchema } from "@savia/studio-shared/access-control";
import type { AppActor } from "./types";
import { AccessControlError, denyAccess } from "./access-registry";
export async function hasCustomAccess(
  db: D1Database,
  principalId: string,
  scope: AccessScope,
) {
  return Boolean(
    await db
      .prepare(
        "SELECT 1 FROM access_assignments a JOIN access_roles r ON r.scope=a.scope AND r.id=a.role_id WHERE a.scope=? AND a.principal_id=? AND r.protected=0 AND r.enabled=1 LIMIT 1",
      )
      .bind(scope, principalId)
      .first(),
  );
}
export async function accessAuthority(
  db: D1Database,
  actor: AppActor,
  scope: AccessScope,
  manage = false,
) {
  if (!accessScopeSchema.safeParse(scope).success)
    throw new AccessControlError(422, "INVALID_ACCESS_SCOPE", "Invalid scope.");
  const principal = await db
    .prepare("SELECT is_active FROM identity_principal WHERE id=?")
    .bind(actor.principal.id)
    .first<{ is_active: number }>();
  if (!actor.principal.isActive || !principal?.is_active) return denyAccess();
  const global = await db
    .prepare(
      "SELECT 1 FROM identity_global_role WHERE principal_id=? AND role='platform_admin'",
    )
    .bind(actor.principal.id)
    .first();
  const tenantId = scope.startsWith("tenant:") ? Number(scope.slice(7)) : null;
  if (tenantId !== null) {
    const tenant = await db
      .prepare(
        "SELECT id FROM tenants WHERE id=? AND is_active=1 AND kind='commercial'",
      )
      .bind(tenantId)
      .first();
    if (!tenant) return denyAccess();
  } else if (
    scope !== "platform" &&
    !(await db
      .prepare("SELECT id FROM studio_data_domains WHERE id=?")
      .bind(scope.slice(7))
      .first())
  )
    return denyAccess();
  const membership =
    tenantId === null
      ? null
      : await db
          .prepare(
            "SELECT role FROM identity_tenant_membership WHERE principal_id=? AND tenant_id=? AND is_active=1",
          )
          .bind(actor.principal.id, tenantId)
          .first<{ role: string }>();
  const admin = Boolean(
    global ||
    (membership && ["agency_admin", "tenant_admin"].includes(membership.role)),
  );
  if (manage && !admin) return denyAccess();
  if (!global && !membership) {
    if (scope.startsWith("tenant:")) return denyAccess();
    const assigned = await db
      .prepare(
        "SELECT 1 FROM access_assignments a JOIN access_roles r ON r.id=a.role_id AND r.scope=a.scope WHERE a.scope=? AND a.principal_id=? AND r.enabled=1",
      )
      .bind(scope, actor.principal.id)
      .first();
    if (!assigned) return denyAccess();
  }
  return {
    platform: Boolean(global),
    manager: admin,
    legacyRole: membership?.role ?? null,
  };
}
