import type { MiddlewareHandler } from "hono";
import {
  buildTenantHostname,
  DEFAULT_CANONICAL_HOST,
  normalizeCanonicalHost,
  normalizeTenantSlug,
  parseTenantSlugFromHostname,
} from "@savia/tenant-host/tenant-host";
import { actorFromContext } from "./middleware";
import type { AppActor } from "./types";

/** Set by the edge gateway; falls back to Host parsing when absent. */
export const TENANT_SLUG_HEADER = "x-savia-tenant-slug";

export const TENANT_HOST_MISMATCH = "TENANT_HOST_MISMATCH";

export function canonicalHostForApi(publicOrigin?: string): string {
  if (!publicOrigin) return DEFAULT_CANONICAL_HOST;
  try {
    const host = normalizeCanonicalHost(new URL(publicOrigin).hostname);
    if (
      host === "127.0.0.1" ||
      host === "localhost" ||
      /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(host)
    ) {
      return DEFAULT_CANONICAL_HOST;
    }
    return host;
  } catch {
    return DEFAULT_CANONICAL_HOST;
  }
}

/** Tenant slug hint for this request: gateway header first, Host second. */
export function tenantSlugFromApiRequest(
  request: Request,
  canonicalHost: string = DEFAULT_CANONICAL_HOST,
): string | null {
  const headerSlug = normalizeTenantSlug(request.headers.get(TENANT_SLUG_HEADER));
  if (headerSlug) return headerSlug;
  try {
    return parseTenantSlugFromHostname(
      new URL(request.url).hostname,
      canonicalHost,
    );
  } catch {
    return null;
  }
}

type TenantSlugRow = { id: number; slug: string };

async function commercialSlugsForActor(
  db: D1Database,
  actor: AppActor,
): Promise<Map<number, string>> {
  const ids = [
    ...new Set(
      actor.memberships
        .filter((membership) => membership.isActive)
        .map((membership) => membership.tenantId ?? membership.agencyId)
        .filter((id) => Number.isSafeInteger(id) && (id as number) >= 0),
    ),
  ] as number[];
  const slugs = new Map<number, string>();
  if (!ids.length) return slugs;
  const rows = await db
    .prepare(
      `SELECT id, id_slug AS slug FROM tenants WHERE kind = 'commercial' AND is_active = 1 AND id IN (${ids.map(() => "?").join(",")})`,
    )
    .bind(...ids)
    .all<TenantSlugRow>();
  for (const row of rows.results ?? []) slugs.set(row.id, row.slug);
  return slugs;
}

function mismatchResponse(expectedHost?: string): Response {
  return Response.json(
    {
      error: {
        code: TENANT_HOST_MISMATCH,
        message:
          "Estás en el espacio de otro tenant. Abre tu URL dedicada para continuar.",
      },
      ...(expectedHost ? { expectedHost } : {}),
    },
    { status: 403 },
  );
}

/**
 * Blocks data access when the public tenant hostname does not match the
 * authenticated actor's tenant. Platform administrators manage every tenant
 * and bypass the check. Requests without a tenant hint (canonical host,
 * local dev, health checks) pass through untouched.
 */
export function tenantHostGuard(
  db: D1Database,
  canonicalHost: string = DEFAULT_CANONICAL_HOST,
): MiddlewareHandler {
  const canonical = normalizeCanonicalHost(canonicalHost);
  return async (context, next) => {
    const slug = tenantSlugFromApiRequest(context.req.raw, canonical);
    if (!slug) {
      await next();
      return;
    }
    const actor = actorFromContext(context);
    if (actor.globalRoles.includes("platform_admin")) {
      await next();
      return;
    }
    const slugs = await commercialSlugsForActor(db, actor);
    if ([...slugs.values()].includes(slug)) {
      await next();
      return;
    }
    const ownSlug = [...slugs.values()].sort()[0];
    context.header("cache-control", "no-store");
    return mismatchResponse(
      ownSlug ? buildTenantHostname(ownSlug, canonical) : undefined,
    );
  };
}
