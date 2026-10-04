import { createNangoClient, type NangoConfiguration } from "./nango";
import { createCrmProviderRegistry } from "./providers";
import { createHubSpotAdapter } from "./hubspot";
import { createRemoteCrmAdapter } from "./remote-crm";
import type { CrmRouteDependencies } from "../routes/crm";
export type CrmSecrets = {
  NANGO_BASE_URL?: string;
  NANGO_CONNECT_URL?: string;
  NANGO_API_KEY?: string;
  NANGO_HUBSPOT_INTEGRATION_ID?: string;
  NANGO_SALESFORCE_INTEGRATION_ID?: string;
  NANGO_ZOHO_INTEGRATION_ID?: string;
  NANGO_PIPEDRIVE_INTEGRATION_ID?: string;
  NANGO_GOOGLE_DRIVE_INTEGRATION_ID?: string;
  NANGO_GMAIL_INTEGRATION_ID?: string;
  NANGO_GOOGLE_CALENDAR_INTEGRATION_ID?: string;
  NANGO_OUTLOOK_INTEGRATION_ID?: string;
  NANGO_ONEDRIVE_PERSONAL_INTEGRATION_ID?: string;
  NANGO_ONEDRIVE_BUSINESS_INTEGRATION_ID?: string;
  NANGO_JIRA_INTEGRATION_ID?: string;
  NANGO_JIRA_REPORTING_CONNECTION_ID?: string;
  NANGO_LINEAR_INTEGRATION_ID?: string;
  NANGO_GITHUB_INTEGRATION_ID?: string;
  NANGO_ZOOM_INTEGRATION_ID?: string;
  NANGO_SLACK_INTEGRATION_ID?: string;
  NANGO_MICROSOFT_TEAMS_INTEGRATION_ID?: string;
};

export function nangoConfigurationFromEnvironment(
  environment: CrmSecrets,
): NangoConfiguration {
  return {
    baseUrl: environment.NANGO_BASE_URL,
    connectUrl: environment.NANGO_CONNECT_URL,
    apiKey: environment.NANGO_API_KEY,
    hubspotIntegrationId: environment.NANGO_HUBSPOT_INTEGRATION_ID,
    salesforceIntegrationId: environment.NANGO_SALESFORCE_INTEGRATION_ID,
    zohoIntegrationId: environment.NANGO_ZOHO_INTEGRATION_ID,
    pipedriveIntegrationId: environment.NANGO_PIPEDRIVE_INTEGRATION_ID,
    googleDriveIntegrationId: environment.NANGO_GOOGLE_DRIVE_INTEGRATION_ID,
    gmailIntegrationId: environment.NANGO_GMAIL_INTEGRATION_ID,
    googleCalendarIntegrationId:
      environment.NANGO_GOOGLE_CALENDAR_INTEGRATION_ID,
    outlookIntegrationId: environment.NANGO_OUTLOOK_INTEGRATION_ID,
    oneDrivePersonalIntegrationId:
      environment.NANGO_ONEDRIVE_PERSONAL_INTEGRATION_ID,
    oneDriveBusinessIntegrationId:
      environment.NANGO_ONEDRIVE_BUSINESS_INTEGRATION_ID,
    jiraIntegrationId: environment.NANGO_JIRA_INTEGRATION_ID,
    jiraReportingConnectionId: environment.NANGO_JIRA_REPORTING_CONNECTION_ID,
    linearIntegrationId: environment.NANGO_LINEAR_INTEGRATION_ID,
    githubIntegrationId: environment.NANGO_GITHUB_INTEGRATION_ID,
    zoomIntegrationId: environment.NANGO_ZOOM_INTEGRATION_ID,
    slackIntegrationId: environment.NANGO_SLACK_INTEGRATION_ID,
    microsoftTeamsIntegrationId:
      environment.NANGO_MICROSOFT_TEAMS_INTEGRATION_ID,
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
    adapters: {
      hubspot: createHubSpotAdapter(nango),
      salesforce: createRemoteCrmAdapter("salesforce", nango),
      zoho: createRemoteCrmAdapter("zoho", nango),
      pipedrive: createRemoteCrmAdapter("pipedrive", nango),
    },
  };
}
