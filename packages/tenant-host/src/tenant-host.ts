/**
 * Tenant-dedicated hostnames, Slack style.
 *
 * Canonical host: `savia.app.hefesoft.com`
 * Tenant host:    `<slug>.savia.app.hefesoft.com` (one DNS label, e.g. `merkaseguros`)
 *
 * This module is intentionally dependency-free so the admin SPA, the API worker
 * and the auth worker can share the exact same parsing rules. Keep the three
 * runtimes in sync by changing the rules here, never by copying them.
 */

import {
  isReservedTenantSlug,
  normalizeTenantSlug,
  RESERVED_TENANT_SLUGS,
  TENANT_SLUG_PATTERN,
} from "./tenant-slug.mjs";

export {
  isReservedTenantSlug,
  normalizeTenantSlug,
  RESERVED_TENANT_SLUGS,
  TENANT_SLUG_PATTERN,
};

export const DEFAULT_CANONICAL_HOST = "savia.app.hefesoft.com";
export const PREVIEW_CANONICAL_HOST = "savia-preview.hefesoft.com";
export const KNOWN_CANONICAL_HOSTS: ReadonlyArray<string> = [
  DEFAULT_CANONICAL_HOST,
  PREVIEW_CANONICAL_HOST,
];

export function normalizeCanonicalHost(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_CANONICAL_HOST;
  const host = value.trim().toLowerCase().replace(/\.$/, "");
  return host || DEFAULT_CANONICAL_HOST;
}

/** Derives a stable DNS label from a tenant name. Allocation handles collisions separately. */
export function tenantSlugFromName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
  const candidate = slug || "tenant";
  if (!RESERVED_TENANT_SLUGS.has(candidate)) return candidate;
  return `${candidate.slice(0, 58).replace(/-+$/g, "")}-team`;
}

function hostnameWithoutPort(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function resolveEffectiveCanonicalHost(
  host: string,
  canonicalHost: unknown,
): string {
  if (
    typeof canonicalHost === "string" &&
    canonicalHost.trim() !== "" &&
    normalizeCanonicalHost(canonicalHost) !== DEFAULT_CANONICAL_HOST
  ) {
    return normalizeCanonicalHost(canonicalHost);
  }
  if (
    host === PREVIEW_CANONICAL_HOST ||
    host.endsWith(`.${PREVIEW_CANONICAL_HOST}`)
  ) {
    return PREVIEW_CANONICAL_HOST;
  }
  return DEFAULT_CANONICAL_HOST;
}

/**
 * Returns the tenant slug when `hostname` is a direct child of `canonicalHost`
 * (`<slug>.<canonical>`), otherwise null. The canonical host itself, deeper
 * nestings (`a.b.<canonical>`), reserved slugs and invalid labels return null.
 */
export function parseTenantSlugFromHostname(
  hostname: unknown,
  canonicalHost: unknown = DEFAULT_CANONICAL_HOST,
): string | null {
  if (typeof hostname !== "string") return null;
  const host = hostnameWithoutPort(hostname);
  const canonical = resolveEffectiveCanonicalHost(host, canonicalHost);
  if (!host || host === canonical) return null;
  const suffix = `.${canonical}`;
  if (!host.endsWith(suffix)) return null;
  const slug = host.slice(0, -suffix.length);
  if (!slug || slug.includes(".")) return null;
  return normalizeTenantSlug(slug);
}

export function buildTenantHostname(
  slug: string,
  canonicalHost: string = DEFAULT_CANONICAL_HOST,
): string {
  return `${slug}.${normalizeCanonicalHost(canonicalHost)}`;
}

export function buildTenantOrigin(
  slug: string,
  canonicalHost: string = DEFAULT_CANONICAL_HOST,
  protocol = "https",
): string {
  return `${protocol}://${buildTenantHostname(slug, canonicalHost)}`;
}

/**
 * True for `https://<slug>.<canonical>` origins with a usable slug.
 * Used for CORS / trusted-origin / redirect-uri allowlists. Never allowlists
 * the canonical host itself (handled separately) or http outside loopback.
 */
export function isAllowedTenantOrigin(
  origin: unknown,
  canonicalHost: unknown = DEFAULT_CANONICAL_HOST,
): boolean {
  if (typeof origin !== "string") return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  return parseTenantSlugFromHostname(url.hostname, canonicalHost) !== null;
}

/** True when the origin is exactly the canonical `https://<canonical>` origin. */
export function isCanonicalOrigin(
  origin: unknown,
  canonicalHost: unknown = DEFAULT_CANONICAL_HOST,
): boolean {
  if (typeof origin !== "string") return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = hostnameWithoutPort(url.hostname);
  const canonical = resolveEffectiveCanonicalHost(host, canonicalHost);
  return host === canonical;
}

/** Either the canonical origin or an allowed tenant origin. */
export function isAllowedPublicOrigin(
  origin: unknown,
  canonicalHost: unknown = DEFAULT_CANONICAL_HOST,
): boolean {
  return (
    isCanonicalOrigin(origin, canonicalHost) ||
    isAllowedTenantOrigin(origin, canonicalHost)
  );
}

/**
 * Shared cookie domain for SSO across tenant subdomains and canonical host.
 * Returns `.<canonical>` (e.g. `.savia.app.hefesoft.com`) when host is the
 * canonical host or a valid tenant host. Returns undefined for IP addresses
 * or localhost (RFC 6265 compliance).
 */
export function cookieDomainForHost(
  hostname: unknown,
  canonicalHost: unknown = DEFAULT_CANONICAL_HOST,
): string | undefined {
  if (typeof hostname !== "string") return undefined;
  const host = hostnameWithoutPort(hostname);
  if (
    !host ||
    host === "localhost" ||
    /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(host)
  ) {
    return undefined;
  }
  const canonical = resolveEffectiveCanonicalHost(host, canonicalHost);
  if (host === canonical || host.endsWith(`.${canonical}`)) {
    return `.${canonical}`;
  }
  return undefined;
}
