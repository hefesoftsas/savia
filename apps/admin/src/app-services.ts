import { RequestResultClient } from "./api/request-result-client";
import { ApiClient } from "./api/api-client";
import { AssistantConfigurationClient } from "./api/assistant-configuration-client";
import { CrmClient } from "./api/crm-client";
import {
  DomainClient,
  fetchDataDomains,
  invalidateSharedDataDomains,
} from "./api/domain-client";
import { PersonalIntegrationsClient } from "./api/personal-integrations-client";
import { VirtualEmployeesClient } from "./api/virtual-employees-client";
import { SaviaCommands } from "./api/savia-commands";
import { createSaviaDataProvider } from "./api/savia-data-provider";
import { UserPreferencesClient } from "./api/user-preferences-client";
import { BetterAuthOAuthSession } from "./auth/better-auth-oauth-session";
import { createReactAdminAuthProvider } from "./auth/react-admin-auth-provider";
import { createLocalSession } from "./local-data/session";
import { createWorkspaceManager } from "./local-data/workspaces";
import { QueryClient } from "@tanstack/react-query";
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
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: "always",
        retry: 1,
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
      },
      mutations: { networkMode: "always", retry: false },
    },
  });
  const localData = createWorkspaceManager(authSession, apiClient, apiUrl);
  const clearOfflineData = async () => {
    invalidateSharedDataDomains();
    clearStudioQueryCache();
    clearAllSaviaRequestSnapshots();
    clearCachedTenantOptions();
    queryClient.clear();
    await localData.clear();
  };

  return {
    authSession,
    authProvider: createReactAdminAuthProvider(authSession, {
      onLogout: clearOfflineData,
      canAccessCrm: async () => {
        const data = await fetchDataDomains(apiClient);
        for (const domain of data) {
          const scope =
            domain.kind === "custom" ? "domain:" + domain.id : domain.id;
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
