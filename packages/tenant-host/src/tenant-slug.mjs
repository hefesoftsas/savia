/** DNS label: lowercase alphanumerics and hyphens, 1-63 chars, no leading/trailing hyphen. */
export const TENANT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Slugs that must never resolve as a tenant hostname. They collide with
 * infrastructure, product routes or well-known endpoints.
 * Keep in sync with tenant creation validation in `apps/api`.
 */
export const RESERVED_TENANT_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "assets",
  "auth",
  "billing",
  "cdn",
  "console",
  "consent",
  "dashboard",
  "dev",
  "docs",
  "ftp",
  "health",
  "help",
  "internal",
  "local",
  "login",
  "mail",
  "mcp",
  "next",
  "oauth",
  "openapi",
  "platform",
  "savia",
  "staging",
  "static",
  "status",
  "support",
  "well-known",
  "www",
]);

/** Lowercases, trims and validates a tenant slug. Returns null when unusable as a hostname label. */
export function normalizeTenantSlug(value) {
  if (typeof value !== "string") return null;
  const slug = value.trim().toLowerCase();
  if (!TENANT_SLUG_PATTERN.test(slug)) return null;
  if (RESERVED_TENANT_SLUGS.has(slug)) return null;
  return slug;
}

export function isReservedTenantSlug(value) {
  if (typeof value !== "string") return false;
  return RESERVED_TENANT_SLUGS.has(value.trim().toLowerCase());
}
