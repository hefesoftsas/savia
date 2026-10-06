import type { AuthWorkerEnvironment } from "./index";
import type { TenantSSOAdapter } from "./tenant-sso";

type ScopedUser = {
  emailTenantId?: number | null;
  role?: string | null;
};

type TenantHome = {
  slug: string;
  currentSlug: string | null;
  currentTenantId: number | null;
};

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

async function resolveTenantHome(
  environment: AuthWorkerEnvironment,
  tenantId: number,
  host: string,
): Promise<TenantHome | null> {
  if (
    !environment.SAVIA_IDENTITY ||
    !environment.SAVIA_INTERNAL_BRIDGE_KEY?.trim()
  ) {
    return null;
  }
  try {
    const response = await environment.SAVIA_IDENTITY.fetch(
      new Request(
        `https://savia-api.internal/_internal/tenants/${tenantId}/home?host=${encodeURIComponent(host)}`,
        {
          headers: {
            "x-savia-bridge-key": environment.SAVIA_INTERNAL_BRIDGE_KEY,
          },
        },
      ),
    );
    if (!response.ok) return null;
    const payload = (await response.json().catch(() => null)) as {
      slug?: unknown;
      currentSlug?: unknown;
      currentTenantId?: unknown;
    } | null;
    if (!payload || typeof payload.slug !== "string" || !payload.slug.trim()) {
      return null;
    }
    return {
      slug: payload.slug.trim().toLowerCase(),
      currentSlug:
        typeof payload.currentSlug === "string" && payload.currentSlug.trim()
          ? payload.currentSlug.trim().toLowerCase()
          : null,
      currentTenantId:
        Number.isSafeInteger(payload.currentTenantId) &&
        (payload.currentTenantId as number) > 0
          ? (payload.currentTenantId as number)
          : null,
    };
  } catch {
    return null;
  }
}

/**
 * Public tenant-home discovery for the login page.
 *
 * `GET /api/auth/tenant-home?email=a@b.com` returns
 * `{ found: true, slug, tenantId, currentSlug, currentTenantId }` when the
 * account belongs to an active commercial tenant with its own subdomain.
 * `currentSlug`/`currentTenantId` describe the tenant (if any) serving the
 * current hostname, resolved server-side with the deployment's canonical
 * host, so the login page never has to guess tenant hosts client-side.
 * Unknown emails, platform admins and lookup failures return
 * `{ found: false }` and never redirect (fail-closed).
 */
export async function tenantHomeResponse(
  request: Request,
  environment: AuthWorkerEnvironment,
  adapter: TenantSSOAdapter,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/auth/tenant-home" || request.method !== "GET") {
    return null;
  }
  const noStore = { headers: { "cache-control": "no-store" } };
  const email = normalizeEmail(url.searchParams.get("email"));
  if (!email) {
    return Response.json({ found: false }, noStore);
  }
  const user = await adapter
    .findOne<ScopedUser>({
      model: "user",
      where: [{ field: "email", value: email }],
    })
    .catch(() => null);
  const tenantId = user?.emailTenantId;
  if (!Number.isSafeInteger(tenantId) || (tenantId as number) <= 0) {
    return Response.json({ found: false }, noStore);
  }
  if (user?.role?.split(",").includes("admin")) {
    return Response.json({ found: false }, noStore);
  }
  const home = await resolveTenantHome(
    environment,
    tenantId as number,
    url.hostname,
  );
  if (!home) {
    return Response.json({ found: false }, noStore);
  }
  return Response.json({ found: true, tenantId, ...home }, noStore);
}
