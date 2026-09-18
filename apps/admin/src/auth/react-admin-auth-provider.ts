import type { AuthProvider } from "ra-core";
import { ApiClientError } from "../api/api-client";
import type { AuthPermissions, AuthSession } from "./auth-session";

function hasAnyRole(
  permissions: AuthPermissions,
  roles: readonly string[],
): boolean {
  return permissions.memberships.some((membership) =>
    roles.includes(membership.role === "tenant_admin" ? "agency_admin" : membership.role),
  );
}

export function createReactAdminAuthProvider(
  session: AuthSession,
  options?: { onLogout?: () => void },
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
          options?.onLogout?.();
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
      if (resource === "dynamic-crm")
        return isPlatformAdmin || hasAnyRole(permissions, ["agency_admin"]);
      if (resource === "offline-policies")
        return isPlatformAdmin || hasAnyRole(permissions, ["agency_admin"]);
      if (resource === "savia-request") return isPlatformAdmin;
      if (resource === "users" || resource === "tenants") return isPlatformAdmin;
      if (resource === "crm-connections") {
        return action === "list";
      }
      if (resource === "provider-credentials") return action === "list";
      return true;
    },
    handleCallback: () => session.handleCallback(),
  };
}
