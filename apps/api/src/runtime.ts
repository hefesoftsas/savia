import type { PagesSearchBindings } from "./pages/cloudflare-search";
import { runJiraPrivacyMaintenance } from "./personal-integrations/jira-privacy-runtime";
import { runtimePluginRegistryForTenant } from "./studio/plugin-registry-config";
import { createCollectionGateway } from "./studio/collection-gateway";
import { remoteMcpResponse } from "./mcp-gateway";
import { maintainRecordHistory } from "@savia/studio-server/record-history-storage";
import { purgeStudioAudit } from "@savia/studio-server/audit-retention";
import { createApp } from "./app";
import { createRealtimeHubClient } from "./realtime/hub-client";
import { runScheduledNotifications } from "./notifications";
import { runScheduledWorkflows } from "./workflows";
import { AssistantConfigurationRepository } from "./assistant/configuration";
import { PersonalActionPayloadCipher } from "./assistant/personal-action-payload";
import { SaviaAssistantService } from "./assistant/service";
import type { AuthService } from "./auth/better-auth";
import { oauthResourceAuthenticator } from "./auth/runtime";
import {
  crmRoutesFromEnvironment,
  nangoConfigurationFromEnvironment,
  type CrmSecrets,
} from "./external-crm/runtime";
import {
  createSqlBridgeClient,
  sqlBridgeFromEnvironment,
  type SqlBridgeClient,
  type SqlBridgeSecrets,
} from "./studio/sql-bridge";
import type { R2SigningCredentials } from "./lib/r2-presign";
import { createPersonalIntegrationNangoClient } from "./personal-integrations/nango";
import { createBookingCalendarAdapter } from "./bookings/calendar";
import { runBookingJobs } from "./bookings/jobs";
import { createPersonalIntegrationProviderRegistry } from "./personal-integrations/providers";
import { publicAuthUrls } from "./public-origin";
import {
  connectorExecutorFromEnvironment,
  extensionConnectionsEncryptionKeyFromEnvironment,
  type ConnectorGatewayEnvironment,
} from "./studio/connector-executor";
import { createPublicQuoteAdapter } from "./public-forms/quote-adapter";
import { isLocalPublicOrigin } from "./public-forms/captcha";
import { createShlinkShortener } from "./public-forms/shortener";
import type { PersonalIntegrationRouteDependencies } from "./routes/personal-integrations";
import { publishRealtime } from "./realtime/hub-client";
import { tenantRoom } from "./realtime/protocol";
import { betterAuthUserAdministrator } from "./auth/better-auth";
export { oauthResourceAuthenticator } from "./auth/runtime";
export {
  crmClientFromEnvironment,
  crmRoutesFromEnvironment,
  nangoConfigurationFromEnvironment,
  type CrmSecrets,
} from "./external-crm/runtime";

type AttachmentSecrets = {
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
};

type AuthServiceBinding = {
  AUTH?: AuthService;
  SAVIA_API_RESOURCE?: string;
  SAVIA_OAUTH_ISSUER?: string;
  SAVIA_PUBLIC_ORIGIN?: string;
};

type AssistantSecrets = {
  STUDIO_INTEGRATION_KEY?: string;
  CRM_INTEGRATION_KEY?: string;
  ASSISTANT_SETTINGS_ENCRYPTION_KEY?: string;
  SAVIA_MCP_URL?: string;
  SAVIA_MCP_SHARED_SECRET?: string;
  SAVIA_INTERNAL_BRIDGE_KEY?: string;
  MCP?: { fetch: typeof fetch };
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
};

