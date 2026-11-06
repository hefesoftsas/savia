export const TENANT_USER_LIMIT_CODE = "TENANT_ACTIVE_USER_LIMIT_REACHED";
export class TenantUserCapacityError extends Error {
  readonly code = TENANT_USER_LIMIT_CODE;
  constructor() {
    super(
      "Este tenant alcanzó su límite de usuarios activos. Suspende un usuario o solicita ampliar el cupo al administrador de plataforma.",
    );
  }
}
export function isTenantUserCapacityError(error: unknown): boolean {
  let current = error;
  const visited = new Set<unknown>();
  while (current instanceof Error && !visited.has(current)) {
    visited.add(current);
    if (
      current instanceof TenantUserCapacityError ||
      current.message.includes(TENANT_USER_LIMIT_CODE)
    )
      return true;
    current = current.cause;
  }
  return false;
}
export async function tenantUserCapacity(db: D1Database, tenantId: number) {
  const row = await db
    .prepare(
      `SELECT
    (SELECT max_active_users FROM tenant_user_limits WHERE tenant_id=?) AS max_active_users,
    (SELECT COUNT(*) FROM identity_tenant_membership m JOIN identity_principal p ON p.id=m.principal_id
      WHERE m.tenant_id=? AND m.is_active=1 AND p.is_active=1) AS active_users`,
    )
    .bind(tenantId, tenantId)
    .first<{ max_active_users: number | null; active_users: number }>();
  return {
    tenantId,
    maxActiveUsers: row?.max_active_users ?? null,
    activeUsers: row?.active_users ?? 0,
  };
}
/** Fast feedback before provisioning; database triggers enforce the final atomic limit. */
export async function assertTenantUserCapacity(
  db: D1Database,
  tenantId: number,
  excludePrincipalId?: string,
) {
  if (
    excludePrincipalId &&
    (await db
      .prepare(
        `SELECT 1 FROM identity_tenant_membership m
    JOIN identity_principal p ON p.id=m.principal_id WHERE m.tenant_id=? AND m.principal_id=? AND m.is_active=1 AND p.is_active=1`,
      )
      .bind(tenantId, excludePrincipalId)
      .first())
  )
    return;
  const capacity = await tenantUserCapacity(db, tenantId);
  if (
    capacity.maxActiveUsers !== null &&
    capacity.activeUsers >= capacity.maxActiveUsers
  )
    throw new TenantUserCapacityError();
}
