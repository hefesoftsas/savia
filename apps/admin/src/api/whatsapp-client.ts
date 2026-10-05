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

  async getAssistant(
    agencyId: number,
  ): Promise<WhatsappAssistantConfiguration> {
    return (
      await this.api.get<{ data: WhatsappAssistantConfiguration }>(
        `/v1/whatsapp/assistant${agencyQuery(agencyId)}`,
      )
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
