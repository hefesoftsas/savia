import { describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/api/api-client";
import { createReactAdminAuthProvider } from "./react-admin-auth-provider";

describe("React Admin authentication provider", () => {
  it("waits for server sign-out before invalidating mounted auth queries", async () => {
    let finishSignOut!: (url: string) => void;
    const session = {
      checkSession: vi.fn(),
      clearSession: vi.fn(),
      getAccessToken: vi.fn(),
      getIdentity: vi.fn(),
      getPermissions: vi.fn(),
      handleCallback: vi.fn(),
      login: vi.fn(),
      getAuthorizeUrl: vi.fn(),
      logout: vi.fn(
        () =>
          new Promise<string>((resolve) => {
            finishSignOut = resolve;
          }),
      ),
    };
    const onLogout = vi.fn();
    const provider = createReactAdminAuthProvider(session, { onLogout });
    const logout = provider.logout({ logoutFromProvider: true });
    const cleanupBeforeSignOut = onLogout.mock.calls.length;
    finishSignOut("https://savia.example/api/auth/admin/authorize");
    await expect(logout).resolves.toBe(
      "https://savia.example/api/auth/admin/authorize",
    );
    expect(cleanupBeforeSignOut).toBe(0);
    expect(onLogout).toHaveBeenCalledOnce();
  });
  it("keeps automatic access failures local and reserves the provider logout for an explicit sign out", async () => {
    const session = {
      checkSession: vi.fn(),
      clearSession: vi.fn().mockResolvedValue(undefined),
      getAccessToken: vi.fn(),
      getIdentity: vi.fn(),
      getPermissions: vi.fn(),
      handleCallback: vi.fn(),
      login: vi.fn(),
      logout: vi
        .fn()
        .mockResolvedValue("http://127.0.0.1:8787/api/auth/admin/authorize"),
      getAuthorizeUrl: vi
        .fn()
        .mockReturnValue("http://127.0.0.1:8787/api/auth/admin/authorize"),
    };
    const provider = createReactAdminAuthProvider(session);

    const providerLogoutRedirect = await provider.logout({
      logoutFromProvider: true,
    });
    const localLogoutRedirect = await provider.logout({});
    expect(providerLogoutRedirect).toBe(
      "http://127.0.0.1:8787/api/auth/admin/authorize",
    );
    expect(localLogoutRedirect).toBe(
      "http://127.0.0.1:8787/api/auth/admin/authorize",
    );
    await expect(
      provider.checkError(
        new ApiClientError(
          401,
          "AUTHENTICATION_REQUIRED",
          "Authentication required",
        ),
      ),
    ).rejects.toBeInstanceOf(ApiClientError);

    expect(session.logout).toHaveBeenCalledOnce();
    expect(session.clearSession).toHaveBeenCalledTimes(2);
  });

  it("wipes offline data on logout without breaking the redirect", async () => {
    const session = {
      checkSession: vi.fn(),
      clearSession: vi.fn().mockResolvedValue(undefined),
      getAccessToken: vi.fn(),
      getIdentity: vi.fn(),
      getPermissions: vi.fn(),
      handleCallback: vi.fn(),
      login: vi.fn(),
      logout: vi
        .fn()
        .mockResolvedValue("http://127.0.0.1:8787/api/auth/admin/authorize"),
      getAuthorizeUrl: vi
        .fn()
        .mockReturnValue("http://127.0.0.1:8787/api/auth/admin/authorize"),
    };
    const onLogout = vi.fn();
    const provider = createReactAdminAuthProvider(session, { onLogout });

    await expect(provider.logout({})).resolves.toBe(
      "http://127.0.0.1:8787/api/auth/admin/authorize",
    );
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("still redirects when the offline wipe itself fails", async () => {
    const session = {
      checkSession: vi.fn(),
      clearSession: vi.fn().mockResolvedValue(undefined),
      getAccessToken: vi.fn(),
      getIdentity: vi.fn(),
      getPermissions: vi.fn(),
      handleCallback: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      getAuthorizeUrl: vi
        .fn()
        .mockReturnValue("http://127.0.0.1:8787/api/auth/admin/authorize"),
    };
    const provider = createReactAdminAuthProvider(session, {
      onLogout: () => {
        throw new Error("storage locked");
      },
    });

    await expect(provider.logout({})).resolves.toBe(
      "http://127.0.0.1:8787/api/auth/admin/authorize",
    );
  });

  it.each([
    "tenant_admin",
    "agency_admin",
    "operator",
    "viewer",
    "custom_role",
  ])(
    "allows %s tenant members to use their private recordings",
    async (role) => {
      const session = {
        checkSession: vi.fn(),
        clearSession: vi.fn(),
        getAccessToken: vi.fn(),
        getIdentity: vi.fn(),
        getPermissions: vi.fn().mockResolvedValue({
          canReadDocuments: true,
          canExecuteCommands: false,
          canManageIdentity: false,
          memberships: [{ tenantId: 101, role }],
        }),
        handleCallback: vi.fn(),
        login: vi.fn(),
        logout: vi.fn(),
        getAuthorizeUrl: vi.fn(),
      };
      const provider = createReactAdminAuthProvider(session);
      for (const action of ["list", "create", "delete"])
        await expect(
          provider.canAccess?.({ resource: "companion-recordings", action }),
        ).resolves.toBe(true);
    },
  );

  it("shows user administration only to platform administrators", async () => {
    const session = {
      checkSession: vi.fn(),
      clearSession: vi.fn(),
      getAccessToken: vi.fn(),
      getIdentity: vi.fn(),
      getPermissions: vi.fn().mockResolvedValue({
        canReadDocuments: true,
        canExecuteCommands: true,
        canManageIdentity: false,
      }),
      handleCallback: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      getAuthorizeUrl: vi.fn(),
    };
    const provider = createReactAdminAuthProvider(session);

    await expect(
      provider.canAccess?.({ resource: "users", action: "list" }),
    ).resolves.toBe(false);
    await expect(
      provider.canAccess?.({ resource: "tenants", action: "list" }),
    ).resolves.toBe(false);
    await expect(
      provider.canAccess?.({
        resource: "companion-recordings",
        action: "list",
      }),
    ).resolves.toBe(false);
    session.getPermissions.mockResolvedValueOnce({
      canReadDocuments: true,
      canExecuteCommands: true,
      canManageIdentity: true,
    });
    await expect(
      provider.canAccess?.({
        resource: "companion-recordings",
        action: "list",
      }),
    ).resolves.toBe(true);
    await expect(
      provider.canAccess?.({
        resource: "provider-credentials",
        action: "list",
      }),
    ).resolves.toBe(true);

    session.getPermissions.mockResolvedValueOnce({
      canReadDocuments: true,
      canExecuteCommands: false,
      canManageIdentity: false,
      memberships: [{ tenantId: 101, role: "tenant_admin" }],
    });
    await expect(
      provider.canAccess?.({ resource: "users", action: "list" }),
    ).resolves.toBe(true);

    session.getPermissions.mockResolvedValueOnce({
      canReadDocuments: true,
      canExecuteCommands: false,
      canManageIdentity: false,
      memberships: [{ tenantId: 101, role: "viewer" }],
    });
    await expect(
      provider.canAccess?.({ resource: "users", action: "list" }),
    ).resolves.toBe(false);
  });

  it("exposes private CRM connections to tenant members", async () => {
    const session = {
      checkSession: vi.fn(),
      clearSession: vi.fn(),
      getAccessToken: vi.fn(),
      getIdentity: vi.fn(),
      getPermissions: vi.fn().mockResolvedValue({
        canReadDocuments: true,
        canExecuteCommands: false,
        canManageIdentity: false,
        memberships: [{ agencyId: 101, role: "agency_admin" }],
      }),
      handleCallback: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      getAuthorizeUrl: vi.fn(),
    };
    const administrator = createReactAdminAuthProvider(session);

    await expect(
      administrator.canAccess?.({
        resource: "crm-connections",
        action: "list",
      }),
    ).resolves.toBe(true);
  });

  it("exposes private provider credentials to authenticated users", async () => {
    const session = {
      checkSession: vi.fn(),
      clearSession: vi.fn(),
      getAccessToken: vi.fn(),
      getIdentity: vi.fn(),
      getPermissions: vi.fn().mockResolvedValue({
        canReadDocuments: true,
        canExecuteCommands: false,
        canManageIdentity: false,
        memberships: [{ agencyId: 101, role: "agency_admin" }],
      }),
      handleCallback: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      getAuthorizeUrl: vi.fn(),
    };
    const provider = createReactAdminAuthProvider(session);

    await expect(
      provider.canAccess?.({
        resource: "provider-credentials",
        action: "list",
      }),
    ).resolves.toBe(true);

    session.getPermissions.mockResolvedValueOnce({
      canReadDocuments: true,
      canExecuteCommands: false,
      canManageIdentity: true,
      memberships: [],
    });
    await expect(
      provider.canAccess?.({
        resource: "provider-credentials",
        action: "list",
      }),
    ).resolves.toBe(true);
  });

  it("exposes the Savia Request editor to platform and tenant administrators", async () => {
    const session = {
      checkSession: vi.fn(),
      clearSession: vi.fn(),
      getAccessToken: vi.fn(),
      getIdentity: vi.fn(),
      getPermissions: vi.fn().mockResolvedValue({
        canReadDocuments: true,
        canExecuteCommands: false,
        canManageIdentity: false,
        memberships: [{ agencyId: 101, role: "agency_admin" }],
      }),
      handleCallback: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      getAuthorizeUrl: vi.fn(),
    };
    const provider = createReactAdminAuthProvider(session);

    await expect(
      provider.canAccess?.({ resource: "savia-request", action: "list" }),
    ).resolves.toBe(true);

    session.getPermissions.mockResolvedValueOnce({
      canReadDocuments: true,
      canExecuteCommands: false,
      canManageIdentity: false,
      memberships: [{ agencyId: 101, role: "viewer" }],
    });
    await expect(
      provider.canAccess?.({ resource: "savia-request", action: "list" }),
    ).resolves.toBe(false);

    session.getPermissions.mockResolvedValueOnce({
      canReadDocuments: true,
      canExecuteCommands: false,
      canManageIdentity: true,
      memberships: [],
    });
    await expect(
      provider.canAccess?.({ resource: "savia-request", action: "list" }),
    ).resolves.toBe(true);
  });
});