export type RuntimeEnvironment = {
  COMPANION_ENABLED?: string;
  COMPANION_STT_MODEL?: string;
  SAVIA_WORKFLOW_ONLY_SCHEDULE?: string;
  PLUGIN_REGISTRY_TENANTS?: string;
  DB: D1Database;
  DOCUMENTS: R2Bucket;
  REALTIME_HUB?: DurableObjectNamespace;
  REALTIME_RATE_LIMITER?: {
    limit(input: { key: string }): Promise<{ success: boolean }>;
  };
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  SHLINK_SERVER_URL?: string;
  SHLINK_API_KEY?: string;
  SAVIA_DISABLE_CAPTCHA?: string;
  SAVIA_MOCK_QUOTES?: string;
  PUBLIC_FORMS_RATE_LIMITER?: {
    limit(input: { key: string }): Promise<{ success: boolean }>;
  };
  SAVIA_REQUEST?: import("./routes/savia-request").SaviaRequestService;
} & AttachmentSecrets &
  AuthServiceBinding &
  AssistantSecrets &
  CrmSecrets &
  SqlBridgeSecrets &
  ConnectorGatewayEnvironment;

export { sqlBridgeFromEnvironment } from "./studio/sql-bridge";

export function personalIntegrationRoutesFromEnvironment(
  environment: CrmSecrets & Pick<AssistantSecrets, "SAVIA_MCP_SHARED_SECRET">,
): PersonalIntegrationRouteDependencies {
  const mcpSharedSecret = environment.SAVIA_MCP_SHARED_SECRET?.trim();
  return {
    calendarSecret: mcpSharedSecret,
    providers: createPersonalIntegrationProviderRegistry(
      nangoConfigurationFromEnvironment(environment),
    ),
    nango: createPersonalIntegrationNangoClient(
      nangoConfigurationFromEnvironment(environment),
    ),
    ...(mcpSharedSecret
      ? {
          personalActionPayloadCipher: new PersonalActionPayloadCipher(
            mcpSharedSecret,
          ),
        }
      : {}),
  };
}

async function identityAdministrationBridgeKey(
  configuredKey: string | undefined,
  secret: string | undefined,
): Promise<string | undefined> {
  if (configuredKey?.trim()) return configuredKey.trim();
  if (!secret?.trim()) return undefined;
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret.trim()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      material,
      new TextEncoder().encode("savia:auth-tenant-user-administration:v1"),
    ),
  );
  return Array.from(signature, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function signingCredentials(
  environment: AttachmentSecrets,
): R2SigningCredentials | undefined {
  const {
    R2_ACCOUNT_ID: accountId,
    R2_ACCESS_KEY_ID: accessKeyId,
    R2_SECRET_ACCESS_KEY: secretAccessKey,
  } = environment;
  if (!accountId || !accessKeyId || !secretAccessKey) return undefined;
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket: "savia-documents",
  };
}

/**
 * Canonical secret is STUDIO_INTEGRATION_KEY; CRM_INTEGRATION_KEY stays as
 * a legacy alias so existing deployments keep working without rotation.
 */
export function studioIntegrationKeyFromEnvironment(
  environment: Pick<
    AssistantSecrets,
    "STUDIO_INTEGRATION_KEY" | "CRM_INTEGRATION_KEY"
  >,
): string | undefined {
  return (
    environment.STUDIO_INTEGRATION_KEY?.trim() ||
    environment.CRM_INTEGRATION_KEY?.trim() ||
    undefined
  );
}

function assistantConfigurationFromEnvironment(
  environment: Pick<
    RuntimeEnvironment,
    "DB" | "DOCUMENTS" | "COMPANION_STT_MODEL"
  > &
    AssistantSecrets,
): AssistantConfigurationRepository {
  const encryptionKey =
    environment.ASSISTANT_SETTINGS_ENCRYPTION_KEY?.trim() ||
    studioIntegrationKeyFromEnvironment(environment) ||
    environment.SAVIA_MCP_SHARED_SECRET?.trim();
  return new AssistantConfigurationRepository(environment.DB, {
    encryptionKey,
    deploymentApiKey: environment.OPENROUTER_API_KEY?.trim(),
    deploymentModel: environment.OPENROUTER_MODEL?.trim(),
    deploymentTranscriptionModel: environment.COMPANION_STT_MODEL?.trim(),
  });
}

