import type { NangoConfiguration } from "../external-crm/nango";
import type {
  PersonalIntegrationProviderDefinition,
  PersonalIntegrationProviderId,
} from "./contracts";

function configured(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

type ProviderTemplate = Omit<
  PersonalIntegrationProviderDefinition,
  "availability" | "integrationId"
> & {
  integrationId: (configuration: NangoConfiguration) => string | undefined;
};

const providerTemplates: readonly ProviderTemplate[] = [
  {
    id: "google_drive",
    displayName: "Google Drive",
    capabilities: ["files:read", "files:upload"],
    integrationId: (configuration) =>
      configured(configuration.googleDriveIntegrationId),
  },
  {
    id: "gmail",
    displayName: "Gmail",
    capabilities: ["messages:read", "messages:send"],
    integrationId: (configuration) => configured(configuration.gmailIntegrationId),
  },
  {
    id: "google_calendar",
    displayName: "Google Calendar",
    capabilities: ["events:read", "events:create"],
    integrationId: (configuration) =>
      configured(configuration.googleCalendarIntegrationId),
  },
  {
    id: "outlook",
    displayName: "Outlook",
    capabilities: ["messages:read", "messages:send", "events:read", "events:create"],
    integrationId: (configuration) => configured(configuration.outlookIntegrationId),
  },
  {
    id: "onedrive_personal",
    displayName: "OneDrive Personal",
    capabilities: ["files:read", "files:upload"],
    integrationId: (configuration) =>
      configured(configuration.oneDrivePersonalIntegrationId),
  },
  {
    id: "onedrive_business",
    displayName: "OneDrive for Business",
    capabilities: ["files:read", "files:upload"],
    integrationId: (configuration) =>
      configured(configuration.oneDriveBusinessIntegrationId),
  },
];

export function createPersonalIntegrationProviderRegistry(
  configuration: NangoConfiguration,
): Record<PersonalIntegrationProviderId, PersonalIntegrationProviderDefinition> {
  return Object.fromEntries(
    providerTemplates.map((template) => {
      const integrationId = template.integrationId(configuration);
      return [
        template.id,
        {
          id: template.id,
          displayName: template.displayName,
          capabilities: template.capabilities,
          availability: integrationId ? "enabled" : "unavailable",
          ...(integrationId ? { integrationId } : {}),
        },
      ];
    }),
  ) as Record<PersonalIntegrationProviderId, PersonalIntegrationProviderDefinition>;
}
