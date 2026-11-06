import type { WhatsappProviderDefinition } from "./contracts";
import type { WhatsappNangoConfiguration } from "./nango";
import { isWhatsappNangoConfigured } from "./nango";

function trimmed(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

export function createWhatsappProviderRegistry(
  configuration: WhatsappNangoConfiguration,
): WhatsappProviderDefinition {
  const configured = isWhatsappNangoConfigured(configuration);
  return {
    id: "whatsapp",
    displayName: "WhatsApp",
    availability: configured ? "enabled" : "unavailable",
    capabilities: ["messages:read", "messages:write", "templates:read"],
    integrationId: trimmed(configuration.whatsappIntegrationId),
  };
}
