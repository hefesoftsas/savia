import { RequestResultClient } from "./api/request-result-client";
import { ApiClient } from "./api/api-client";
import { AssistantConfigurationClient } from "./api/assistant-configuration-client";
import { CrmClient } from "./api/crm-client";
import { WhatsappClient } from "./api/whatsapp-client";
import { DomainClient } from "./api/domain-client";
import {
  fetchTenantWorkspaces,
  invalidateTenantWorkspaces,
} from "./api/tenant-workspaces-client";
import { PersonalIntegrationsClient } from "./api/personal-integrations-client";
import { VirtualEmployeesClient } from "./api/virtual-employees-client";
import { SaviaCommands } from "./api/savia-commands";
import { createSaviaDataProvider } from "./api/savia-data-provider";
import { UserPreferencesClient } from "./api/user-preferences-client";
import { BetterAuthOAuthSession } from "./auth/better-auth-oauth-session";
import { createReactAdminAuthProvider } from "./auth/react-admin-auth-provider";
import { createLocalSession } from "./local-data/session";
import { createWorkspaceManager } from "./local-data/workspaces";
import { createAdminQueryClient } from "./queries/query-policy";
import { clearStudioQueryCache } from "@/features/studio-engine/studio-query-cache";
import { clearAllSaviaRequestSnapshots } from "@/features/savia-request/savia-request-cache";
import { clearCachedTenantOptions } from "@/features/savia-request/savia-request-scope";

const apiUrl = import.meta.env.VITE_SAVIA_API_URL ?? window.location.origin;

export function createAppServices() {
  const remoteSession = new BetterAuthOAuthSession({ apiUrl });
  const authSession = createLocalSession(remoteSession, apiUrl, () =>
    remoteSession.verifySession(),
  );
  const apiClient = new ApiClient({
    baseUrl: apiUrl,
    tokenSource: authSession,
  });
  const queryClient = createAdminQueryClient();
  if (typeof window !== "undefined")
    window.addEventListener("savia:principal-changed", (event) => {
      // Logout keeps mounted auth checks until asynchronous logout cleanup
      // completes. A different owner must prove identity/permissions afresh.
      const logout =
        (event as CustomEvent<{ reason: string }>).detail?.reason === "logout";
      const filters = {
        predicate: (query: { queryKey: readonly unknown[] }) =>
          !logout || query.queryKey[0] !== "auth",
      };
      void queryClient.cancelQueries(filters);
      queryClient.removeQueries(filters);
      invalidateTenantWorkspaces();
      clearStudioQueryCache();
      clearAllSaviaRequestSnapshots();
      clearCachedTenantOptions();
    });
  const localData = createWorkspaceManager(authSession, apiClient, apiUrl);
  const clearOfflineData = async () => {
    invalidateTenantWorkspaces();
    clearStudioQueryCache();
    clearAllSaviaRequestSnapshots();
    clearCachedTenantOptions();
    try {
      await localData.clear();
    } finally {
      // No asynchronous work after clearing mounted auth queries: the logout
      // hook must be able to redirect before a fresh auth check logs out again.
      queryClient.clear();
    }
  };

  return {
    authSession,
    authProvider: createReactAdminAuthProvider(authSession, {
      onLogout: clearOfflineData,
      canAccessCrm: async () => {
        const data = await fetchTenantWorkspaces(apiClient);
        for (const tenant of data) {
          const scope = `tenant:${tenant.tenantId}`;
          try {
            const policy = await apiClient.get<{
              grants: Array<{ action: string; resource: string }>;
            }>(
              "/v1/access-control/effective?scope=" + encodeURIComponent(scope),
            );
            if (policy.grants.some((g) => g.action === "read")) return true;
          } catch {}
        }
        return false;
      },
    }),
    apiClient,
    queryClient,
    localData,
    requestResults: new RequestResultClient(apiClient),
    assistantConfiguration: new AssistantConfigurationClient(apiClient),
    dataProvider: createSaviaDataProvider(apiClient),
    domains: new DomainClient(apiClient),
    commands: new SaviaCommands(apiClient),
    crm: new CrmClient(apiClient),
    whatsapp: new WhatsappClient(apiClient),
    personalIntegrations: new PersonalIntegrationsClient(apiClient),
    virtualEmployees: new VirtualEmployeesClient(apiClient),
    userPreferences: new UserPreferencesClient(apiClient),
  };
}

export type AppServices = ReturnType<typeof createAppServices>;

let defaultAppServices: AppServices | undefined;

export function getDefaultAppServices(): AppServices {
  defaultAppServices ??= createAppServices();
  return defaultAppServices;
}
