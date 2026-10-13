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
import { companionDownloadsResponse } from "./companion-downloads-catalog";

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

const FLOWS_UI_PATH = "/flows-ui";

/** Keep the embedded editor's runtime and its deep links on the child shell. */
export function isFlowsUiPath(pathname: string): boolean {
  return pathname === FLOWS_UI_PATH || pathname.startsWith(`${FLOWS_UI_PATH}/`);
}

export function flowsContentSecurityPolicy(request: Request): string {
  const url = new URL(request.url);
  const websocket = url.protocol === "https:" ? "wss:" : "ws:";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    `connect-src 'self' ${websocket}//${url.host}`,
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    "frame-src 'self' blob:",
  ].join("; ");
}

function withFlowsHeaders(response: Response, request: Request): Response {
  const isolated = new Response(response.body, response);
  isolated.headers.set(
    "Content-Security-Policy",
    flowsContentSecurityPolicy(request),
  );
  isolated.headers.set("X-Content-Type-Options", "nosniff");
  isolated.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return isolated;
}

async function flowsAssetResponse(
  request: Request,
  assets: GatewayFetcher,
): Promise<Response> {
  const sourceUrl = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("Method not allowed", { status: 405 });

  const path = sourceUrl.pathname;
  const relativePath = path.slice(FLOWS_UI_PATH.length);
  const lastSegment = relativePath.split("/").pop() ?? "";
  const isHtmlNavigation =
    path === FLOWS_UI_PATH ||
    path.endsWith("/") ||
    lastSegment === "index.html" ||
    !/\.[A-Za-z0-9]{1,12}$/.test(lastSegment);
  const assetUrl = new URL(sourceUrl);
  if (isHtmlNavigation) assetUrl.pathname = `${FLOWS_UI_PATH}/index.html`;

  const response = await assets.fetch(new Request(assetUrl, request));
  const contentType = response.headers.get("content-type") ?? "";
  // Cloudflare's SPA fallback is configured for the Admin shell. A missing
  // child asset must not silently become admin HTML with a .js/.css URL.
  if (!isHtmlNavigation && /^text\/html\b/i.test(contentType))
    return new Response("Savia Flows asset not found", { status: 404 });
  const isolated = withFlowsHeaders(response, request);
  if (isHtmlNavigation) isolated.headers.set("Cache-Control", "no-store");
  else if (isImmutableFlowsAsset(path))
    isolated.headers.set(
      "Cache-Control",
      "public, max-age=31536000, immutable",
    );
  return isolated;
}

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
    pathname === "/webhooks/whatsapp" ||
    pathname.startsWith("/s/") ||
    pathname.startsWith("/.well-known/") ||
    pathname === "/mcp" ||
    pathname === "/health" ||
    pathname === "/docs" ||
    pathname === "/openapi.json"
  );
}

/**
 * Vite/Rolldown fingerprinted Admin assets (`/assets/...`) and embedded
 * Flows assets (`/flows-ui/assets/...`).
 * The hash changes on every content change, so these are safe to cache
 * immutably for a year. Everything else (index.html, manifest, icons)
 * keeps the platform default (must-revalidate) so deploys take effect.
 */
export function isImmutableAsset(pathname: string): boolean {
  if (
    !pathname.startsWith("/assets/") &&
    !pathname.startsWith("/flows-ui/assets/")
  )
    return false;
  return /-[A-Za-z0-9_-]{6,}\.(js|css|woff2?|ttf|eot)$/.test(pathname);
}

function isImmutableFlowsAsset(pathname: string): boolean {
  return (
    pathname.startsWith(`${FLOWS_UI_PATH}/assets/`) &&
    isImmutableAsset(pathname)
  );
}

/**
 * Estáticos raíz sin hash pero de cambio infrecuente. En el HAR el
 * manifest tardó 867ms y savia-icon-192 se pidió 2 veces, todo con
 * `max-age=0`: cada visita revalida. Versionados (v3) → immutable;
 * manifest y logo webp → 1h (el nombre versionado se bumpéa al cambiar).
 */
export function staticAssetCacheControl(pathname: string): string | null {
  if (
    /^\/(favicon|apple-touch-icon|savia-icon|savia-maskable|savia-splash)(-[^/]*)?\.png$/.test(
      pathname,
    )
  )
    return "public, max-age=31536000, immutable";
  if (pathname === "/favicon.svg")
    return "public, max-age=86400, must-revalidate";
  if (
    pathname === "/site.webmanifest" ||
    pathname === "/savia-logo-large-480.webp"
  )
    return "public, max-age=3600, must-revalidate";
  return null;
}

/**
 * The worker script itself must never be cached: `registration.update()`
 * relies on a fresh `sw.js` to discover a deployment. Same `no-store`
 * convention as the self-hosted HTTP server. Prebuilt hashed chunks stay
 * immutable; this covers only the unhashed entry scripts.
 */
export function serviceWorkerCacheControl(pathname: string): string | null {
  if (pathname === "/sw.js" || pathname === "/dev-sw.js") return "no-store";
  return null;
}

export async function gatewayFetch(
  request: Request,
  env: GatewayEnv,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (isFlowsUiPath(pathname)) return flowsAssetResponse(request, env.ASSETS);
  if (pathname === "/companion-downloads.json")
    return companionDownloadsResponse(request);
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
    if (
      pathname === "/register" ||
      pathname === "/public/bookings" ||
      pathname.startsWith("/public/bookings/") ||
      pathname === "/public/forms" ||
      pathname.startsWith("/public/forms/") ||
      pathname === "/public/pages" ||
      pathname.startsWith("/public/pages/") ||
      pathname === "/public/quotes" ||
      pathname.startsWith("/public/quotes/")
    ) {
      const publicPage = new Response(response.body, response);
      publicPage.headers.set("Cache-Control", "no-store");
      publicPage.headers.set("Referrer-Policy", "no-referrer");
      publicPage.headers.set("X-Robots-Tag", "noindex, nofollow");
      return publicPage;
    }
    if (isImmutableAsset(pathname)) {
      const immutable = new Response(response.body, response);
      immutable.headers.set(
        "Cache-Control",
        "public, max-age=31536000, immutable",
      );
      return immutable;
    }
    const workerCache = serviceWorkerCacheControl(pathname);
    if (workerCache) {
      const worker = new Response(response.body, response);
      worker.headers.set("Cache-Control", workerCache);
      return worker;
    }
    const staticCache = staticAssetCacheControl(pathname);
    if (staticCache) {
      const cached = new Response(response.body, response);
      cached.headers.set("Cache-Control", staticCache);
      return cached;
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
