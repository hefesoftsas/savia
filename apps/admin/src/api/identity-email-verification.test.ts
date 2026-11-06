import { describe, expect, it, vi } from "vitest";
import {
  createIdentityUserDataProvider,
  toUserRecord,
} from "./identity-user-data-provider";
import type { IdentityClient, ManagedIdentityUser } from "./identity-client";

const account = {
  id: "user-1",
  kind: "identity-principal",
  attributes: {
    email: "person@example.test",
    displayName: "Test Person",
    isActive: true,
    globalRoles: [],
    account: {
      role: "user",
      isBanned: false,
      twoFactorEnabled: false,
      emailVerified: false,
    },
  },
  relationships: { memberships: [] },
} as ManagedIdentityUser;

describe("administrator email verification override", () => {
  it("shows pending verification and forwards an explicit override when creating a user", async () => {
    expect(toUserRecord(account)).toMatchObject({ emailVerified: false });
    const provision = vi.fn().mockResolvedValue(account);
    const provider = createIdentityUserDataProvider({
      provision,
    } as unknown as IdentityClient);
    await provider.create("users", {
      data: {
        email: "person@example.test",
        firstName: "Test",
        lastName: "Person",
        emailVerified: true,
      },
    });
    expect(provision).toHaveBeenCalledWith(
      expect.objectContaining({ emailVerified: true }),
    );
  });

  it("forwards an explicit verification change on edit", async () => {
    const update = vi.fn().mockResolvedValue(account);
    const provider = createIdentityUserDataProvider({
      update,
    } as unknown as IdentityClient);
    await provider.update("users", {
      id: "user-1",
      data: { emailVerified: true },
      previousData: { id: "user-1" },
    });
    expect(update).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ emailVerified: true }),
    );
  });
});
