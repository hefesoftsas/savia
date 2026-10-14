import type {
  PersonalMailMessage,
  PersonalMailPage,
  PersonalMailProvider,
  SendPersonalMailInput,
} from "@savia/studio-shared/mail-contracts";
import type { ApiClient } from "./api-client";
import type {
  CalendarSource,
  CalendarSourceEvents,
  CalendarRange,
  CalendarPreferences,
  CreateCalendarSourceInput,
  UpdateCalendarSourceInput,
} from "@savia/studio-shared/calendar-contracts";
import type { BookingAgendaEntry } from "@savia/studio-shared/booking-agenda-contracts";
import type {
  CollaborationChannelPage,
  CollaborationProvider,
  ShareRecordInput,
  ShareRecordResult,
} from "@savia/studio-shared/collaboration-contracts";

export type CalendarSourcesClient = Pick<
  PersonalIntegrationsClient,
  | "listCalendarSources"
  | "createCalendarSource"
  | "updateCalendarSource"
  | "deleteCalendarSource"
  | "listCalendarSourceEvents"
  | "refreshCalendarSource"
  | "getCalendarPreferences"
  | "saveCalendarPreferences"
>;

export type PersonalIntegrationProviderId =
  | "zoom"
  | "google_drive"
  | "gmail"
  | "google_calendar"
  | "outlook"
  | "onedrive_personal"
  | "onedrive_business"
  | "jira"
  | "linear"
  | "github"
  | CollaborationProvider;
export type PersonalIntegrationAvailability = "enabled" | "unavailable";
export type PersonalIntegrationConnectionStatus =
  "pending" | "connected" | "reconnect_required" | "disconnected" | "failed";

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
  connectionId?: string;
  title: string | null;
  startsAt: string | null;
  endsAt: string | null;
  webLink: string | null;
  allDay?: boolean;
  timeZone?: string;
  conference?: PersonalCalendarConference;
};
export type PersonalCalendarConference = {
  provider: "google_meet" | "teams" | "jitsi" | "zoom" | null;
  joinUrl: string | null;
  status: "ready" | "pending" | "unsupported" | "failed";
};
export type PersonalCalendarProvider = "google_calendar" | "outlook";
export type PersonalIssuePreview = {
  provider: "jira" | "linear" | "github";
  url: string;
  identifier: string;
  title: string;
  status: string | null;
  assignee: string | null;
  repository?: string;
  kind?: "issue" | "pull_request";
};

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

function providerFromDocument(
  document: ProviderDocument,
): PersonalIntegrationProvider {
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

function announcePersonalIntegrationsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("savia:personal-integrations-changed"));
}

export class PersonalIntegrationsClient {
  constructor(private readonly api: ApiClient) {
    if (typeof window !== "undefined") {
      window.addEventListener("savia:session-cleared", this.clearCache);
      window.addEventListener("savia:principal-changed", this.clearCache);
    }
  }
  private connectionsPromise: Promise<PersonalIntegrationConnection[]> | null =
    null;
  private connectionsCache: {
    data: PersonalIntegrationConnection[];
    timestamp: number;
  } | null = null;
  private eventsInflight = new Map<string, Promise<PersonalCalendarEvent[]>>();
  private cacheGeneration = 0;

  clearCache = () => {
    this.cacheGeneration += 1;
    this.connectionsPromise = null;
    this.connectionsCache = null;
    this.eventsInflight.clear();
  };

