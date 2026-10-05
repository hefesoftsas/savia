import {
  createWhatsappNangoClient,
  type WhatsappNangoConfiguration,
} from "./nango";
import { createWhatsappProviderRegistry } from "./providers";
import type { WhatsappRouteDependencies } from "../routes/whatsapp";
import { WhatsappInboundRepository } from "./inbound-repository";
import { processWhatsappInbox } from "./inbound-processor";
import { createWhatsappAssistant, sendWhatsappReply } from "./assistant";
import { VirtualEmployeesRepository } from "../assistant/virtual-employees";
import { retrieveRelevantChunks, type RagEnvironment } from "../assistant/rag";
import type { AssistantConfigurationRepository } from "../assistant/configuration";

export type WhatsappSecrets = {
  WHATSAPP_META_APP_SECRET?: string;
  WHATSAPP_WEBHOOK_VERIFY_TOKEN?: string;
  NANGO_BASE_URL?: string;
  NANGO_CONNECT_URL?: string;
  NANGO_API_KEY?: string;
  NANGO_WHATSAPP_INTEGRATION_ID?: string;
};

export function whatsappInboundFromEnvironment(
  environment: WhatsappSecrets & { DB: D1Database; DOCUMENTS: R2Bucket },
  configuration: AssistantConfigurationRepository,
) {
  const repository = new WhatsappInboundRepository(environment.DB);
  const nango = createWhatsappNangoClient(
    whatsappNangoConfigurationFromEnvironment(environment),
  );
  const generate = createWhatsappAssistant({
    configuration,
    employees: new VirtualEmployeesRepository(environment.DB),
    knowledge: (employeeId, query) =>
      retrieveRelevantChunks(
        environment as RagEnvironment,
        employeeId,
        query,
        4,
      ),
  });
  return {
    repository,
    appSecret: environment.WHATSAPP_META_APP_SECRET?.trim(),
    verifyToken: environment.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim(),
    process: () =>
      processWhatsappInbox(
        repository,
        {
          generate,
          send: (binding, text, contactPhone) =>
            sendWhatsappReply(nango, binding, text, contactPhone),
        },
        5,
      ),
  };
}

export function whatsappNangoConfigurationFromEnvironment(
  environment: WhatsappSecrets,
): WhatsappNangoConfiguration {
  return {
    baseUrl: environment.NANGO_BASE_URL,
    connectUrl: environment.NANGO_CONNECT_URL,
    apiKey: environment.NANGO_API_KEY,
    whatsappIntegrationId: environment.NANGO_WHATSAPP_INTEGRATION_ID,
  };
}

export function whatsappRoutesFromEnvironment(
  environment: WhatsappSecrets,
): WhatsappRouteDependencies {
  const configuration = whatsappNangoConfigurationFromEnvironment(environment);
  return {
    nango: createWhatsappNangoClient(configuration),
    provider: createWhatsappProviderRegistry(configuration),
  };
}
