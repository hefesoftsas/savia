import {
  createWhatsappNangoClient,
  type WhatsappNangoConfiguration,
} from "./nango";
import { createWhatsappProviderRegistry } from "./providers";
import type { WhatsappRouteDependencies } from "../routes/whatsapp";

export type WhatsappSecrets = {
  NANGO_BASE_URL?: string;
  NANGO_CONNECT_URL?: string;
  NANGO_API_KEY?: string;
  NANGO_WHATSAPP_INTEGRATION_ID?: string;
};

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
