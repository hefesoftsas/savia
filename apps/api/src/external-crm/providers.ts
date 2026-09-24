import { type CrmProviderDefinition, type CrmProviderId } from "./contracts";
import type { NangoConfiguration } from "./nango";

function configured(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isHubSpotNangoConfigured(
  configuration: NangoConfiguration,
): boolean {
  return (
    configured(configuration.baseUrl) &&
    configured(configuration.apiKey) &&
    configured(configuration.hubspotIntegrationId)
  );
}

export function createCrmProviderRegistry(
  configuration: NangoConfiguration,
): Record<CrmProviderId, CrmProviderDefinition> {
  return {
    hubspot: {
      id: "hubspot",
      displayName: "HubSpot",
      availability: isHubSpotNangoConfigured(configuration)
        ? "enabled"
        : "unavailable",
      capabilities: [
        "contacts:read",
        "contacts:write",
        "companies:read",
        "deals:read",
      ],
      integrationId: configured(configuration.hubspotIntegrationId)
        ? configuration.hubspotIntegrationId.trim()
        : undefined,
    },
    salesforce: {
      id: "salesforce",
      displayName: "Salesforce",
      availability: "coming_soon",
      capabilities: [],
    },
    zoho: {
      id: "zoho",
      displayName: "Zoho CRM",
      availability: "coming_soon",
      capabilities: [],
    },
    pipedrive: {
      id: "pipedrive",
      displayName: "Pipedrive",
      availability: "coming_soon",
      capabilities: [],
    },
  };
}