import { VirtualEmployeesRepository } from "./assistant/virtual-employees";

function assistantServiceFromEnvironment(
  environment: Pick<RuntimeEnvironment, "DB" | "DOCUMENTS"> & AssistantSecrets,
  configuration: AssistantConfigurationRepository,
): SaviaAssistantService | undefined {
  const mcpUrl =
    environment.SAVIA_MCP_URL?.trim() ??
    (environment.MCP ? "https://savia-mcp.internal/mcp" : undefined);
  const mcpSharedSecret = environment.SAVIA_MCP_SHARED_SECRET?.trim();
  if (!mcpUrl || !mcpSharedSecret) return undefined;
  return new SaviaAssistantService(
    {
      database: environment.DB,
      mcpUrl,
      mcpFetch: environment.MCP?.fetch.bind(environment.MCP) as
        typeof fetch | undefined,
      mcpSharedSecret,
      openRouterApiKey: environment.OPENROUTER_API_KEY?.trim(),
      openRouterModel: environment.OPENROUTER_MODEL?.trim(),
    },
    {
      configurationResolver: configuration,
      virtualEmployeesRepo: new VirtualEmployeesRepository(environment.DB),
      ragEnv: {
        DB: environment.DB,
        DOCUMENTS: environment.DOCUMENTS,
        AI: (environment as any).AI,
        VECTORIZE: (environment as any).VECTORIZE,
      },
    },
  );
}

export function assistantRuntimeFromEnvironment(
  environment: Pick<
    RuntimeEnvironment,
    "DB" | "DOCUMENTS" | "COMPANION_STT_MODEL"
  > &
    AssistantSecrets,
): {
  configuration: AssistantConfigurationRepository;
  service: SaviaAssistantService | undefined;
} {
  const configuration = assistantConfigurationFromEnvironment(environment);
  return {
    configuration,
    service: assistantServiceFromEnvironment(environment, configuration),
  };
}

async function runScheduledAuditRetention(db: D1Database): Promise<void> {
  const report = await purgeStudioAudit(db);
  if (report.deleted > 0)
    console.info(JSON.stringify({ event: "studio_audit_cleanup", ...report }));
}

