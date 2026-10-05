import { CompanionService } from "../companion/service";
import { whatsappIntakeContributions } from "@savia/release-catalog/whatsapp";
import {
  sendNativeMessage,
  sendReadIndicator,
  defaultNativeConfiguration,
} from "./native";
import { createWhatsappMediaInput } from "./media-input";
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
  environment: WhatsappSecrets & {
    DB: D1Database;
    DOCUMENTS: R2Bucket;
    COMPANION_STT_MODEL?: string;
  },
  configuration: AssistantConfigurationRepository,
) {
  const repository = new WhatsappInboundRepository(environment.DB);
  const nango = createWhatsappNangoClient(
    whatsappNangoConfigurationFromEnvironment(environment),
  );
  const generate = createWhatsappAssistant({
    configuration,
    prepareInput: createWhatsappMediaInput(
      nango,
      environment.DOCUMENTS,
      new CompanionService({ sttModel: environment.COMPANION_STT_MODEL }),
    ),
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
    process: async () => {
      return processWhatsappInbox(
        repository,
        {
          generate,
          indicator: async (binding, messageId) => {
            if (binding.native?.readReceipts || binding.native?.typingIndicator)
              await sendReadIndicator(
                nango,
                binding,
                messageId,
                Boolean(binding.native.typingIndicator),
              );
          },
          send: (binding, text, contactPhone, input) =>
            typeof text === "string"
              ? sendWhatsappReply(nango, binding, text, contactPhone)
              : sendNativeMessage(
                  nango,
                  binding,
                  text,
                  binding.native ?? defaultNativeConfiguration,
                  contactPhone,
                  async () => {
                    const current = await repository.resolve(
                      binding.connection.phoneNumberId!,
                      binding.connection.wabaId!,
                    );
                    if (
                      !current ||
                      current.tenantId !== binding.tenantId ||
                      current.connectionId !== binding.connectionId ||
                      current.employeeId !== binding.employeeId ||
                      current.ownerPrincipalId !== binding.ownerPrincipalId ||
                      JSON.stringify(current.native) !==
                        JSON.stringify(binding.native) ||
                      !current.allowedContacts.includes(
                        contactPhone.replace(/\D/g, ""),
                      ) ||
                      !input ||
                      !(await repository.isWithinReplyWindow(input.messageId))
                    )
                      throw new Error("WHATSAPP_NATIVE_DISPATCH_REVOKED");
                  },
                ),
        },
        5,
      );
    },
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
    nativeContributions: whatsappIntakeContributions.map(
      ({ flowJson, pluginId, solutionId, bundleId, title }) => ({
        flowJson,
        pluginId,
        solutionId,
        bundleId,
        title,
      }),
    ),
  };
}
