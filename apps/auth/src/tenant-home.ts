import type { AuthWorkerEnvironment } from "./index";
import type { TenantSSOAdapter } from "./tenant-sso";

type ScopedUser = {
  emailTenantId?: number | null;
  role?: string | null;
};

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

async function resolveTenantSlug(
  environment: AuthWorkerEnvironment,
  tenantId: number,
): Promise<string | null> {
  if (
    !environment.SAVIA_IDENTITY ||
    !environment.SAVIA_INTERNAL_BRIDGE_KEY?.trim()
  ) {
    return null;
  }
  try {
    const response = await environment.SAVIA_IDENTITY.fetch(
      new Request(
        `https://savia-api.internal/_internal/tenants/${tenantId}/home`,
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
    } | null;
    if (!payload || typeof payload.slug !== "string" || !payload.slug.trim()) {
      return null;
    }
    return payload.slug.trim().toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Public tenant-home discovery for the login page.
 *
 * `GET /api/auth/tenant-home?email=a@b.com` returns `{ found: true, slug }`
 * when the account belongs to an active commercial tenant with its own
 * subdomain, otherwise `{ found: false }`. Fail-closed: unknown emails,
 * platform admins and lookup failures never redirect.
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
  const email = normalizeEmail(url.searchParams.get("email"));
  if (!email) {
    return Response.json(
      { found: false },
      { headers: { "cache-control": "no-store" } },
    );
  }
  const user = await adapter
    .findOne<ScopedUser>({
      model: "user",
      where: [{ field: "email", value: email }],
    })
    .catch(() => null);
  const tenantId = user?.emailTenantId;
  if (!Number.isSafeInteger(tenantId) || (tenantId as number) <= 0) {
    return Response.json(
      { found: false },
      { headers: { "cache-control": "no-store" } },
    );
  }
  if (user?.role?.split(",").includes("admin")) {
    return Response.json(
      { found: false },
      { headers: { "cache-control": "no-store" } },
    );
  }
  const slug = await resolveTenantSlug(environment, tenantId as number);
  if (!slug) {
    return Response.json(
      { found: false },
      { headers: { "cache-control": "no-store" } },
    );
  }
  return Response.json(
    { found: true, slug },
    { headers: { "cache-control": "no-store" } },
  );
}
