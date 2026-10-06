import { createWhatsappNangoClient } from "./whatsapp/nango";
import { registerWhatsappNativeRoutes } from "./whatsapp/native-routes";
import { AssistantThreadRepository } from "./assistant/threads";
import { PersonalApiKeys } from "./auth/personal-api-keys";
import { registerPagesSearchSettingsRoutes } from "./routes/pages-search-settings";
import { registerBookingRoutes } from "./bookings/routes";
import { registerPagesSearchRoutes } from "./routes/pages-search";
import type { PagesSearchBindings } from "./pages/cloudflare-search";
import { PersonalIntegrationOperations } from "./personal-integrations/operations";
import { createPersonalIntegrationRepository } from "./personal-integrations/repository";
import { createPersonalIntegrationProviderRegistry } from "./personal-integrations/providers";
import { registerPagesRoutes } from "./routes/pages";
import { registerOfficeDocumentRoutes } from "./routes/office-documents";
import { registerConnectedOfficeDocumentRoutes } from "./routes/connected-office-documents";
import { registerOfficeSettingsRoutes } from "./routes/office-settings";
import { registerPublicPagesRoutes } from "./pages/public-routes";
import {
  createCompanionAssistantContextLoader,
  registerCompanionRoutes,
  type CompanionOptions,
} from "./companion/routes";
import { registerEmailRegistrationRoutes } from "./tenant-registration/provisioning";
import {
  registerTenantRegistrationSettingsRoutes,
  deleteTenantRegistrationSettings,
} from "./tenant-registration/settings-routes";
import { registerPublicTenantRegistrationRoutes } from "./tenant-registration/public-routes";
import {
  registerTenantSSORoutes,
  deleteTenantSSOSettings,
  setTenantSSOActivity,
} from "./tenant-sso/routes";
import {
  registerTenantSocialRoutes,
  deleteTenantSocialSettings,
} from "./tenant-social/routes";
import { registerSocialRegistrationRoutes } from "./tenant-social/registration";
import { registerTenantHomeRoutes } from "./tenant-home/routes";
import { createCollectionGateway } from "./studio/collection-gateway";
import { registerWorkflowWebhookRoutes } from "./workflow-webhooks";
import { registerTenantBrandingRoutes } from "./tenant-branding/routes";
import {
  deleteTenantEmailSettings,
  registerTenantEmailRoutes,
} from "./tenant-email/routes";
import { canonicalHostForApi } from "./auth/tenant-host-guard";
import { registerAccessControlRoutes } from "./routes/access-control";
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
import { registerStudioRoutes } from "./routes/studio";
import { registerTenantWorkspaceRoutes } from "./routes/tenant-workspaces";
import { registerTenantUserCapacityRoutes } from "./routes/tenant-user-capacity";
import { registerPublicPluginEntryRoutes } from "./routes/public-plugin-entry";
import { registerTenantRoutes } from "./routes/tenants";

import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context, Next } from "hono";
import type { ExtensionActionExecutor } from "@savia/studio-shared/extension-runtime";
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
import { registerWhatsappChannelRoutes } from "./whatsapp/channel-routes";
import { registerWhatsappAssistantRoutes } from "./whatsapp/assistant-routes";
import {
  registerWhatsappWebhook,
  type WhatsappWebhookDependencies,
} from "./whatsapp/webhook";
import { registerCrmRoutes, type CrmRouteDependencies } from "./routes/crm";
import {
  registerWhatsappRoutes,
  type WhatsappRouteDependencies,
} from "./routes/whatsapp";
import type { SqlBridgeClient } from "./studio/sql-bridge";
import { registerIdentityRoutes } from "./routes/identity";
import { registerRealtimeRoutes } from "./realtime/routes";
import { registerRealtimeMutationHints } from "./realtime/mutation-hints";
import type { RealtimeHubClient } from "./realtime/hub-client";
import {
  registerPersonalIntegrationRoutes,
  type PersonalIntegrationRouteDependencies,
} from "./routes/personal-integrations";
import { registerUserPreferenceRoutes } from "./routes/user-preferences";
import { registerPersonalCalendarRoutes } from "./personal-calendars/routes";
import { registerNotifications } from "@savia/studio-server/notifications/routes";
import { createNotificationPolicy } from "./notifications";
import { actorFromContext, authenticationMiddleware } from "./auth/middleware";
import { betterAuthAuthenticator } from "./auth/better-auth";

