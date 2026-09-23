import { describe, expect, it } from "vitest";
import {
  canAccessSharedCrm,
  canManageSharedCrm,
} from "../src/external-crm/hubspot-access";
import type { AppActor } from "../src/auth/types";
import { resolveDynamicTenantKey } from "../src/routes/studio";

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
  it("allows tenant_admin to access and manage tenant:101 and agency:101", () => {
    const actor = createActor();
    expect(canAccessSharedCrm(actor, "tenant:101")).toBe(true);
    expect(canManageSharedCrm(actor, "tenant:101")).toBe(true);
    expect(canAccessSharedCrm(actor, "agency:101")).toBe(true);
    expect(canManageSharedCrm(actor, "agency:101")).toBe(true);
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
    expect(canAccessSharedCrm(actor, "agency:999")).toBe(true);
    expect(canManageSharedCrm(actor, "agency:999")).toBe(true);
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

  it("resolves dynamic tenant key preferring legacy agency: prefix if records exist", async () => {
    const mockDb = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async () => {
            if (args[0] === "agency:101") return { 1: 1 };
            return null;
          },
        }),
      }),
    } as unknown as D1Database;

    const key = await resolveDynamicTenantKey(mockDb, 101);
    expect(key).toBe("agency:101");
  });

  it("resolves dynamic tenant key using preferredPrefix when no records exist", async () => {
    const mockDb = {
      prepare: () => ({
        bind: () => ({
          first: async () => null,
        }),
      }),
    } as unknown as D1Database;

    const tenantRouteKey = await resolveDynamicTenantKey(mockDb, 202, "tenant");
    expect(tenantRouteKey).toBe("tenant:202");

    const agencyRouteKey = await resolveDynamicTenantKey(mockDb, 202, "agency");
    expect(agencyRouteKey).toBe("agency:202");
  });

  it("prefers tenant: prefix whenever tenant: records already exist", async () => {
    const mockDb = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async () => {
            if (args[0] === "tenant:303") return { 1: 1 };
            return null;
          },
        }),
      }),
    } as unknown as D1Database;

    const key = await resolveDynamicTenantKey(mockDb, 303, "agency");
    expect(key).toBe("tenant:303");
  });
});