export type RuntimeOverrides = {
  workflowFetch?: typeof fetch;
  jiraPrivacyFetch?: typeof fetch;
  realtime?: import("./realtime/hub-client").RealtimeHubClient;
  publicForms?: import("./public-forms/routes").PublicFormsOptions;
  signing?: R2SigningCredentials;
  collectionGatewayFactory?: typeof import("./studio/collection-gateway").createCollectionGateway;
  pagesSearchSchedule?: PagesSearchBindings["schedule"];
};
export function createApiRuntime(
  environment: RuntimeEnvironment,
  overrides: RuntimeOverrides = {},
) {
  return {
    fetch(request: Request, context?: ExecutionContext) {
      return runtime.fetch(request, environment, overrides, context);
    },
    scheduled() {
      return runtime.scheduled(
        undefined as unknown as ScheduledController,
        environment,
        overrides,
      );
    },
  };
}
const runtime = {
  async fetch(
    request: Request,
    environment: RuntimeEnvironment,
    overrides: RuntimeOverrides = {},
    context?: ExecutionContext,
  ): Promise<Response> {
    const mcp = await remoteMcpResponse(request, environment);
    if (mcp) return mcp;
    const assistant = assistantRuntimeFromEnvironment(environment);
    const identityBridgeKey = await identityAdministrationBridgeKey(
      environment.SAVIA_INTERNAL_BRIDGE_KEY,
      environment.SAVIA_MCP_SHARED_SECRET,
    );
    const pagesSearchSchedule =
      overrides.pagesSearchSchedule ?? context?.waitUntil.bind(context);
    const response = await createApp(
      environment.DB,
      environment.DOCUMENTS,
      overrides.signing ?? signingCredentials(environment),
      undefined,
      betterAuthUserAdministrator(environment.AUTH, identityBridgeKey),
      undefined,
      environment.AUTH,
      oauthResourceAuthenticator(environment),
      undefined,
      publicAuthUrls(request.url, environment.SAVIA_PUBLIC_ORIGIN),
      assistant.service,
      crmRoutesFromEnvironment(environment),
      assistant.configuration,
      undefined,
      environment.SAVIA_REQUEST,
      personalIntegrationRoutesFromEnvironment(environment),
      studioIntegrationKeyFromEnvironment(environment),
      undefined,
      sqlBridgeFromEnvironment(environment),
      connectorExecutorFromEnvironment(environment),
      extensionConnectionsEncryptionKeyFromEnvironment(environment),
      overrides.realtime ?? createRealtimeHubClient(environment.REALTIME_HUB),
      {
        siteKey: environment.TURNSTILE_SITE_KEY,
        secretKey: environment.TURNSTILE_SECRET_KEY,
        publicOrigin: environment.SAVIA_PUBLIC_ORIGIN,
        disableCaptcha: environment.SAVIA_DISABLE_CAPTCHA === "1",
        rateLimiter: environment.PUBLIC_FORMS_RATE_LIMITER,
        ...(environment.SAVIA_PUBLIC_ORIGIN &&
        !isLocalPublicOrigin(environment.SAVIA_PUBLIC_ORIGIN) &&
        environment.SHLINK_SERVER_URL &&
        environment.SHLINK_API_KEY
          ? {
              shortener: createShlinkShortener({
                serverUrl: environment.SHLINK_SERVER_URL,
                apiKey: environment.SHLINK_API_KEY,
              }),
            }
          : {}),
        // Local-only provider simulation (fixture data, no provider calls).
        // The localhost gate keeps preview and production untouched even if
        // the flag ever leaks into another environment.
        ...(environment.SAVIA_MOCK_QUOTES === "1" &&
        isLocalPublicOrigin(environment.SAVIA_PUBLIC_ORIGIN)
          ? {
              quote: createPublicQuoteAdapter({
                executor: connectorExecutorFromEnvironment(environment),
                encryptionKey:
                  extensionConnectionsEncryptionKeyFromEnvironment(environment),
                mockProviders: true,
              }),
            }
          : {}),
        ...overrides.publicForms,
      },
      (context) =>
        (overrides.collectionGatewayFactory ?? createCollectionGateway)({
          ...context,
          pluginRegistry: runtimePluginRegistryForTenant(
            environment.PLUGIN_REGISTRY_TENANTS,
            context.tenant,
          ),
        }),
      identityBridgeKey,
      {
        enabled: environment.COMPANION_ENABLED === "true",
        storage: environment.DOCUMENTS,
        sttModel: environment.COMPANION_STT_MODEL,
        configuration: assistant.configuration,
      },
      {
        AI: (environment as RuntimeEnvironment & PagesSearchBindings).AI,
        PAGES_SEARCH_RATE_LIMITER: (
          environment as RuntimeEnvironment & PagesSearchBindings
        ).PAGES_SEARCH_RATE_LIMITER,
        PAGES_VECTORIZE: (
          environment as RuntimeEnvironment & PagesSearchBindings
        ).PAGES_VECTORIZE,
        ...(pagesSearchSchedule ? { schedule: pagesSearchSchedule } : {}),
      },
    ).fetch(request, environment);
    return response;
  },
  async scheduled(
    _event: ScheduledController,
    environment: RuntimeEnvironment,
    overrides: RuntimeOverrides = {},
  ): Promise<void> {
    const realtime = createRealtimeHubClient(environment.REALTIME_HUB);
    const runBookings = async () => {
      const bridgeKey = await identityAdministrationBridgeKey(
        environment.SAVIA_INTERNAL_BRIDGE_KEY,
        environment.SAVIA_MCP_SHARED_SECRET,
      );
      const timedFetch: typeof fetch = (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(15000) });
      const availability =
        environment.AUTH && bridgeKey
          ? async (tenantId: number) => {
              const response = await environment.AUTH!.fetch(
                new Request(
                  `https://savia-auth.internal/_internal/tenant-email/${tenantId}/availability`,
                  {
                    method: "GET",
                    headers: { "x-savia-bridge-key": bridgeKey },
                    signal: AbortSignal.timeout(15000),
                  },
                ),
              );
              if (!response.ok)
                throw new Error("Booking email availability unavailable");
              const result = (await response.json()) as {
                available?: unknown;
              };
              if (typeof result.available !== "boolean")
                throw new Error("Invalid booking email availability response");
              return result.available;
            }
          : undefined;
      return runBookingJobs(environment.DB, {
        publicOrigin:
          environment.SAVIA_PUBLIC_ORIGIN ?? "http://localhost:5173",
        calendar: createBookingCalendarAdapter(
          environment.DB,
          createPersonalIntegrationNangoClient(
            nangoConfigurationFromEnvironment(environment),
            timedFetch,
          ),
        ),
        ...(environment.AUTH && bridgeKey
          ? {
              ...(availability ? { mailAvailability: availability } : {}),
              sendMail: async (mail: {
                tenantId: number;
                to: string;
                subject: string;
                text: string;
              }) => {
                const response = await environment.AUTH!.fetch(
                  new Request(
                    `https://savia-auth.internal/_internal/tenant-email/${mail.tenantId}/send`,
                    {
                      method: "POST",
                      headers: {
                        "x-savia-bridge-key": bridgeKey,
                        "content-type": "application/json",
                      },
                      body: JSON.stringify({
                        to: mail.to,
                        subject: mail.subject,
                        text: mail.text,
                      }),
                      signal: AbortSignal.timeout(15000),
                    },
                  ),
                );
                if (!response.ok) throw new Error("Booking email unavailable");
              },
            }
          : {}),
      });
    };
    if (environment.SAVIA_WORKFLOW_ONLY_SCHEDULE === "true") {
      const results = await Promise.allSettled([
        runBookings(),
        runScheduledWorkflows(
          environment.DB,
          studioIntegrationKeyFromEnvironment(environment),
          overrides.workflowFetch,
          realtime,
        ),
        runScheduledNotifications(environment.DB, realtime),
        runScheduledAuditRetention(environment.DB),
        runJiraPrivacyMaintenance(
          environment.DB,
          nangoConfigurationFromEnvironment(environment),
          createPersonalIntegrationNangoClient(
            nangoConfigurationFromEnvironment(environment),
            overrides.jiraPrivacyFetch,
          ),
        ),
      ]);
      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length)
        throw new AggregateError(
          failures.map((result) => result.reason),
          "Scheduled jobs failed",
        );
      return;
    }
    const results = await Promise.allSettled([
      runBookings(),
      runScheduledWorkflows(
        environment.DB,
        studioIntegrationKeyFromEnvironment(environment),
        overrides.workflowFetch,
        realtime,
      ),
      runScheduledNotifications(environment.DB, realtime),
      runScheduledAuditRetention(environment.DB),
      runJiraPrivacyMaintenance(
        environment.DB,
        nangoConfigurationFromEnvironment(environment),
        createPersonalIntegrationNangoClient(
          nangoConfigurationFromEnvironment(environment),
          overrides.jiraPrivacyFetch,
        ),
      ),
      maintainRecordHistory(environment.DB).then((report) => {
        console.info(
          JSON.stringify({ event: "record_history_cleanup", ...report }),
        );
        return report;
      }),
    ]);
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length)
      throw new AggregateError(
        failures.map((result) => result.reason),
        "Scheduled jobs failed",
      );
  },
};

export default runtime;
