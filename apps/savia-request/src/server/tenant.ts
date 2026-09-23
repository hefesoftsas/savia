/**
 * Tenant scope for Savia Request.
 *
 * Platform catalog lives in the global tables (`flows`, `flow_variables`,
 * ...) with tenant "". Tenant customizations live in additive overlay
 * tables (`tenant_flows`, `tenant_flow_variables`, ...) keyed by tenant id.
 * Resolution is fallback-based: tenant override wins, otherwise the global
 * platform definition/variable applies.
 *
 * Tenant ids follow the platform convention (`agency:101`, `tenant:101`,
 * `domain:platform`, ...). Empty string means the shared platform catalog.
 */

export const PLATFORM_TENANT = "";

const TENANT_PATTERN = /^[A-Za-z0-9:_.-]{1,120}$/;

export function isPlatformTenant(tenant: string): boolean {
  return tenant === PLATFORM_TENANT;
}

export function scopeTenant(tenant?: unknown): string {
  return normalizeTenantId(tenant ?? "");
}

export function normalizeTenantId(value: unknown): string {
  if (value === undefined || value === null) return PLATFORM_TENANT;
  const tenant = String(value).trim();
  if (!tenant) return PLATFORM_TENANT;
  if (!TENANT_PATTERN.test(tenant)) throw new Error("Tenant inválido.");
  return tenant;
}

/** Reads tenant from the private worker request (header wins, query fallback). */
export function tenantFromRequest(request: Request): string {
  const header = request.headers.get("x-savia-tenant");
  if (header !== null) return normalizeTenantId(header);
  try {
    const tenant = new URL(request.url).searchParams.get("tenant");
    return normalizeTenantId(tenant);
  } catch {
    return PLATFORM_TENANT;
  }
}
