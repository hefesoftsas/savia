import { describe, expect, it, vi } from "vitest";
import { IdentityClient } from "./identity-client";
import { createIdentityUserDataProvider } from "./identity-user-data-provider";

describe("identity user data provider", () => {
  it("returns the platform administrator when the internal tenant is selected", async () => {
    const list = vi.fn().mockResolvedValue([
      {
        id: "principal-platform",
        kind: "identity-principal",
        attributes: {
          email: "admin@savia.test",
          displayName: "Savia Administrator",
          isActive: true,
          globalRoles: ["platform_admin"],
          account: { role: "admin", isBanned: false, twoFactorEnabled: false },
        },
        relationships: {
          memberships: [
            {
              id: "membership-platform",
              role: "tenant_admin",
              attributes: { isActive: true },
              relationships: {
                tenant: { id: "0" },
                agency: { id: "0" },
              },
            },
          ],
        },
      },
    ]);
    const provider = createIdentityUserDataProvider(
      { list } as unknown as IdentityClient,
    );

    const result = await provider.getList("users", {
      pagination: { page: 1, perPage: 20 },
      sort: { field: "displayName", order: "ASC" },
      filter: { tenantId: 0 },
    });

    expect(result.data.map((user) => user.id)).toEqual(["principal-platform"]);
    expect(result.total).toBe(1);
  });

  it("returns only users assigned to the selected tenant", async () => {
    const list = vi.fn().mockResolvedValue([
      {
        id: "principal-101",
        kind: "identity-principal",
        attributes: {
          email: "one@example.test",
          displayName: "Persona Uno",
          isActive: true,
          globalRoles: [],
          account: { role: "user", isBanned: false, twoFactorEnabled: false },
        },
        relationships: {
          memberships: [
            {
              id: "membership-101",
              role: "viewer",
              attributes: { isActive: true },
              relationships: {
                tenant: { id: "101" },
                agency: { id: "101" },
              },
            },
          ],
        },
      },
      {
        id: "principal-102",
        kind: "identity-principal",
        attributes: {
          email: "two@example.test",
          displayName: "Persona Dos",
          isActive: true,
          globalRoles: [],
          account: { role: "user", isBanned: false, twoFactorEnabled: false },
        },
        relationships: {
          memberships: [
            {
              id: "membership-102",
              role: "viewer",
              attributes: { isActive: true },
              relationships: {
                tenant: { id: "102" },
                agency: { id: "102" },
              },
            },
          ],
        },
      },
    ]);
    const provider = createIdentityUserDataProvider(
      { list } as unknown as IdentityClient,
    );

    const result = await provider.getList("users", {
      pagination: { page: 1, perPage: 20 },
      sort: { field: "displayName", order: "ASC" },
      filter: { tenantId: 101 },
    });

    expect(result.data.map((user) => user.id)).toEqual(["principal-101"]);
    expect(result.total).toBe(1);
  });

  it("forwards a temporary password only while provisioning a user", async () => {
    const provision = vi.fn().mockResolvedValue({
      id: "principal-1",
      kind: "identity-principal",
      attributes: {
        email: "agency.admin@savia.test",
        displayName: "Agency Admin",
        isActive: true,
        globalRoles: [],
        account: {
          role: "user",
          isBanned: false,
          twoFactorEnabled: false,
        },
      },
      relationships: { memberships: [] },
    });
    const provider = createIdentityUserDataProvider(
      { provision } as unknown as IdentityClient,
    );

    await provider.create("users", {
      data: {
        email: "agency.admin@savia.test",
        firstName: "Agency",
        lastName: "Admin",
        temporaryPassword: "Temporary-password-123",
        platformAdmin: false,
        tenantId: 101,
        agencyRole: "agency_admin",
      },
    });

    expect(provision).toHaveBeenCalledWith({
      email: "agency.admin@savia.test",
      firstName: "Agency",
      lastName: "Admin",
      temporaryPassword: "Temporary-password-123",
      platformAdmin: false,
      membership: { tenantId: 101, role: "agency_admin" },
    });
  });
});
