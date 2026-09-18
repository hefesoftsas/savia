import { RequestResultClient } from "./api/request-result-client";
import { ApiClient } from "./api/api-client";
import { AssistantConfigurationClient } from "./api/assistant-configuration-client";
import { CrmClient } from "./api/crm-client";
import { DomainClient } from "./api/domain-client";
import { PersonalIntegrationsClient } from "./api/personal-integrations-client";
import { VirtualEmployeesClient } from "./api/virtual-employees-client";
import { SaviaCommands } from "./api/savia-commands";
import { createSaviaDataProvider } from "./api/savia-data-provider";
import { UserPreferencesClient } from "./api/user-preferences-client";
import { BetterAuthOAuthSession } from "./auth/better-auth-oauth-session";
import { createReactAdminAuthProvider } from "./auth/react-admin-auth-provider";
import { createOfflinePersister } from "./offline/query-persister";
import { createOfflineQueryClient } from "./offline/query-client";

const apiUrl = import.meta.env.VITE_SAVIA_API_URL ?? window.location.origin;

export function createAppServices() {
  const authSession = new BetterAuthOAuthSession({
    apiUrl,
  });
  const apiClient = new ApiClient({
    baseUrl: apiUrl,
    tokenSource: authSession,
  });
  // Offline-first cache shared by React Admin and every useQuery. Owned
  // here (not in components) so logout can wipe it: no client data stays
  // on disk after the session ends.
  const queryClient = createOfflineQueryClient();
  const persister = createOfflinePersister();
  const clearOfflineData = () => {
    try {
      queryClient.clear();
    } catch {
      // ignore cleanup failures on the way out
    }
    void Promise.resolve(persister.removeClient()).catch(() => undefined);
  };

  return {
    authSession,
    authProvider: createReactAdminAuthProvider(authSession, {
      onLogout: clearOfflineData,
    }),
    apiClient,
    queryClient,
    persister,
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