  async listCalendarSources(): Promise<CalendarSource[]> {
    return (
      await this.api.get<{ data: CalendarSource[] }>(
        "/v1/personal-integrations/calendars",
      )
    ).data;
  }
  async createCalendarSource(
    input: CreateCalendarSourceInput,
  ): Promise<CalendarSource> {
    const source = (
      await this.api.post<{ data: CalendarSource }>(
        "/v1/personal-integrations/calendars",
        input,
      )
    ).data;
    announcePersonalIntegrationsChanged();
    return source;
  }
  async updateCalendarSource(
    id: string,
    input: UpdateCalendarSourceInput,
  ): Promise<CalendarSource> {
    const source = (
      await this.api.patch<{ data: CalendarSource }>(
        `/v1/personal-integrations/calendars/${encodeURIComponent(id)}`,
        input,
      )
    ).data;
    announcePersonalIntegrationsChanged();
    return source;
  }
  async deleteCalendarSource(id: string): Promise<void> {
    await this.api.delete(
      `/v1/personal-integrations/calendars/${encodeURIComponent(id)}`,
    );
    announcePersonalIntegrationsChanged();
  }
  async listCalendarSourceEvents(
    id: string,
    range: CalendarRange,
  ): Promise<CalendarSourceEvents> {
    const query = new URLSearchParams({
      from: range.from,
      to: range.to,
      timeZone: range.timeZone,
    });
    if (range.refresh) query.set("refresh", "true");
    return this.api.get<CalendarSourceEvents>(
      `/v1/personal-integrations/calendars/${encodeURIComponent(id)}/events?${query}`,
    );
  }
  async refreshCalendarSource(id: string): Promise<CalendarSource> {
    const source = (
      await this.api.post<{ data: CalendarSource }>(
        `/v1/personal-integrations/calendars/${encodeURIComponent(id)}/refresh`,
      )
    ).data;
    announcePersonalIntegrationsChanged();
    return source;
  }
  async getCalendarPreferences(): Promise<CalendarPreferences> {
    return (
      await this.api.get<{ data: CalendarPreferences }>(
        "/v1/user-preferences/calendar",
      )
    ).data;
  }
  async saveCalendarPreferences(
    input: CalendarPreferences,
  ): Promise<CalendarPreferences> {
    const preferences = (
      await this.api.put<{ data: CalendarPreferences }>(
        "/v1/user-preferences/calendar",
        input,
      )
    ).data;
    announcePersonalIntegrationsChanged();
    return preferences;
  }

  async listProviders(): Promise<PersonalIntegrationProvider[]> {
    const response = await this.api.get<{ data: ProviderDocument[] }>(
      "/v1/personal-integrations/providers",
    );
    return response.data.map(providerFromDocument);
  }

  async listConnections(
    refresh = false,
  ): Promise<PersonalIntegrationConnection[]> {
    // Mi día monta dos useMyDayAgenda a la vez (página + sección): comparte
    // el vuelo y cachea 15s para no duplicar /connections ni /events x2.
    if (
      !refresh &&
      this.connectionsCache &&
      Date.now() - this.connectionsCache.timestamp < 15_000
    ) {
      return this.connectionsCache.data;
    }
    if (this.connectionsPromise) {
      return this.connectionsPromise;
    }
    const generation = this.cacheGeneration;
    const request = this.api
      .get<{ data: ConnectionDocument[] }>(
        "/v1/personal-integrations/connections",
      )
      .then((response) => {
        const data = response.data.map(connectionFromDocument);
        if (generation === this.cacheGeneration) {
          this.connectionsCache = { data, timestamp: Date.now() };
          this.connectionsPromise = null;
        }
        return data;
      })
      .catch((err) => {
        if (generation === this.cacheGeneration) this.connectionsPromise = null;
        throw err;
      });
    this.connectionsPromise = request;
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
    const connection = connectionFromDocument(
      (
        await this.api.post<{ data: ConnectionDocument }>(
          `/v1/personal-integrations/connections/${providerPath(provider)}/complete`,
          { connectionId },
        )
      ).data,
    );
    this.clearCache();
    announcePersonalIntegrationsChanged();
    return connection;
  }

