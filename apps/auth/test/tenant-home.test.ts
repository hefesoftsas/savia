import { describe, expect, it, vi } from "vitest";
import { tenantHomeResponse } from "../src/tenant-home";

function adapterWith(
  user: { emailTenantId?: number | null; role?: string | null } | null,
) {
  return {
    findOne: vi.fn(async () => user),
  } as never;
}

function envWith(
  home: {
    slug: string;
    currentSlug?: string | null;
    currentTenantId?: number | null;
  } | null,
) {
  const fetch = vi.fn(async (request: Request) => {
    if (!home) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({
      id: 42,
      slug: home.slug,
      currentSlug: home.currentSlug ?? null,
      currentTenantId: home.currentTenantId ?? null,
    });
  });
  return {
    SAVIA_IDENTITY: { fetch },
    SAVIA_INTERNAL_BRIDGE_KEY: "bridge-key",
  } as never;
}

describe("tenant-home discovery", () => {
  it("returns the slug with server-resolved host context", async () => {
    const environment = envWith({ slug: "acme" });
    const response = await tenantHomeResponse(
      new Request(
        "https://savia.app.hefesoft.com/api/auth/tenant-home?email=User@Example.com",
      ),
      environment,
      adapterWith({ emailTenantId: 42, role: "user" }),
    );
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({
      found: true,
      tenantId: 42,
      slug: "acme",
      currentSlug: null,
      currentTenantId: null,
    });
    const calledUrl = String(
      (environment.SAVIA_IDENTITY.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0][0].url,
    );
    expect(calledUrl).toContain("/_internal/tenants/42/home?host=");
    expect(calledUrl).toContain("savia.app.hefesoft.com");
  });

  it("forwards the current tenant context when already on a tenant host", async () => {
    const response = await tenantHomeResponse(
      new Request(
        "https://acme.savia.app.hefesoft.com/api/auth/tenant-home?email=user@example.com",
      ),
      envWith({ slug: "acme", currentSlug: "acme", currentTenantId: 42 }),
      adapterWith({ emailTenantId: 42, role: "user" }),
    );
    expect(await response?.json()).toEqual({
      found: true,
      tenantId: 42,
      slug: "acme",
      currentSlug: "acme",
      currentTenantId: 42,
    });
  });

  it("returns not found for unknown or platform admin emails", async () => {
    const missing = await tenantHomeResponse(
      new Request(
        "https://savia.app.hefesoft.com/api/auth/tenant-home?email=nobody@example.com",
      ),
      envWith({ slug: "acme" }),
      adapterWith(null),
    );
    expect(await missing?.json()).toEqual({ found: false });

    const admin = await tenantHomeResponse(
      new Request(
        "https://savia.app.hefesoft.com/api/auth/tenant-home?email=admin@example.com",
      ),
      envWith({ slug: "acme" }),
      adapterWith({ emailTenantId: 42, role: "admin" }),
    );
    expect(await admin?.json()).toEqual({ found: false });

    const noTenant = await tenantHomeResponse(
      new Request(
        "https://savia.app.hefesoft.com/api/auth/tenant-home?email=user@example.com",
      ),
      envWith({ slug: "acme" }),
      adapterWith({ emailTenantId: null, role: "user" }),
    );
    expect(await noTenant?.json()).toEqual({ found: false });
  });

  it("fails closed on invalid email or inactive tenant", async () => {
    const invalid = await tenantHomeResponse(
      new Request(
        "https://savia.app.hefesoft.com/api/auth/tenant-home?email=not-an-email",
      ),
      envWith({ slug: "acme" }),
      adapterWith({ emailTenantId: 42, role: "user" }),
    );
    expect(await invalid?.json()).toEqual({ found: false });

    const inactive = await tenantHomeResponse(
      new Request(
        "https://savia.app.hefesoft.com/api/auth/tenant-home?email=user@example.com",
      ),
      envWith(null),
      adapterWith({ emailTenantId: 42, role: "user" }),
    );
    expect(await inactive?.json()).toEqual({ found: false });
  });
});
