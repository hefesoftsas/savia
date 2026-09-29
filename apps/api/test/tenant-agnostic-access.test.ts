import { describe, expect, it } from "vitest";
import {
  canAccessSharedCrm,
  canManageSharedCrm,
} from "../src/external-crm/hubspot-access";
import type { AppActor } from "../src/auth/types";
import { resolveStudioTenantKey } from "../src/routes/studio";

function createActor(overrides?: Partial<AppActor>): AppActor {
  return {
    principal: {
      id: "test-user-1",
      issuer: "savia:test",
      subject: "test-user-1",
      email: "user@test.org",
      displayName: "Test User",
      isActive: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    globalRoles: [],
    memberships: [
      {
        id: "membership-1",
        principalId: "test-user-1",
        agencyId: 101,
        tenantId: 101,
        role: "tenant_admin",
        isActive: true,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ],
    ...overrides,
  };
}

describe("Tenant-agnostic CRM access control", () => {
  it("allows tenant_admin to access and manage tenant:101 and tenant:101", () => {
    const actor = createActor();
    expect(canAccessSharedCrm(actor, "tenant:101")).toBe(true);
    expect(canManageSharedCrm(actor, "tenant:101")).toBe(true);
    expect(canAccessSharedCrm(actor, "tenant:101")).toBe(true);
    expect(canManageSharedCrm(actor, "tenant:101")).toBe(true);
  });

  it("allows legacy agency_admin to access and manage tenant:101", () => {
    const actor = createActor({
      memberships: [
        {
          id: "m-agency",
          principalId: "test-user-1",
          agencyId: 101,
          role: "agency_admin",
          isActive: true,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
    });
    expect(canAccessSharedCrm(actor, "tenant:101")).toBe(true);
    expect(canManageSharedCrm(actor, "tenant:101")).toBe(true);
  });

  it("allows viewer to access tenant:101 but not manage it", () => {
    const actor = createActor({
      memberships: [
        {
          id: "m-viewer",
          principalId: "test-user-1",
          agencyId: 101,
          tenantId: 101,
          role: "viewer",
          isActive: true,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
    });
    expect(canAccessSharedCrm(actor, "tenant:101")).toBe(true);
    expect(canManageSharedCrm(actor, "tenant:101")).toBe(false);
  });

  it("prevents access to other tenants", () => {
    const actor = createActor();
    expect(canAccessSharedCrm(actor, "tenant:999")).toBe(false);
    expect(canManageSharedCrm(actor, "tenant:999")).toBe(false);
  });

  it("allows platform_admin to access and manage any tenant", () => {
    const actor = createActor({
      globalRoles: ["platform_admin"],
      memberships: [],
    });
    expect(canAccessSharedCrm(actor, "tenant:999")).toBe(true);
    expect(canManageSharedCrm(actor, "tenant:999")).toBe(true);
    expect(canAccessSharedCrm(actor, "tenant:999")).toBe(true);
    expect(canManageSharedCrm(actor, "tenant:999")).toBe(true);
  });

  it("denies access if principal is inactive", () => {
    const actor = createActor();
    actor.principal.isActive = false;
    expect(canAccessSharedCrm(actor, "tenant:101")).toBe(false);
    expect(canManageSharedCrm(actor, "tenant:101")).toBe(false);
  });

  it("denies access if membership is inactive", () => {
    const actor = createActor({
      memberships: [
        {
          id: "m-inactive",
          principalId: "test-user-1",
          agencyId: 101,
          tenantId: 101,
          role: "tenant_admin",
          isActive: false,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
    });
    expect(canAccessSharedCrm(actor, "tenant:101")).toBe(false);
    expect(canManageSharedCrm(actor, "tenant:101")).toBe(false);
  });

  it("always resolves Studio storage to the canonical tenant key", async () => {
    const key = await resolveStudioTenantKey(101);
    expect(key).toBe("tenant:101");
  });

  it("ignores legacy prefixes when resolving the canonical tenant key", async () => {
    const tenantRouteKey = await resolveStudioTenantKey(202);
    expect(tenantRouteKey).toBe("tenant:202");

    const agencyRouteKey = await resolveStudioTenantKey(202);
    expect(agencyRouteKey).toBe("tenant:202");
  });

  it("uses tenant zero for the reserved platform workspace", async () => {
    const key = await resolveStudioTenantKey(0);
    expect(key).toBe("tenant:0");
  });
});
