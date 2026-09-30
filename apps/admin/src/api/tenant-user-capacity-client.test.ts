import { describe, expect, it, vi } from "vitest";
import { TenantUserCapacityClient } from "./tenant-user-capacity-client";

describe("TenantUserCapacityClient", () => {
  it("reads capacity for the requested tenant", async () => {
    const get = vi.fn().mockResolvedValue({
      data: { tenantId: 101, maxActiveUsers: 25, activeUsers: 8 },
    });
    const client = new TenantUserCapacityClient({ get } as any);

    await expect(client.get(101)).resolves.toEqual({
      tenantId: 101,
      maxActiveUsers: 25,
      activeUsers: 8,
    });
    expect(get).toHaveBeenCalledWith("/v1/tenants/101/user-capacity");
  });

  it("saves a finite or unlimited active-user cap", async () => {
    const put = vi.fn().mockResolvedValue({
      data: { tenantId: 101, maxActiveUsers: null, activeUsers: 8 },
    });
    const client = new TenantUserCapacityClient({ put } as any);

    await expect(client.set(101, null)).resolves.toEqual({
      tenantId: 101,
      maxActiveUsers: null,
      activeUsers: 8,
    });
    expect(put).toHaveBeenCalledWith("/v1/tenants/101/user-capacity", {
      maxActiveUsers: null,
    });
  });

  it("rejects caps outside the backend integer range", async () => {
    const put = vi.fn();
    const client = new TenantUserCapacityClient({ put } as any);

    await expect(client.set(101, 2_147_483_648)).rejects.toThrow(
      "Maximum active users must be a non-negative integer.",
    );
    expect(put).not.toHaveBeenCalled();
  });
});
