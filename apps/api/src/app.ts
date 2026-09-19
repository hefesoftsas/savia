import { registerTenantBrandingRoutes } from "./tenant-branding/routes";
import { canonicalHostForApi } from "./auth/tenant-host-guard";
import {
  installRequestResultEnvelope,
  registerRequestResultRoutes,
} from "./request-results/routes";

import {
  registerPublicFormRoutes,
  type PublicFormsOptions,
} from "./public-forms/routes";
import { createPublicQuoteAdapter } from "./public-forms/quote-adapter";
import { registerRequestPageRoutes } from "./request-pages/routes";
import { registerDataDomainRoutes } from "./routes/data-domains";
import { registerDynamicCrmRoutes } from "./routes/dynamic-crm";
import { registerTenantRoutes } from "./routes/tenants";

import { OpenAPIHono } from "@hono/zod-openapi";
import type { ExtensionActionExecutor } from "@savia/crm-shared/extension-runtime";
import {
  betterAuthOAuthClientAdministrator,
  betterAuthUserAdministrator,
  type AuthService,
} from "./auth/better-auth";
import { type OAuthResourceAuthenticator } from "./auth/oauth-resource";
import { type Authenticator } from "./auth/types";
import type { R2SigningCredentials } from "./lib/r2-presign";
import { publicAuthUrls, type PublicAuthUrls } from "./public-origin";
import {
  registerSaviaRequestRoutes,
  type SaviaRequestService,
} from "./routes/savia-request";
import { registerLookupRoutes } from "./routes/lookups";

import { registerAccountAvatarRoutes } from "./routes/account-avatar";

import type {
  AssistantConfigurationRepository,
  AssistantModelCatalog,
} from "./assistant/configuration";
import { registerAssistantConfigurationRoutes } from "./assistant/configuration-routes";
import type { AssistantService } from "./assistant/contracts";
import { registerAssistantRoutes } from "./assistant/routes";
import { registerCrmRoutes, type CrmRouteDependencies } from "./routes/crm";
import type { SqlBridgeClient } from "./crm/sql-bridge";
import { registerCrmAutomaticSyncRoutes } from "./routes/crm-automatic-sync";
import { registerIdentityRoutes } from "./routes/identity";
import { registerRealtimeRoutes } from "./realtime/routes";
import type { RealtimeHubClient } from "./realtime/hub-client";
import {
  registerPersonalIntegrationRoutes,
  type PersonalIntegrationRouteDependencies,
} from "./routes/personal-integrations";
import { registerUserPreferenceRoutes } from "./routes/user-preferences";

import { createApiShell } from "./api-shell";
import { runtimeReleaseCatalog } from "@savia/release-catalog/runtime";
export { openApiDocument } from "./api-shell";
const localPublicAuthUrls = publicAuthUrls("http://127.0.0.1:8787");
export function createApp(
  db: D1Database,
  documents?: R2Bucket,
  r2Credentials?: R2SigningCredentials,
  authenticator?: Authenticator,
  userAdministrator?: ReturnType<typeof betterAuthUserAdministrator>,
  authService?: AuthService,
  serviceBinding?: AuthService,
  oauthResource?: OAuthResourceAuthenticator,
  oauthClientAdministrator?: ReturnType<
    typeof betterAuthOAuthClientAdministrator
  >,
  oauthUrls: PublicAuthUrls = localPublicAuthUrls,
  assistantService?: AssistantService,
  crm?: CrmRouteDependencies,
  assistantConfiguration?: AssistantConfigurationRepository,
  assistantModelCatalog?: AssistantModelCatalog,
  saviaRequestService?: SaviaRequestService,
  personalIntegrations?: PersonalIntegrationRouteDependencies,
  crmIntegrationKey?: string,
  externalCollections?: { fetch(request: Request): Promise<Response> },
  sqlBridge?: SqlBridgeClient,
  extensionActionExecutor?: ExtensionActionExecutor,
  extensionConnectionsEncryptionKey?: string,
  realtime?: RealtimeHubClient,
  publicForms?: PublicFormsOptions,
): OpenAPIHono {
  const resolvedAuthService = serviceBinding ?? authService;
  const app = createApiShell(
    db,
    authenticator,
    resolvedAuthService,
    oauthResource,
    oauthUrls,
  );
  installRequestResultEnvelope(app);
  registerAssistantRoutes(app, assistantService, {
    db,
    documents,
    configuration: assistantConfiguration,
  });
  registerAssistantConfigurationRoutes(
    app,
    db,
    assistantConfiguration,
    assistantModelCatalog,
  );
  registerIdentityRoutes(
    app,
    db,
    userAdministrator ?? betterAuthUserAdministrator(resolvedAuthService),
    oauthClientAdministrator ??
      betterAuthOAuthClientAdministrator(resolvedAuthService),
    realtime,
  );
  registerRealtimeRoutes(app, realtime);
  registerSaviaRequestRoutes(app, saviaRequestService);
  registerLookupRoutes(app, saviaRequestService);
  registerPublicFormRoutes(app, db, {
    ...publicForms,
    quote:
      publicForms?.quote ??
      createPublicQuoteAdapter({
        executor: extensionActionExecutor,
        encryptionKey: extensionConnectionsEncryptionKey,
      }),
  });
  registerRequestPageRoutes(app, db, saviaRequestService);
  registerRequestResultRoutes(app, saviaRequestService);
  registerCrmRoutes(app, db, crm);
  registerCrmAutomaticSyncRoutes(app, db);
  registerDynamicCrmRoutes(
    app,
    db,
    documents,
    crmIntegrationKey,
    crm,
    externalCollections,
    undefined,
    sqlBridge,
    extensionActionExecutor,
    extensionConnectionsEncryptionKey,
    runtimeReleaseCatalog.beforeSolutionInstall(saviaRequestService),
    realtime,
  );
  registerDataDomainRoutes(
    app,
    db,
    documents,
    crmIntegrationKey,
    crm,
    externalCollections,
    undefined,
    sqlBridge,
    extensionActionExecutor,
    extensionConnectionsEncryptionKey,
    runtimeReleaseCatalog.beforeSolutionInstall(saviaRequestService),
  );
  registerPersonalIntegrationRoutes(app, db, personalIntegrations);
  registerUserPreferenceRoutes(app, db);
  registerTenantRoutes(
    app,
    db,
    userAdministrator ?? betterAuthUserAdministrator(resolvedAuthService),
    realtime,
    documents,
  );
  registerAccountAvatarRoutes(app, documents, resolvedAuthService);
  registerTenantBrandingRoutes(
    app,
    db,
    documents,
    canonicalHostForApi(oauthUrls.authorizationUrl),
  );
  return app;
}