import { createApiShell } from "./api-shell";
import { runtimeReleaseCatalog } from "@savia/release-catalog/runtime";
import { createPublicQuoteExecutor } from "@savia/release-catalog/public-forms";
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
  studioIntegrationKey?: string,
  externalCollections?: { fetch(request: Request): Promise<Response> },
  sqlBridge?: SqlBridgeClient,
  extensionActionExecutor?: ExtensionActionExecutor,
  extensionConnectionsEncryptionKey?: string,
  realtime?: RealtimeHubClient,
  publicForms?: PublicFormsOptions,
  collectionGatewayFactory: typeof createCollectionGateway = createCollectionGateway,
  identityBridgeKey?: string,
  companion?: CompanionOptions,
  pagesSearch?: PagesSearchBindings,
  whatsapp?: WhatsappRouteDependencies,
  whatsappWebhook?: WhatsappWebhookDependencies,
): OpenAPIHono {
  const resolvedAuthService = serviceBinding ?? authService;
  const app = createApiShell(
    db,
    authenticator,
    resolvedAuthService,
    oauthResource,
    oauthUrls,
    undefined,
    undefined,
    undefined,
    identityBridgeKey,
    publicForms,
  );
  registerCompanionRoutes(
    app,
    companion
      ? {
          ...companion,
          deleteRecordingConversations: (ownerId, recordingId) =>
            new AssistantThreadRepository(db).deleteRecordingConversations(
              ownerId,
              recordingId,
            ),
          personalFiles:
            companion.personalFiles ??
            (personalIntegrations?.nango
              ? new PersonalIntegrationOperations(
                  createPersonalIntegrationRepository(db),
                  personalIntegrations.nango,
                )
              : undefined),
        }
      : undefined,
  );
  registerRealtimeMutationHints(app, realtime, db);
  registerTenantEmailRoutes(app, db, resolvedAuthService, identityBridgeKey);
  registerBookingRoutes(app, db, {
    captcha: publicForms,
    nango: personalIntegrations?.nango,
    calendarSecret: personalIntegrations?.calendarSecret,
    shortener: publicForms?.shortener,
  });
  registerTenantSSORoutes(app, db, resolvedAuthService, identityBridgeKey);
  registerTenantSocialRoutes(app, db, resolvedAuthService, identityBridgeKey);
  registerTenantRegistrationSettingsRoutes(
    app,
    db,
    resolvedAuthService,
    identityBridgeKey,
    publicForms,
  );
  registerPublicTenantRegistrationRoutes(
    app,
    db,
    resolvedAuthService,
    identityBridgeKey,
    publicForms,
  );
  registerEmailRegistrationRoutes(
    app,
    db,
    resolvedAuthService,
    identityBridgeKey,
  );
  registerSocialRegistrationRoutes(
    app,
    db,
    resolvedAuthService,
    identityBridgeKey,
  );
  registerTenantHomeRoutes(
    app,
    db,
    identityBridgeKey,
    canonicalHostForApi(oauthUrls.authorizationUrl),
  );
  installRequestResultEnvelope(app);
  registerPublicPluginEntryRoutes(app, db, studioIntegrationKey);
  registerAccessControlRoutes(app, db, realtime);
  registerAssistantRoutes(app, assistantService, {
    db,
    documents,
    configuration: assistantConfiguration,
    loadThreadContext: createCompanionAssistantContextLoader(companion),
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
  registerRealtimeRoutes(app, db, realtime);
  registerSaviaRequestRoutes(app, saviaRequestService);
  registerLookupRoutes(app, saviaRequestService);
  registerWorkflowWebhookRoutes(app, db, {
    rateLimiter: publicForms?.rateLimiter,
  });
  registerPublicFormRoutes(app, db, {
    ...publicForms,
    saviaRequest: publicForms?.saviaRequest ?? saviaRequestService,
    quote:
      publicForms?.quote ??
      createPublicQuoteAdapter({
        executor: createPublicQuoteExecutor(saviaRequestService),
        encryptionKey: extensionConnectionsEncryptionKey,
      }),
  });
  registerRequestPageRoutes(app, db, saviaRequestService);
  registerRequestResultRoutes(app, saviaRequestService);
  registerCrmRoutes(app, db, crm);
  registerWhatsappRoutes(app, db, whatsapp);
  registerWhatsappChannelRoutes(app, db);
  registerWhatsappAssistantRoutes(
    app,
    db,
    Boolean(whatsappWebhook?.appSecret && whatsappWebhook?.verifyToken),
  );
  registerWhatsappNativeRoutes(
    app,
    db,
    whatsapp?.nango ?? createWhatsappNangoClient({}),
    whatsapp?.nativeContributions,
  );
  if (whatsappWebhook) registerWhatsappWebhook(app, whatsappWebhook);
  registerStudioRoutes(
    app,
    db,
    documents,
    studioIntegrationKey,
    crm,
    externalCollections,
    collectionGatewayFactory,
    sqlBridge,
    extensionActionExecutor,
    extensionConnectionsEncryptionKey,
    runtimeReleaseCatalog.beforeSolutionInstall(saviaRequestService),
    saviaRequestService,
    realtime,
    personalIntegrations,
  );
  registerTenantWorkspaceRoutes(app, db);
  registerTenantUserCapacityRoutes(app, db);
  registerPersonalIntegrationRoutes(app, db, personalIntegrations);
  registerPersonalCalendarRoutes(app, db, {
    secret: personalIntegrations?.calendarSecret,
  });
  registerPagesSearchSettingsRoutes(app, db);
  registerPagesSearchRoutes(app, db, pagesSearch);
  registerPagesRoutes(app, db, documents, pagesSearch);
  registerOfficeDocumentRoutes(app, db, documents);
  registerConnectedOfficeDocumentRoutes(
    app,
    db,
    personalIntegrations ?? {
      providers: createPersonalIntegrationProviderRegistry({}),
    },
  );
  registerOfficeSettingsRoutes(app, db);
  registerPublicPagesRoutes(app, db, documents, publicForms);
  registerUserPreferenceRoutes(app, db);
  const notificationAuth = authenticationMiddleware(
    db,
    authenticator ??
      betterAuthAuthenticator(
        resolvedAuthService,
        oauthResource,
        new PersonalApiKeys(db, oauthUrls.personalApiKeyDeploymentId ?? null),
      ),
  );
  const notificationSession = async (context: Context, next: Next) => {
    const actor = actorFromContext(context);
    const membership = actor.memberships.find(
      (candidate) => candidate.isActive,
    );
    const session = context as unknown as {
      set(key: "principalId" | "tenant", value: string): void;
    };
    session.set("principalId", actor.principal.id);
    session.set(
      "tenant",
      membership ? `tenant:${membership.tenantId ?? membership.agencyId}` : "",
    );
    await next();
  };
  for (const path of ["/api/notifications", "/api/notifications/*"]) {
    app.use(path, notificationAuth);
    app.use(path, notificationSession);
  }
  registerNotifications(app as never, { policy: createNotificationPolicy(db) });
  registerTenantRoutes(
    app,
    db,
    userAdministrator ?? betterAuthUserAdministrator(resolvedAuthService),
    realtime,
    documents,
    saviaRequestService,
    resolvedAuthService && identityBridgeKey
      ? async (tenantId) => {
          await deleteTenantRegistrationSettings(
            resolvedAuthService,
            identityBridgeKey,
            tenantId,
          );
          await deleteTenantSocialSettings(
            resolvedAuthService,
            identityBridgeKey,
            tenantId,
          );
          await deleteTenantSSOSettings(
            resolvedAuthService,
            identityBridgeKey,
            tenantId,
          );
          await deleteTenantEmailSettings(
            resolvedAuthService,
            identityBridgeKey,
            tenantId,
          );
        }
      : undefined,
    resolvedAuthService && identityBridgeKey
      ? (tenantId, active) =>
          setTenantSSOActivity(
            resolvedAuthService,
            identityBridgeKey,
            tenantId,
            active,
          )
      : undefined,
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
