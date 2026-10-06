import type { ApiClient } from "./api-client";

export type WhatsappProviderAvailability = "enabled" | "unavailable";
export type WhatsappConnectionStatus =
  "pending" | "connected" | "reconnect_required" | "disconnected" | "failed";

export type WhatsappProvider = {
  id: "whatsapp";
  displayName: string;
  availability: WhatsappProviderAvailability;
  capabilities: string[];
};

export type WhatsappConnection = {
  id: string;
  agencyId: number;
  provider: "whatsapp";
  status: WhatsappConnectionStatus;
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  wabaId: string | null;
  externalAccountLabel: string | null;
  lastValidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WhatsappConnectSession = {
  token: string;
  expiresAt: string;
  connectUrl: string;
  apiUrl: string;
};

export type WhatsappAssistantConfiguration = {
  settings: {
    connectionId: string;
    tenantId: number;
    employeeId: string;
    enabled: boolean;
    allowedContacts: string[];
    updatedBy: string;
  } | null;
  employees: Array<{ id: string; name: string }>;
  webhookReady: boolean;
};

export type WhatsappChannelConfiguration = {
  routingEnabled: boolean;
  defaultTaskId?: string | null;
  tasks: Array<{
    id: string;
    employeeId: string;
    title: string;
    description: string;
    order: number;
    audiences: Array<"internal" | "external">;
  }>;
  staff: Array<{
    phone: string;
    label: string;
    active: boolean;
    principalId: string | null;
  }>;
  internalCapabilities: string[];
  externalCapabilities: string[];
  humanSupportContact?: string;
};
export type WhatsappChannelState = {
  configuration: WhatsappChannelConfiguration | null;
  employees: Array<{ id: string; name: string }>;
  members: Array<{ id: string; name: string }>;
};

export type WhatsappNativeResources = {
  flows: Array<{
    key: string;
    label: string;
    flowId: string;
    screen: string;
  }>;
  catalogs: Array<{
    key: string;
    label: string;
    catalogId: string;
    products: Array<{ id: string; label: string }>;
  }>;
  templates: Array<{
    key: string;
    label: string;
    name: string;
    language: string;
    parameterCount: number;
  }>;
  media: Array<{
    key: string;
    label: string;
    type: "image" | "audio" | "video" | "document";
    mediaId: string;
    filename?: string;
  }>;
  locations: Array<{
    key: string;
    label: string;
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  }>;
};

export type WhatsappNativeConfiguration = {
  replyButtons: boolean;
  listMessages: boolean;
  mediaUnderstanding: boolean;
  readReceipts: boolean;
  typingIndicator: boolean;
} & WhatsappNativeResources;

export type WhatsappNativeContribution = {
  pluginId: string;
  solutionId: string;
  bundleId: string;
  title: string;
  flowJson: unknown;
};

export type WhatsappNativeAssets = {
  flows: Array<{ id: string; name: string; status: string }>;
  templates: Array<{
    id: string;
    name: string;
    language: string;
    status: string;
    parameterCount: number;
    supported: boolean;
  }>;
};

export type WhatsappNativeReply =
  | { kind: "text"; text: string }
  | {
      kind: "buttons";
      text: string;
      options: Array<{ id: string; title: string }>;
    }
  | {
      kind: "list";
      text: string;
      buttonLabel: string;
      options: Array<{ id: string; title: string; description?: string }>;
    }
  | { kind: "flow"; text: string; resourceKey: string }
  | { kind: "catalog"; text: string; resourceKey: string; productIds: string[] }
  | { kind: "media"; resourceKey: string; caption?: string }
  | { kind: "location"; resourceKey: string }
  | { kind: "template"; resourceKey: string; parameters: string[] };

export type WhatsappNativeState = {
  configuration: WhatsappNativeConfiguration;
  configured: boolean;
  contributions: WhatsappNativeContribution[];
};

const emptyWhatsappNativeConfiguration = (): WhatsappNativeConfiguration => ({
  replyButtons: false,
  listMessages: false,
  mediaUnderstanding: false,
  readReceipts: false,
  typingIndicator: false,
  flows: [],
  catalogs: [],
  templates: [],
  media: [],
  locations: [],
});

type WhatsappProviderDocument = {
  id: "whatsapp";
  kind: "whatsapp-provider";
  attributes: Omit<WhatsappProvider, "id">;
};

type WhatsappConnectionDocument = {
  id: string;
  kind: "whatsapp-connection";
  attributes: Omit<WhatsappConnection, "id">;
};

function providerFromDocument(
  document: WhatsappProviderDocument,
): WhatsappProvider {
  return { id: document.id, ...document.attributes };
}

function connectionFromDocument(
  document: WhatsappConnectionDocument,
): WhatsappConnection {
  return { id: document.id, ...document.attributes };
}

function agencyQuery(agencyId?: number): string {
  return agencyId !== undefined
    ? `?agencyId=${encodeURIComponent(String(agencyId))}`
    : "";
}

export class WhatsappClient {
  constructor(private readonly api: ApiClient) {}

  async getChannel(agencyId: number): Promise<WhatsappChannelState> {
    return (
      await this.api.get<{ data: WhatsappChannelState }>(
        `/v1/whatsapp/channel${agencyQuery(agencyId)}`,
      )
    ).data;
  }
  async updateChannel(
    agencyId: number,
    configuration: WhatsappChannelConfiguration,
  ): Promise<WhatsappChannelConfiguration> {
    return (
      await this.api.put<{ data: WhatsappChannelConfiguration }>(
        "/v1/whatsapp/channel",
        { agencyId, configuration },
      )
    ).data;
  }

  async getAssistant(
    agencyId: number,
  ): Promise<WhatsappAssistantConfiguration> {
    return (
      await this.api.get<{ data: WhatsappAssistantConfiguration }>(
        `/v1/whatsapp/assistant${agencyQuery(agencyId)}`,
      )
    ).data;
  }

  async getNative(agencyId: number): Promise<WhatsappNativeState> {
    const response = await this.api.get<{ data: Partial<WhatsappNativeState> }>(
      `/v1/whatsapp/native${agencyQuery(agencyId)}`,
    );
    return {
      configuration: {
        ...emptyWhatsappNativeConfiguration(),
        ...response.data.configuration,
      },
      configured: response.data.configured ?? false,
      contributions: response.data.contributions ?? [],
    };
  }

  async updateNative(input: {
    agencyId: number;
    configuration: WhatsappNativeConfiguration;
  }): Promise<WhatsappNativeConfiguration> {
    return (
      await this.api.put<{ data: WhatsappNativeConfiguration }>(
        "/v1/whatsapp/native",
        input,
      )
    ).data;
  }

  async listNativeAssets(agencyId: number): Promise<WhatsappNativeAssets> {
    return (
      await this.api.get<{ data: WhatsappNativeAssets }>(
        `/v1/whatsapp/native/assets${agencyQuery(agencyId)}`,
      )
    ).data;
  }

  async sendNativeMessage(input: {
    agencyId: number;
    to: string;
    reply: WhatsappNativeReply;
    idempotencyKey: string;
    consent: boolean;
  }): Promise<{ messageId: string }> {
    return (
      await this.api.post<{ data: { messageId: string } }>(
        "/v1/whatsapp/native/messages",
        input,
      )
    ).data;
  }

  async uploadNativeMedia(
    agencyId: number,
    file: File,
  ): Promise<{ mediaId: string; type: string; filename: string }> {
    const form = new FormData();
    form.append("file", file, file.name);
    return (
      await this.api.postForm<{
        data: { mediaId: string; type: string; filename: string };
      }>(`/v1/whatsapp/native/media${agencyQuery(agencyId)}`, form)
    ).data;
  }

  async updateAssistant(input: {
    agencyId: number;
    employeeId: string;
    enabled: boolean;
    allowedContacts: string[];
  }): Promise<NonNullable<WhatsappAssistantConfiguration["settings"]>> {
    return (
      await this.api.put<{
        data: NonNullable<WhatsappAssistantConfiguration["settings"]>;
      }>("/v1/whatsapp/assistant", input)
    ).data;
  }

  async listProviders(agencyId?: number): Promise<WhatsappProvider[]> {
    const response = await this.api.get<{ data: WhatsappProviderDocument[] }>(
      `/v1/whatsapp/providers${agencyQuery(agencyId)}`,
    );
    return response.data.map(providerFromDocument);
  }

  async listConnections(agencyId?: number): Promise<WhatsappConnection[]> {
    const response = await this.api.get<{ data: WhatsappConnectionDocument[] }>(
      `/v1/whatsapp/connections${agencyQuery(agencyId)}`,
    );
    return response.data.map(connectionFromDocument);
  }

  async createConnectSession(
    reconnect: boolean,
    agencyId?: number,
  ): Promise<WhatsappConnectSession> {
    return (
      await this.api.post<{ data: WhatsappConnectSession }>(
        `/v1/whatsapp/connections/${reconnect ? "reconnect-session" : "connect-session"}`,
        agencyId !== undefined ? { agencyId } : {},
      )
    ).data;
  }

  async complete(
    connectionId: string,
    details: {
      agencyId?: number;
      phoneNumberId?: string;
      displayPhoneNumber?: string;
      wabaId?: string;
    } = {},
  ): Promise<WhatsappConnection> {
    return connectionFromDocument(
      (
        await this.api.post<{ data: WhatsappConnectionDocument }>(
          "/v1/whatsapp/connections/complete",
          { ...details, connectionId },
        )
      ).data,
    );
  }

  async testSend(input: {
    agencyId: number;
    to: string;
    text: string;
  }): Promise<{ messageId: string }> {
    return (
      await this.api.post<{ data: { messageId: string } }>(
        "/v1/whatsapp/connections/test-send",
        input,
      )
    ).data;
  }

  async updateNumber(input: {
    agencyId?: number;
    phoneNumberId: string;
    displayPhoneNumber?: string;
    wabaId?: string;
  }): Promise<WhatsappConnection> {
    return connectionFromDocument(
      (
        await this.api.post<{ data: WhatsappConnectionDocument }>(
          "/v1/whatsapp/connections/number",
          input,
        )
      ).data,
    );
  }

  disconnect(agencyId?: number): Promise<void> {
    return this.api.delete(`/v1/whatsapp/connections${agencyQuery(agencyId)}`);
  }
}
