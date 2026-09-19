import { describe, expect, it, vi } from "vitest";
import { IdentityClient } from "./identity-client";
import type { ApiClient } from "./api-client";

describe("IdentityClient", () => {
  it("coalesces concurrent list calls into a single network request", async () => {
    const mockUsers = [
      {
        id: "p1",
        kind: "identity-principal",
        attributes: {
          email: "user1@example.com",
          displayName: "User One",
          isActive: true,
          globalRoles: [],
          account: { role: "user", isBanned: false, twoFactorEnabled: false },
        },
        relationships: { memberships: [] },
      },
    ];

    const get = vi.fn().mockImplementation(async () => {
      // Simulate network delay
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { data: mockUsers };
    });

    const client = new IdentityClient({ get } as unknown as ApiClient);

    // Call list 4 times concurrently (simulating UserList and 3 Count badges)
    const [r1, r2, r3, r4] = await Promise.all([
      client.list(),
      client.list(),
      client.list(),
      client.list(),
    ]);

    expect(get).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(mockUsers);
    expect(r2).toEqual(mockUsers);
    expect(r3).toEqual(mockUsers);
    expect(r4).toEqual(mockUsers);
  });

  it("serves subsequent list calls from cache within TTL", async () => {
    const mockUsers = [{ id: "p1" }];
    const get = vi.fn().mockResolvedValue({ data: mockUsers });
    const client = new IdentityClient({ get } as unknown as ApiClient);

    const first = await client.list();
    const second = await client.list();

    expect(first).toEqual(mockUsers);
    expect(second).toEqual(mockUsers);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("invalidates cache when a mutation occurs", async () => {
    const mockUsers = [{ id: "p1" }];
    const get = vi.fn().mockResolvedValue({ data: mockUsers });
    const patch = vi.fn().mockResolvedValue({ data: { id: "p1" } });
    const client = new IdentityClient({ get, patch } as unknown as ApiClient);

    await client.list();
    expect(get).toHaveBeenCalledTimes(1);

    await client.update("p1", { firstName: "Updated" });
    await client.list();

    expect(get).toHaveBeenCalledTimes(2);
  });
});