  async disconnect(provider: PersonalIntegrationProviderId): Promise<void> {
    await this.api.delete(
      `/v1/personal-integrations/connections/${providerPath(provider)}`,
    );
    this.clearCache();
    announcePersonalIntegrationsChanged();
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
        if (this.eventsInflight.get(path) === promise) {
          this.eventsInflight.delete(path);
        }
        return response.data;
      })
      .catch((err) => {
        if (this.eventsInflight.get(path) === promise) {
          this.eventsInflight.delete(path);
        }
        throw err;
      });
    this.eventsInflight.set(path, promise);
    return promise;
  }

  async listBookingAgenda(input: {
    from: string;
    to: string;
    timeZone: string;
  }): Promise<BookingAgendaEntry[]> {
    const query = new URLSearchParams(input);
    return (
      await this.api.get<{ data: BookingAgendaEntry[] }>(
        `/v1/personal-integrations/bookings?${query}`,
      )
    ).data;
  }

  async listMessages(input: {
    provider: PersonalMailProvider;
    query?: string;
  }): Promise<PersonalMailMessage[]> {
    const query = new URLSearchParams({ provider: input.provider });
    if (input.query !== undefined) query.set("query", input.query);
    return (
      await this.api.get<{ data: PersonalMailMessage[] }>(
        `/v1/personal-integrations/messages?${query}`,
      )
    ).data;
  }

  async listMessagePage(input: {
    provider: PersonalMailProvider;
    cursor?: string;
  }): Promise<PersonalMailPage> {
    const query = new URLSearchParams({ provider: input.provider });
    if (input.cursor !== undefined) query.set("cursor", input.cursor);
    const response = await this.api.get<{
      data: PersonalMailMessage[];
      pagination?: { nextCursor: string | null };
    }>(`/v1/personal-integrations/messages?${query}`);
    return {
      messages: response.data,
      nextCursor: response.pagination?.nextCursor ?? null,
    };
  }

  async sendMail(
    input: SendPersonalMailInput,
  ): Promise<{ provider: PersonalMailProvider; action: "send-email" }> {
    return (
      await this.api.post<{
        data: { provider: PersonalMailProvider; action: "send-email" };
      }>("/v1/personal-integrations/messages", input)
    ).data;
  }

  async createCalendarEvent(input: {
    provider: PersonalCalendarProvider;
    title: string;
    startsAt: string;
    endsAt: string;
    videoCall?: boolean;
    conferenceProvider?: "jitsi" | "zoom";
    requestId?: string;
    attendees?: string[];
  }): Promise<PersonalCalendarEvent> {
    return (
      await this.api.post<{ data: PersonalCalendarEvent }>(
        "/v1/personal-integrations/events",
        input,
      )
    ).data;
  }

  async deleteCalendarEvent(input: {
    provider: PersonalCalendarProvider;
    eventId: string;
    connectionId: string;
  }): Promise<void> {
    await this.api.delete(
      `/v1/personal-integrations/events/${encodeURIComponent(input.provider)}/${encodeURIComponent(input.eventId)}`,
      {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmed: true,
          connectionId: input.connectionId,
        }),
      },
    );
    this.eventsInflight.clear();
  }

  async previewIssue(url: string): Promise<PersonalIssuePreview> {
    return (
      await this.api.post<{ data: PersonalIssuePreview }>(
        "/v1/personal-integrations/issue-preview",
        { url },
      )
    ).data;
  }

  async listCollaborationChannels(input: {
    provider: CollaborationProvider;
    cursor?: string;
  }): Promise<CollaborationChannelPage> {
    const query = new URLSearchParams({ provider: input.provider });
    if (input.cursor !== undefined) query.set("cursor", input.cursor);
    const response = await this.api.get<{
      data: CollaborationChannelPage["channels"];
      pagination?: { nextCursor: string | null };
    }>(`/v1/personal-integrations/collaboration/channels?${query}`);
    return {
      channels: response.data,
      nextCursor: response.pagination?.nextCursor ?? null,
    };
  }

  async shareRecordToChat(input: ShareRecordInput): Promise<ShareRecordResult> {
    return (
      await this.api.post<{ data: ShareRecordResult }>(
        "/v1/personal-integrations/collaboration/messages",
        input,
      )
    ).data;
  }
}
