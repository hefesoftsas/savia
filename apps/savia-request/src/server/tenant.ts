/**
 * Tenant scope for Savia Request.
 *
 * Platform catalog lives in the global tables (`flows`, `flow_variables`,
 * ...) with tenant "". Tenant customizations live in additive overlay
 * tables (`tenant_flows`, `tenant_flow_variables`, ...) keyed by tenant id.
 * Resolution is fallback-based: tenant override wins, otherwise the global
 * platform definition/variable applies.
 *
 * Tenant workspace ids use `tenant:<id>`, including `tenant:0` for platform
 * workspace data. Empty string means the shared package catalog.
 */

export const PLATFORM_TENANT = "";

const TENANT_PATTERN = /^tenant:(0|[1-9]\d*)$/;

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
  if (
    !TENANT_PATTERN.test(tenant) ||
    !Number.isSafeInteger(Number(tenant.slice(7)))
  )
    throw new Error("Tenant inválido.");
  return tenant;
}

/** Reads tenant from the private worker request (header wins, query fallback). */
export function tenantFromRequest(request: Request): string {
  const header = request.headers.get("x-savia-tenant");
  if (header !== null) return normalizeTenantId(header);
  return normalizeTenantId(new URL(request.url).searchParams.get("tenant"));
}
