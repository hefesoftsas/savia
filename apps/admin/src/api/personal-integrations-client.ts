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
  private connectionsPromise: Promise<PersonalIntegrationConnection[]> | null =
    null;
  private connectionsCache: {
    data: PersonalIntegrationConnection[];
    timestamp: number;
  } | null = null;
  private eventsInflight = new Map<
    string,
    Promise<PersonalCalendarEvent[]>
  >();

  async listProviders(): Promise<PersonalIntegrationProvider[]> {
    const response = await this.api.get<{ data: ProviderDocument[] }>(
      "/v1/personal-integrations/providers",
    );
    return response.data.map(providerFromDocument);
  }

  async listConnections(): Promise<PersonalIntegrationConnection[]> {
    // Mi día monta dos useMyDayAgenda a la vez (página + sección): comparte
    // el vuelo y cachea 15s para no duplicar /connections ni /events x2.
    if (
      this.connectionsCache &&
      Date.now() - this.connectionsCache.timestamp < 15_000
    ) {
      return this.connectionsCache.data;
    }
    if (this.connectionsPromise) {
      return this.connectionsPromise;
    }
    this.connectionsPromise = this.api
      .get<{ data: ConnectionDocument[] }>(
        "/v1/personal-integrations/connections",
      )
      .then((response) => {
        const data = response.data.map(connectionFromDocument);
        this.connectionsCache = { data, timestamp: Date.now() };
        this.connectionsPromise = null;
        return data;
      })
      .catch((err) => {
        this.connectionsPromise = null;
        throw err;
      });
    return this.connectionsPromise;
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
    const path = `/v1/personal-integrations/events?${query.toString()}`;
    const inflight = this.eventsInflight.get(path);
    if (inflight) return inflight;
    const promise = this.api
      .get<{ data: PersonalCalendarEvent[] }>(path)
      .then((response) => {
        this.eventsInflight.delete(path);
        return response.data;
      })
      .catch((err) => {
        this.eventsInflight.delete(path);
        throw err;
      });
    this.eventsInflight.set(path, promise);
    return promise;
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
