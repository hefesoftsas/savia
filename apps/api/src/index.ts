import { remoteMcpResponse } from "./mcp-gateway";
import { maintainRecordHistory } from "@savia/crm-server/record-history-storage";
import { createApp } from "./app";
import { createRealtimeHubClient } from "./realtime/hub-client";
export { RealtimeHub } from "./realtime/hub";
import { processCrmSyncJobs } from "./crm/auto-sync";
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
} from "./crm/runtime";
import {
  createSqlBridgeClient,
  sqlBridgeFromEnvironment,
  type SqlBridgeClient,
  type SqlBridgeSecrets,
} from "./crm/sql-bridge";
import type { R2SigningCredentials } from "./lib/r2-presign";
import { createPersonalIntegrationNangoClient } from "./personal-integrations/nango";
import { createPersonalIntegrationProviderRegistry } from "./personal-integrations/providers";
import { publicAuthUrls } from "./public-origin";
import {
  connectorExecutorFromEnvironment,
  extensionConnectionsEncryptionKeyFromEnvironment,
  type ConnectorGatewayEnvironment,
} from "./crm/connector-executor";
import type { PersonalIntegrationRouteDependencies } from "./routes/personal-integrations";
export { oauthResourceAuthenticator } from "./auth/runtime";
export {
  crmClientFromEnvironment,
  crmRoutesFromEnvironment,
  nangoConfigurationFromEnvironment,
  type CrmSecrets,
} from "./crm/runtime";

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
  CRM_INTEGRATION_KEY?: string;
  ASSISTANT_SETTINGS_ENCRYPTION_KEY?: string;
  SAVIA_MCP_URL?: string;
  SAVIA_MCP_SHARED_SECRET?: string;
  MCP?: { fetch: typeof fetch };
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
};

type RuntimeEnvironment = {
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  PUBLIC_FORMS_RATE_LIMITER?: {
    limit(input: { key: string }): Promise<{ success: boolean }>;
  };
  SAVIA_REQUEST?: import("./routes/savia-request").SaviaRequestService;
} & Env &
  AttachmentSecrets &
  AuthServiceBinding &
  AssistantSecrets &
  CrmSecrets &
  SqlBridgeSecrets &
  ConnectorGatewayEnvironment;

export { sqlBridgeFromEnvironment } from "./crm/sql-bridge";

export function personalIntegrationRoutesFromEnvironment(
  environment: CrmSecrets & Pick<AssistantSecrets, "SAVIA_MCP_SHARED_SECRET">,
): PersonalIntegrationRouteDependencies {
  const mcpSharedSecret = environment.SAVIA_MCP_SHARED_SECRET?.trim();
  return {
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

function signingCredentials(
  environment: Env & AttachmentSecrets,
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

function assistantConfigurationFromEnvironment(
  environment: Env & AssistantSecrets,
): AssistantConfigurationRepository {
  const encryptionKey =
    environment.ASSISTANT_SETTINGS_ENCRYPTION_KEY?.trim() ||
    environment.CRM_INTEGRATION_KEY?.trim() ||
    environment.SAVIA_MCP_SHARED_SECRET?.trim();
  return new AssistantConfigurationRepository(environment.DB, {
    encryptionKey,
    deploymentApiKey: environment.OPENROUTER_API_KEY?.trim(),
    deploymentModel: environment.OPENROUTER_MODEL?.trim(),
  });
}

import { VirtualEmployeesRepository } from "./assistant/virtual-employees";

function assistantServiceFromEnvironment(
  environment: Env & AssistantSecrets,
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
  environment: Env & AssistantSecrets,
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

export async function runScheduledCrmSync(
  environment: RuntimeEnvironment,
): Promise<{ processed: number }> {
  return processCrmSyncJobs(
    environment.DB,
    crmRoutesFromEnvironment(environment),
  );
}

export default {
  async fetch(
    request: Request,
    environment: RuntimeEnvironment,
    context?: ExecutionContext,
  ): Promise<Response> {
    const mcp = await remoteMcpResponse(request, environment);
    if (mcp) return mcp;
    const assistant = assistantRuntimeFromEnvironment(environment);
    const response = await createApp(
      environment.DB,
      environment.DOCUMENTS,
      signingCredentials(environment),
      undefined,
      undefined,
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
      environment.CRM_INTEGRATION_KEY,
      undefined,
      sqlBridgeFromEnvironment(environment),
      connectorExecutorFromEnvironment(environment),
      extensionConnectionsEncryptionKeyFromEnvironment(environment),
      createRealtimeHubClient(environment.REALTIME_HUB),
      {
        siteKey: environment.TURNSTILE_SITE_KEY,
        secretKey: environment.TURNSTILE_SECRET_KEY,
        publicOrigin: environment.SAVIA_PUBLIC_ORIGIN,
        rateLimiter: environment.PUBLIC_FORMS_RATE_LIMITER,
      },
    ).fetch(request, environment);
    return response;
  },
  async scheduled(
    _event: ScheduledController,
    environment: RuntimeEnvironment,
  ): Promise<void> {
    const results = await Promise.allSettled([
      runScheduledCrmSync(environment),
      runScheduledWorkflows(environment.DB),
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
