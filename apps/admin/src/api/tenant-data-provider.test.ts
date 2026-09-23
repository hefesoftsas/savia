import { describe, expect, it, vi } from "vitest";
import { ApiClient, ApiClientError } from "./api-client";
import { createTenantDataProvider } from "./tenant-data-provider";

const tenant = {
  id: 101,
  name: "Comunidad",
  idSlug: "comunidad",
  isActive: true,
  createdAt: "2026-09-09",
  updatedAt: "2026-09-09",
  agencyId: null,
  kind: "commercial" as const,
};
function setup() {
  const client = {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
  return {
    client,
    provider: createTenantDataProvider(client as unknown as ApiClient),
  };
}

describe("tenant data provider", () => {
  it("paginates and sorts active generic tenants without requiring an agency profile", async () => {
    const { client, provider } = setup();
    client.get.mockResolvedValue({
      data: [
        { ...tenant, id: 102, name: "Zulu" },
        tenant,
        { ...tenant, id: 103, name: "Disabled", isActive: false },
      ],
      meta: { total: 3 },
    });
    await expect(
      provider.getList("tenants", {
        pagination: { page: 2, perPage: 1 },
        sort: { field: "name", order: "ASC" },
        filter: { isActive: true },
      }),
    ).resolves.toEqual({
      data: [{ ...tenant, id: 102, name: "Zulu" }],
      total: 2,
    });
  });

  it("keeps the internal tenant out of commercial assignment selectors", async () => {
    const { client, provider } = setup();
    const platform = {
      id: 0,
      name: "Plataforma Savia",
      idSlug: "savia-platform",
      isActive: true,
      createdAt: "2026-09-09",
      updatedAt: "2026-09-09",
      agencyId: null,
      kind: "platform" as const,
    };
    client.get.mockResolvedValue({
      data: [platform, tenant],
      meta: { total: 2 },
    });

    await expect(
      provider.getList("tenants", {
        pagination: { page: 1, perPage: 20 },
        sort: { field: "name", order: "ASC" },
        filter: { kind: "commercial" },
      }),
    ).resolves.toEqual({ data: [tenant], total: 1 });
  });

  it("creates tenants with their mandatory first administrator and leaves slug generation to the server", async () => {
    const { client, provider } = setup();
    client.post.mockResolvedValue({ data: tenant });
    await expect(
      provider.create("tenants", {
        data: {
          name: tenant.name,
          isActive: true,
          idSlug: "",
          address: "must not send",
          initialUser: {
            email: "admin@comunidad.test",
            firstName: "Ana",
            lastName: "Administradora",
          },
        },
      }),
    ).resolves.toEqual({ data: tenant });
    expect(client.post).toHaveBeenCalledWith("/v1/tenants", {
      name: tenant.name,
      isActive: true,
      initialUser: {
        email: "admin@comunidad.test",
        firstName: "Ana",
        lastName: "Administradora",
        role: "tenant_admin",
      },
    });
  });

  it("creates tenants by transferring an existing user without auth-service fields", async () => {
    const { client, provider } = setup();
    client.post.mockResolvedValue({ data: tenant });
    await expect(
      provider.create("tenants", {
        data: {
          name: tenant.name,
          isActive: true,
          idSlug: "",
          memberMode: "existing",
          existingUserId: "principal-one",
          existingRole: "operator",
          initialUser: {
            email: "ignored@comunidad.test",
            firstName: "Ignored",
            lastName: "User",
          },
        },
      }),
    ).resolves.toEqual({ data: tenant });
    expect(client.post).toHaveBeenCalledWith("/v1/tenants", {
      name: tenant.name,
      isActive: true,
      existingMember: { principalId: "principal-one", role: "operator" },
    });
  });

  it("updates tenant state through PATCH and forwards server conflicts", async () => {
    const { client, provider } = setup();
    client.patch.mockResolvedValue({ data: { ...tenant, isActive: false } });
    await provider.update("tenants", {
      id: tenant.id,
      data: { ...tenant, isActive: false },
      previousData: tenant,
    });
    expect(client.patch).toHaveBeenCalledWith("/v1/tenants/101", {
      name: tenant.name,
      idSlug: tenant.idSlug,
      isActive: false,
    });
    client.patch.mockRejectedValue(
      new ApiClientError(409, "TENANT_CONFLICT", "Tenant conflict"),
    );
    await expect(
      provider.update("tenants", {
        id: tenant.id,
        data: tenant,
        previousData: tenant,
      }),
    ).rejects.toMatchObject({ status: 409, code: "TENANT_CONFLICT" });
  });

  it("loads selector records and deletes through the tenant endpoints", async () => {
    const { client, provider } = setup();
    client.get.mockResolvedValue({ data: tenant });
    await expect(provider.getOne("tenants", { id: 101 })).resolves.toEqual({
      data: tenant,
    });
    await expect(provider.getMany("tenants", { ids: [101] })).resolves.toEqual({
      data: [tenant],
    });
    await provider.delete("tenants", { id: 101, previousData: tenant });
    expect(client.delete).toHaveBeenCalledWith("/v1/tenants/101");
  });
});
