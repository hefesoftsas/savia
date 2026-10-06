import { cleanupChannelState } from "./channel-cleanup";
import { deliverChannelActionResults } from "./action-results";
import {
  createChannelOperationAdapter,
  type ChannelOperationDependencies,
} from "../assistant/operation-adapter";
import { processChannelActions } from "./action-jobs";
import { WhatsappChannelRepository } from "./channel-repository";
import { createRoutedWhatsappGenerator } from "./channel-runtime";
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
import { drainWhatsappInbox, processWhatsappInbox } from "./inbound-processor";
import { createWhatsappAssistant, sendWhatsappReply } from "./assistant";
import { humanSupportRecoveryReply } from "./human-support";
import { VirtualEmployeesRepository } from "../assistant/virtual-employees";
import { retrieveRelevantChunks, type RagEnvironment } from "../assistant/rag";
import type { AssistantConfigurationRepository } from "../assistant/configuration";

export type WhatsappSecrets = {
  WHATSAPP_PROCESSING_MODE?: string;
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
  channelOptions?: Omit<ChannelOperationDependencies, "repository">,
) {
  const repository = new WhatsappInboundRepository(environment.DB);
  const nango = createWhatsappNangoClient(
    whatsappNangoConfigurationFromEnvironment(environment),
  );
  const channelRepository = new WhatsappChannelRepository(environment.DB);
  const operations = channelOptions
    ? createChannelOperationAdapter({
        ...channelOptions,
        repository: channelRepository,
      })
    : undefined;
  const humanSupportContact = async (
    binding: import("./inbound-contracts").WhatsappAssistantBinding,
  ) => {
    try {
      return (
        (
          await channelRepository.settings(
            binding.tenantId,
            binding.connectionId,
          )
        )?.config.humanSupportContact ?? ""
      );
    } catch {
      return "";
    }
  };
  const generate = createWhatsappAssistant({
    humanSupportContact,
    ...(operations ? { capabilities: operations.capabilities } : {}),
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
  const routed = createRoutedWhatsappGenerator(channelRepository, generate);
  return {
    repository,
    processActions: async () => {
      if (!operations?.actions) return { completed: 0, uncertain: 0 };
      await cleanupChannelState(channelRepository);
      const report = await processChannelActions(
        operations.actions,
        async (action) => {
          const row = await environment.DB.prepare(
            "SELECT phone_number_id,waba_id FROM tenant_whatsapp_connections WHERE id=? AND tenant_id=?",
          )
            .bind(
              action.session.access.connectionId,
              action.session.access.tenantId,
            )
            .first<{ phone_number_id: string; waba_id: string }>();
          const binding = row
            ? await repository.resolve(row.phone_number_id, row.waba_id)
            : null;
          if (
            !binding ||
            !binding.allowedContacts.includes(action.session.access.contact)
          )
            throw new Error("CHANNEL_BINDING_REVOKED");
          return operations.execute(binding, action);
        },
      );
      await deliverChannelActionResults(
        channelRepository,
        async (connectionId, tenantId) => {
          const row = await environment.DB.prepare(
            "SELECT phone_number_id,waba_id FROM tenant_whatsapp_connections WHERE id=? AND tenant_id=?",
          )
            .bind(connectionId, tenantId)
            .first<{ phone_number_id: string; waba_id: string }>();
          return row
            ? repository.resolve(row.phone_number_id, row.waba_id)
            : undefined;
        },
        (binding, text, phone) =>
          sendWhatsappReply(nango, binding, text, phone),
      );
      return report;
    },
    appSecret: environment.WHATSAPP_META_APP_SECRET?.trim(),
    verifyToken: environment.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim(),
    deferProcessing: environment.WHATSAPP_PROCESSING_MODE === "scheduled",
    process: async (options?: { scheduled?: boolean }) => {
      const processingDependencies = {
        recoveryReply: async (binding) =>
          humanSupportRecoveryReply(await humanSupportContact(binding)),
        generate: routed.generate,
        authorizeReply: routed.authorizeReply,
        afterReply: routed.afterReply,
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
                    !(await repository.isWithinReplyWindow(input))
                  )
                    throw new Error("WHATSAPP_NATIVE_DISPATCH_REVOKED");
                },
              ),
      } satisfies import("./inbound-contracts").WhatsappInboundDependencies;
      return options?.scheduled
        ? drainWhatsappInbox(repository, processingDependencies)
        : processWhatsappInbox(repository, processingDependencies, 5);
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
