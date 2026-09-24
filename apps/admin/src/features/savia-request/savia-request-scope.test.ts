import { describe, expect, it } from "vitest";
import {
  adminMembershipScopes,
  isValidScope,
  resolveScope,
  scopeForTenantId,
  scopeLabel,
} from "./savia-request-scope";

describe("savia-request-scope", () => {
  it("formats tenant scopes and labels", () => {
    expect(scopeForTenantId(101)).toBe("agency:101");
    expect(scopeLabel("agency:101")).toBe("agency:101");
    expect(scopeLabel(undefined)).toBe("Plataforma (catálogo global)");
    expect(isValidScope("agency:101")).toBe(true);
    expect(isValidScope("agency/../x")).toBe(false);
    expect(isValidScope("")).toBe(false);
  });

  it("collects only administrator memberships", () => {
    expect(
      adminMembershipScopes([
        { tenantId: 202, role: "viewer" },
        { agencyId: 101, role: "agency_admin" },
        { tenantId: 303, role: "tenant_admin" },
        { agencyId: 101, role: "agency_admin" },
      ]),
    ).toEqual(["agency:101", "agency:303"]);
    expect(adminMembershipScopes(undefined)).toEqual([]);
  });

  it("prefers the dedicated host tenant", () => {
    expect(
      resolveScope({
        dedicatedTenantId: 101,
        memberships: [{ agencyId: 101, role: "agency_admin" }],
        isPlatformAdmin: false,
        override: null,
      }),
    ).toBe("agency:101");
  });

  it("auto-scopes tenant admins with a single membership", () => {
    expect(
      resolveScope({
        dedicatedTenantId: null,
        memberships: [{ agencyId: 101, role: "agency_admin" }],
        isPlatformAdmin: false,
        override: null,
      }),
    ).toBe("agency:101");
  });

  it("keeps the platform catalog without scope", () => {
    expect(
      resolveScope({
        dedicatedTenantId: null,
        memberships: [],
        isPlatformAdmin: true,
        override: null,
      }),
    ).toBeUndefined();
    expect(
      resolveScope({
        dedicatedTenantId: null,
        memberships: [
          { agencyId: 101, role: "agency_admin" },
          { agencyId: 202, role: "agency_admin" },
        ],
        isPlatformAdmin: false,
        override: null,
      }),
    ).toBeUndefined();
  });

  it("honors overrides within the user's permissions", () => {
    expect(
      resolveScope({
        dedicatedTenantId: 101,
        memberships: [{ agencyId: 101, role: "agency_admin" }],
        isPlatformAdmin: true,
        override: "agency:999",
      }),
    ).toBe("agency:999");
    expect(
      resolveScope({
        dedicatedTenantId: null,
        memberships: [{ agencyId: 101, role: "agency_admin" }],
        isPlatformAdmin: false,
        override: "agency:999",
      }),
    ).toBe("agency:101");
    expect(
      resolveScope({
        dedicatedTenantId: null,
        memberships: [],
        isPlatformAdmin: true,
        override: "agency/../x",
      }),
    ).toBeUndefined();
  });
});
