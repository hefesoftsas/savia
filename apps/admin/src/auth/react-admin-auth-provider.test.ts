import { describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/api/api-client";
import { createReactAdminAuthProvider } from "./react-admin-auth-provider";

describe("React Admin authentication provider", () => {
  it("keeps automatic access failures local and reserves the provider logout for an explicit sign out", async () => {
    const session = {
      checkSession: vi.fn(),
      clearSession: vi.fn().mockResolvedValue(undefined),
      getAccessToken: vi.fn(),
      getIdentity: vi.fn(),
      getPermissions: vi.fn(),
      handleCallback: vi.fn(),
      login: vi.fn(),
      logout: vi.fn().mockResolvedValue("http://127.0.0.1:8787/api/auth/admin/authorize"),
      getAuthorizeUrl: vi.fn().mockReturnValue("http://127.0.0.1:8787/api/auth/admin/authorize"),
    };
    const provider = createReactAdminAuthProvider(session);

    const providerLogoutRedirect = await provider.logout({ logoutFromProvider: true });
    const localLogoutRedirect = await provider.logout({});
    expect(providerLogoutRedirect).toBe("http://127.0.0.1:8787/api/auth/admin/authorize");
    expect(localLogoutRedirect).toBe("http://127.0.0.1:8787/api/auth/admin/authorize");
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
      logout: vi.fn().mockResolvedValue("http://127.0.0.1:8787/api/auth/admin/authorize"),
      getAuthorizeUrl: vi.fn().mockReturnValue("http://127.0.0.1:8787/api/auth/admin/authorize"),
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
      getAuthorizeUrl: vi.fn().mockReturnValue("http://127.0.0.1:8787/api/auth/admin/authorize"),
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
      provider.canAccess?.({ resource: "provider-credentials", action: "list" }),
    ).resolves.toBe(true);
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

  it("exposes private provider credentials to authenticated users", async () => {    const session = {
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

  it("gates offline policies to admins and tenant admins", async () => {
    const baseSession = {
      checkSession: vi.fn(),
      clearSession: vi.fn(),
      getAccessToken: vi.fn(),
      getIdentity: vi.fn(),
      handleCallback: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      getAuthorizeUrl: vi.fn(),
    };
    const withPermissions = (permissions: unknown) =>
      createReactAdminAuthProvider({
        ...baseSession,
        getPermissions: vi.fn().mockResolvedValue(permissions),
      });
    const platformAdmin = withPermissions({
      canReadDocuments: true,
      canExecuteCommands: true,
      canManageIdentity: true,
      memberships: [],
    });
    const tenantAdmin = withPermissions({
      canReadDocuments: true,
      canExecuteCommands: true,
      canManageIdentity: false,
      memberships: [{ agencyId: 101, role: "tenant_admin" }],
    });
    const viewer = withPermissions({
      canReadDocuments: true,
      canExecuteCommands: false,
      canManageIdentity: false,
      memberships: [{ agencyId: 101, role: "viewer" }],
    });

    await expect(
      platformAdmin.canAccess?.({ resource: "offline-policies", action: "edit" }),
    ).resolves.toBe(true);
    await expect(
      tenantAdmin.canAccess?.({ resource: "offline-policies", action: "edit" }),
    ).resolves.toBe(true);
    await expect(
      viewer.canAccess?.({ resource: "offline-policies", action: "edit" }),
    ).resolves.toBe(false);
  });
});
