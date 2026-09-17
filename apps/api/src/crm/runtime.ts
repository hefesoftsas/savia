import { createNangoClient, type NangoConfiguration } from "./nango";
import { createCrmProviderRegistry } from "./providers";
import { createHubSpotAdapter } from "./hubspot";
import type { CrmRouteDependencies } from "../routes/crm";
export type CrmSecrets = {
  NANGO_BASE_URL?: string;
  NANGO_CONNECT_URL?: string;
  NANGO_API_KEY?: string;
  NANGO_HUBSPOT_INTEGRATION_ID?: string;
  NANGO_GOOGLE_DRIVE_INTEGRATION_ID?: string;
  NANGO_GMAIL_INTEGRATION_ID?: string;
  NANGO_GOOGLE_CALENDAR_INTEGRATION_ID?: string;
  NANGO_OUTLOOK_INTEGRATION_ID?: string;
  NANGO_ONEDRIVE_PERSONAL_INTEGRATION_ID?: string;
  NANGO_ONEDRIVE_BUSINESS_INTEGRATION_ID?: string;
};

export function nangoConfigurationFromEnvironment(
  environment: CrmSecrets,
): NangoConfiguration {
  return {
    baseUrl: environment.NANGO_BASE_URL,
    connectUrl: environment.NANGO_CONNECT_URL,
    apiKey: environment.NANGO_API_KEY,
    hubspotIntegrationId: environment.NANGO_HUBSPOT_INTEGRATION_ID,
    googleDriveIntegrationId: environment.NANGO_GOOGLE_DRIVE_INTEGRATION_ID,
    gmailIntegrationId: environment.NANGO_GMAIL_INTEGRATION_ID,
    googleCalendarIntegrationId:
      environment.NANGO_GOOGLE_CALENDAR_INTEGRATION_ID,
    outlookIntegrationId: environment.NANGO_OUTLOOK_INTEGRATION_ID,
    oneDrivePersonalIntegrationId:
      environment.NANGO_ONEDRIVE_PERSONAL_INTEGRATION_ID,
    oneDriveBusinessIntegrationId:
      environment.NANGO_ONEDRIVE_BUSINESS_INTEGRATION_ID,
  };
}

export function crmClientFromEnvironment(environment: CrmSecrets) {
  return createNangoClient(nangoConfigurationFromEnvironment(environment));
}

export function crmRoutesFromEnvironment(
  environment: CrmSecrets,
): CrmRouteDependencies {
  const configuration = nangoConfigurationFromEnvironment(environment);
  const nango = createNangoClient(configuration);
  return {
    nango,
    providers: createCrmProviderRegistry(configuration),
    adapters: { hubspot: createHubSpotAdapter(nango) },
  };
}
