import {
  officeAssetResponse,
  officeDocumentHeaders,
  type OfficeAssetBucket,
} from "./office-gateway";
import {
  DEFAULT_CANONICAL_HOST,
  normalizeCanonicalHost,
  parseTenantSlugFromHostname,
} from "@savia/tenant-host/tenant-host";

export type GatewayFetcher = {
  fetch(request: Request): Response | Promise<Response>;
};

export type GatewayEnv = {
  OFFICE_RUNTIME?: OfficeAssetBucket;
  API: GatewayFetcher;
  ASSETS: GatewayFetcher;
  /** Overrides the canonical host (default: savia.app.hefesoft.com). */
  CANONICAL_HOST?: string;
};

/** Header carrying the tenant slug resolved from the public hostname. */
export const TENANT_SLUG_HEADER = "x-savia-tenant-slug";

export function canonicalHostFromEnv(
  env?: Pick<GatewayEnv, "CANONICAL_HOST">,
): string {
  return normalizeCanonicalHost(env?.CANONICAL_HOST ?? DEFAULT_CANONICAL_HOST);
}

/** Tenant slug from the request hostname, or null on the canonical host. */
export function tenantSlugFromRequest(
  request: Request,
  env?: Pick<GatewayEnv, "CANONICAL_HOST">,
): string | null {
  return parseTenantSlugFromHostname(
    new URL(request.url).hostname,
    canonicalHostFromEnv(env),
  );
}

export function isServicePath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/v1/") ||
    pathname.startsWith("/.well-known/") ||
    pathname === "/mcp" ||
    pathname === "/health" ||
    pathname === "/docs" ||
    pathname === "/openapi.json"
  );
}

export async function gatewayFetch(
  request: Request,
  env: GatewayEnv,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (pathname.startsWith("/office/runtime/"))
    return officeAssetResponse(request, env.OFFICE_RUNTIME);
  if (pathname === "/office" || pathname.startsWith("/office/")) {
    const response = await env.ASSETS.fetch(request);
    const isolated = new Response(response.body, response);
    for (const [key, value] of Object.entries(officeDocumentHeaders))
      isolated.headers.set(key, value);
    return isolated;
  }
  if (!isServicePath(pathname)) {
    const response = await env.ASSETS.fetch(request);
    if (pathname === "/public/forms" || pathname.startsWith("/public/forms/")) {
      const publicPage = new Response(response.body, response);
      publicPage.headers.set("Cache-Control", "no-store");
      publicPage.headers.set("Referrer-Policy", "no-referrer");
      publicPage.headers.set("X-Robots-Tag", "noindex, nofollow");
      return publicPage;
    }
    return response;
  }
  const slug = tenantSlugFromRequest(request, env);
  if (!slug) return env.API.fetch(request);
  const forwarded = new Request(request, {
    headers: (() => {
      const headers = new Headers(request.headers);
      headers.set(TENANT_SLUG_HEADER, slug);
      return headers;
    })(),
  });
  return env.API.fetch(forwarded);
}

export default { fetch: gatewayFetch };
