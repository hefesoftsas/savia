import type { AuthProvider } from "ra-core";
import { ApiClientError } from "../api/api-client";
import type { AuthPermissions, AuthSession } from "./auth-session";

function hasAnyRole(
  permissions: AuthPermissions,
  roles: readonly string[],
): boolean {
  const normalizedRoles = new Set(
    roles.flatMap((r) =>
      r === "agency_admin" || r === "tenant_admin"
        ? ["tenant_admin", "agency_admin"]
        : [r],
    ),
  );
  return permissions.memberships.some((membership) =>
    normalizedRoles.has(membership.role),
  );
}

export function createReactAdminAuthProvider(
  session: AuthSession,
  options?: {
    onLogout?: () => void | Promise<void>;
    canAccessCrm?: () => Promise<boolean>;
  },
): AuthProvider {
  return {
    login: () => session.login(),
    logout: async (params?: { logoutFromProvider?: boolean }) => {
      try {
        if (params?.logoutFromProvider) {
          return session.logout();
        }
        await session.clearSession();
        return session.getAuthorizeUrl();
      } finally {
        // Persisted API cache must not survive the session: no client data
        // stays on disk after logout. Never breaks logout itself.
        try {
          await options?.onLogout?.();
        } catch {
          // ignore cleanup failures on the way out
        }
      }
    },
    checkAuth: () => session.checkSession(),
    checkError: async (error: unknown) => {
      if (error instanceof ApiClientError && error.status === 401) {
        await session.clearSession();
        throw error;
      }
      if (
        error instanceof ApiClientError &&
        error.status === 403 &&
        error.code === "TENANT_HOST_MISMATCH"
      ) {
        throw error;
      }
    },
    getIdentity: () => session.getIdentity(),
    getPermissions: () => session.getPermissions(),
    canAccess: async ({ resource, action }) => {
      const permissions = await session.getPermissions();
      const isPlatformAdmin = permissions.canManageIdentity;
      if (resource === "access-control")
        return (
          isPlatformAdmin ||
          hasAnyRole(permissions, ["tenant_admin", "agency_admin"])
        );
      if (resource === "dynamic-crm")
        return (
          isPlatformAdmin ||
          hasAnyRole(permissions, ["tenant_admin", "agency_admin"]) ||
          Boolean(await options?.canAccessCrm?.())
        );
      if (resource === "savia-request")
        return (
          isPlatformAdmin ||
          hasAnyRole(permissions, ["tenant_admin", "agency_admin"])
        );
      if (resource === "users" || resource === "tenants")
        return isPlatformAdmin;
      if (resource === "crm-connections") {
        return action === "list";
      }
      if (resource === "provider-credentials") return action === "list";
      return true;
    },
    handleCallback: () => session.handleCallback(),
  };
}
