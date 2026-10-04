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

function integrationConfigured(
  configuration: NangoConfiguration,
  key:
    "salesforceIntegrationId" | "zohoIntegrationId" | "pipedriveIntegrationId",
): boolean {
  return (
    configured(configuration.baseUrl) &&
    configured(configuration.apiKey) &&
    configured(configuration[key])
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
      availability: integrationConfigured(
        configuration,
        "salesforceIntegrationId",
      )
        ? "enabled"
        : "unavailable",
      capabilities: integrationConfigured(
        configuration,
        "salesforceIntegrationId",
      )
        ? [
            "contacts:read",
            "contacts:write",
            "companies:read",
            "companies:write",
            "deals:read",
            "deals:write",
          ]
        : [],
      integrationId: configured(configuration.salesforceIntegrationId)
        ? configuration.salesforceIntegrationId.trim()
        : undefined,
    },
    zoho: {
      id: "zoho",
      displayName: "Zoho CRM",
      availability: integrationConfigured(configuration, "zohoIntegrationId")
        ? "enabled"
        : "unavailable",
      capabilities: integrationConfigured(configuration, "zohoIntegrationId")
        ? [
            "contacts:read",
            "contacts:write",
            "companies:read",
            "companies:write",
            "deals:read",
            "deals:write",
          ]
        : [],
      integrationId: configured(configuration.zohoIntegrationId)
        ? configuration.zohoIntegrationId.trim()
        : undefined,
    },
    pipedrive: {
      id: "pipedrive",
      displayName: "Pipedrive",
      availability: integrationConfigured(
        configuration,
        "pipedriveIntegrationId",
      )
        ? "enabled"
        : "unavailable",
      capabilities: integrationConfigured(
        configuration,
        "pipedriveIntegrationId",
      )
        ? [
            "contacts:read",
            "contacts:write",
            "companies:read",
            "companies:write",
            "deals:read",
            "deals:write",
          ]
        : [],
      integrationId: configured(configuration.pipedriveIntegrationId)
        ? configuration.pipedriveIntegrationId.trim()
        : undefined,
    },
  };
}
