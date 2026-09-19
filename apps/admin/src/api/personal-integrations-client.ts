import type { ApiClient } from "./api-client";

export type PersonalIntegrationProviderId =
  | "google_drive"
  | "gmail"
  | "google_calendar"
  | "outlook"
  | "onedrive_personal"
  | "onedrive_business";
export type PersonalIntegrationAvailability = "enabled" | "unavailable";
export type PersonalIntegrationConnectionStatus =
  | "pending"
  | "connected"
  | "reconnect_required"
  | "disconnected"
  | "failed";

export type PersonalIntegrationProvider = {
  id: PersonalIntegrationProviderId;
  displayName: string;
  availability: PersonalIntegrationAvailability;
  capabilities: string[];
};

export type PersonalIntegrationConnection = {
  id: string;
  provider: PersonalIntegrationProviderId;
  status: PersonalIntegrationConnectionStatus;
  externalAccountLabel: string | null;
  scopes: string[];
  lastValidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PersonalIntegrationConnectSession = {
  token: string;
  expiresAt: string;
  connectUrl: string;
  apiUrl: string;
};

export type PersonalCalendarEvent = {
  id: string;
  title: string | null;
  startsAt: string | null;
  endsAt: string | null;
  webLink: string | null;
};
export type PersonalCalendarProvider = "google_calendar" | "outlook";

type ProviderDocument = {
  id: PersonalIntegrationProviderId;
  kind: "personal-integration-provider";
  attributes: Omit<PersonalIntegrationProvider, "id">;
};
type ConnectionDocument = {
  id: string;
  kind: "personal-integration-connection";
  attributes: Omit<PersonalIntegrationConnection, "id">;
};

function providerFromDocument(document: ProviderDocument): PersonalIntegrationProvider {
  return { id: document.id, ...document.attributes };
}

function connectionFromDocument(
  document: ConnectionDocument,
): PersonalIntegrationConnection {
  return { id: document.id, ...document.attributes };
}

function providerPath(provider: PersonalIntegrationProviderId): string {
  return encodeURIComponent(provider);
}

export class PersonalIntegrationsClient {
  constructor(private readonly api: ApiClient) {}

  async listProviders(): Promise<PersonalIntegrationProvider[]> {
    const response = await this.api.get<{ data: ProviderDocument[] }>(
      "/v1/personal-integrations/providers",
    );
    return response.data.map(providerFromDocument);
  }

  async listConnections(): Promise<PersonalIntegrationConnection[]> {
    const response = await this.api.get<{ data: ConnectionDocument[] }>(
      "/v1/personal-integrations/connections",
    );
    return response.data.map(connectionFromDocument);
  }

  async createConnectSession(
    provider: PersonalIntegrationProviderId,
    reconnect: boolean,
  ): Promise<PersonalIntegrationConnectSession> {
    return (
      await this.api.post<{ data: PersonalIntegrationConnectSession }>(
        `/v1/personal-integrations/connections/${providerPath(provider)}/${reconnect ? "reconnect-session" : "connect-session"}`,
      )
    ).data;
  }

  async complete(
    provider: PersonalIntegrationProviderId,
    connectionId: string,
  ): Promise<PersonalIntegrationConnection> {
    return connectionFromDocument(
      (
        await this.api.post<{ data: ConnectionDocument }>(
          `/v1/personal-integrations/connections/${providerPath(provider)}/complete`,
          { connectionId },
        )
      ).data,
    );
  }

  disconnect(provider: PersonalIntegrationProviderId): Promise<void> {
    return this.api.delete(
      `/v1/personal-integrations/connections/${providerPath(provider)}`,
    );
  }

  async listEvents(input: {
    provider: PersonalCalendarProvider;
    from?: string;
    to?: string;
  }): Promise<PersonalCalendarEvent[]> {
    const query = new URLSearchParams({ provider: input.provider });
    if (input.from) query.set("from", input.from);
    if (input.to) query.set("to", input.to);
    return (
      await this.api.get<{ data: PersonalCalendarEvent[] }>(
        `/v1/personal-integrations/events?${query.toString()}`,
      )
    ).data;
  }

  async createCalendarEvent(input: {
    provider: PersonalCalendarProvider;
    title: string;
    startsAt: string;
    endsAt: string;
  }): Promise<PersonalCalendarEvent> {
    return (
      await this.api.post<{ data: PersonalCalendarEvent }>(
        "/v1/personal-integrations/events",
        input,
      )
    ).data;
  }
}
