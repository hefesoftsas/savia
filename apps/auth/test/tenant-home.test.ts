import { describe, expect, it, vi } from "vitest";
import { tenantHomeResponse } from "../src/tenant-home";

function adapterWith(
  user: { emailTenantId?: number | null; role?: string | null } | null,
) {
  return {
    findOne: vi.fn(async () => user),
  } as never;
}

function envWith(slug: string | null) {
  return {
    SAVIA_IDENTITY: {
      fetch: vi.fn(async () =>
        slug
          ? Response.json({ id: 42, slug })
          : Response.json({ error: "not found" }, { status: 404 }),
      ),
    },
    SAVIA_INTERNAL_BRIDGE_KEY: "bridge-key",
  } as never;
}

describe("tenant-home discovery", () => {
  it("returns the slug when the user belongs to an active tenant", async () => {
    const response = await tenantHomeResponse(
      new Request(
        "https://savia.app.hefesoft.com/api/auth/tenant-home?email=User@Example.com",
      ),
      envWith("acme"),
      adapterWith({ emailTenantId: 42, role: "user" }),
    );
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ found: true, slug: "acme" });
  });

  it("returns not found for unknown or platform admin emails", async () => {
    const missing = await tenantHomeResponse(
      new Request(
        "https://savia.app.hefesoft.com/api/auth/tenant-home?email=nobody@example.com",
      ),
      envWith("acme"),
      adapterWith(null),
    );
    expect(await missing?.json()).toEqual({ found: false });

    const admin = await tenantHomeResponse(
      new Request(
        "https://savia.app.hefesoft.com/api/auth/tenant-home?email=admin@example.com",
      ),
      envWith("acme"),
      adapterWith({ emailTenantId: 42, role: "admin" }),
    );
    expect(await admin?.json()).toEqual({ found: false });

    const noTenant = await tenantHomeResponse(
      new Request(
        "https://savia.app.hefesoft.com/api/auth/tenant-home?email=user@example.com",
      ),
      envWith("acme"),
      adapterWith({ emailTenantId: null, role: "user" }),
    );
    expect(await noTenant?.json()).toEqual({ found: false });
  });

  it("fails closed on invalid email or inactive tenant", async () => {
    const invalid = await tenantHomeResponse(
      new Request(
        "https://savia.app.hefesoft.com/api/auth/tenant-home?email=not-an-email",
      ),
      envWith("acme"),
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
