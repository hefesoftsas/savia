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
    expect(scopeForTenantId(101)).toBe("tenant:101");
    expect(scopeLabel("tenant:101")).toBe("tenant:101");
    expect(scopeLabel(undefined)).toBe("Plataforma (catálogo global)");
    expect(isValidScope("tenant:101")).toBe(true);
    expect(isValidScope("agency/../x")).toBe(false);
    expect(isValidScope("")).toBe(false);
    for (const invalid of [
      "agency:101",
      "tenant:-1",
      "tenant:01",
      "tenant:1.5",
      "tenant:9007199254740992",
      "random",
    ]) {
      expect(isValidScope(invalid)).toBe(false);
    }
    expect(isValidScope("tenant:0")).toBe(true);
  });

  it("maps legacy selections to the same canonical tenant without extending permissions", () => {
    expect(
      resolveScope({ isPlatformAdmin: true, override: "agency:999" }),
    ).toBe("tenant:999");
    expect(
      resolveScope({
        isPlatformAdmin: false,
        memberships: [{ tenantId: 101, role: "tenant_admin" }],
        override: "agency:101",
      }),
    ).toBe("tenant:101");
    expect(
      resolveScope({
        isPlatformAdmin: false,
        memberships: [{ tenantId: 101, role: "tenant_admin" }],
        override: "agency:999",
      }),
    ).toBe("tenant:101");
  });

  it("collects only administrator memberships", () => {
    expect(
      adminMembershipScopes([
        { tenantId: 202, role: "viewer" },
        { agencyId: 101, role: "agency_admin" },
        { tenantId: 303, role: "tenant_admin" },
        { agencyId: 101, role: "agency_admin" },
      ]),
    ).toEqual(["tenant:101", "tenant:303"]);
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
    ).toBe("tenant:101");
  });

  it("auto-scopes tenant admins with a single membership", () => {
    expect(
      resolveScope({
        dedicatedTenantId: null,
        memberships: [{ agencyId: 101, role: "agency_admin" }],
        isPlatformAdmin: false,
        override: null,
      }),
    ).toBe("tenant:101");
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
        override: "tenant:999",
      }),
    ).toBe("tenant:999");
    expect(
      resolveScope({
        dedicatedTenantId: null,
        memberships: [{ agencyId: 101, role: "agency_admin" }],
        isPlatformAdmin: false,
        override: "tenant:999",
      }),
    ).toBe("tenant:101");
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
