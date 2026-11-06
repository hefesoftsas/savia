export const TENANT_SLUG_PATTERN: RegExp;
export const RESERVED_TENANT_SLUGS: ReadonlySet<string>;
export function normalizeTenantSlug(value: unknown): string | null;
export function isReservedTenantSlug(value: unknown): boolean;
