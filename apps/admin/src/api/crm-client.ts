import type { ApiClient } from "./api-client";

export type CrmProviderId = "hubspot" | "salesforce" | "zoho" | "pipedrive";
export type CrmProviderAvailability = "enabled" | "unavailable" | "coming_soon";
export type CrmConnectionStatus =
  "pending" | "connected" | "reconnect_required" | "disconnected" | "failed";

export type CrmProvider = {
  id: CrmProviderId;
  displayName: string;
  availability: CrmProviderAvailability;
  capabilities: string[];
};

export type CrmConnection = {
  id: string;
  agencyId: number;
  provider: CrmProviderId;
  status: CrmConnectionStatus;
  externalAccountLabel: string | null;
  scopes: string[];
  lastValidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CrmConnectSession = {
  token: string;
  expiresAt: string;
  connectUrl: string;
  apiUrl: string;
};

export type CrmSyncRule = {
  id: string;
  tenantId: number;
  tenantName: string;
  provider: "hubspot";
  accountLabel: string;
  enabled: boolean;
  connectionId: string;
  createdAt: string;
};

export type CrmSyncTenant = { id: number; name: string };
export type CrmSyncJobStatus =
  "pending" | "processing" | "synced" | "failed" | "blocked";
export type CrmSyncJob = {
  id: string;
  ruleId: string;
  customerId: number;
  provider: string;
  status: CrmSyncJobStatus;
  attempts: number;
  lastError: string | null;
  updatedAt: string;
  externalUrl: string | null;
};

type CrmProviderDocument = {
  id: CrmProviderId;
  kind: "crm-provider";
  attributes: Omit<CrmProvider, "id">;
};

type CrmConnectionDocument = {
  id: string;
  kind: "crm-connection";
  attributes: Omit<CrmConnection, "id">;
};

function providerFromDocument(document: CrmProviderDocument): CrmProvider {
  return { id: document.id, ...document.attributes };
}

function connectionFromDocument(
  document: CrmConnectionDocument,
): CrmConnection {
  return { id: document.id, ...document.attributes };
}

function providerPath(provider: CrmProviderId): string {
  return encodeURIComponent(provider);
}

function agencyQuery(agencyId?: number): string {
  return agencyId !== undefined
    ? `?agencyId=${encodeURIComponent(String(agencyId))}`
    : "";
}

export class CrmClient {
  constructor(private readonly api: ApiClient) {}

  async listProviders(agencyId?: number): Promise<CrmProvider[]> {
    const response = await this.api.get<{ data: CrmProviderDocument[] }>(
      `/v1/crm/providers${agencyQuery(agencyId)}`,
    );
    return response.data.map(providerFromDocument);
  }

  async listConnections(agencyId?: number): Promise<CrmConnection[]> {
    const response = await this.api.get<{ data: CrmConnectionDocument[] }>(
      `/v1/crm/connections${agencyQuery(agencyId)}`,
    );
    return response.data.map(connectionFromDocument);
  }

  async createConnectSession(
    provider: CrmProviderId,
    reconnect: boolean,
    agencyId?: number,
  ): Promise<CrmConnectSession> {
    return (
      await this.api.post<{ data: CrmConnectSession }>(
        `/v1/crm/connections/${providerPath(provider)}/${reconnect ? "reconnect-session" : "connect-session"}`,
        agencyId !== undefined ? { agencyId } : {},
      )
    ).data;
  }

  async complete(
    provider: CrmProviderId,
    connectionId: string,
    agencyId?: number,
  ): Promise<CrmConnection> {
    return connectionFromDocument(
      (
        await this.api.post<{ data: CrmConnectionDocument }>(
          `/v1/crm/connections/${providerPath(provider)}/complete`,
          agencyId !== undefined
            ? { agencyId, connectionId }
            : { connectionId },
        )
      ).data,
    );
  }

  disconnect(provider: CrmProviderId, agencyId?: number): Promise<void> {
    return this.api.delete(
      `/v1/crm/connections/${providerPath(provider)}${agencyQuery(agencyId)}`,
    );
  }

  async listSyncRules(): Promise<{
    rules: CrmSyncRule[];
    tenants: CrmSyncTenant[];
  }> {
    return (
      await this.api.get<{
        data: { rules: CrmSyncRule[]; tenants: CrmSyncTenant[] };
      }>("/v1/crm/sync-rules")
    ).data;
  }

  async createSyncRule(tenantId: number): Promise<CrmSyncRule> {
    return (
      await this.api.post<{ data: CrmSyncRule }>("/v1/crm/sync-rules", {
        tenantId,
        provider: "hubspot",
      })
    ).data;
  }

  async setSyncRuleEnabled(id: string, enabled: boolean): Promise<CrmSyncRule> {
    return (
      await this.api.patch<{ data: CrmSyncRule }>(
        `/v1/crm/sync-rules/${encodeURIComponent(id)}`,
        { enabled },
      )
    ).data;
  }

  async deleteSyncRule(id: string): Promise<void> {
    await this.api.delete(`/v1/crm/sync-rules/${encodeURIComponent(id)}`);
  }

  async listSyncJobs(customerId?: number): Promise<CrmSyncJob[]> {
    const query =
      customerId === undefined
        ? ""
        : `?customerId=${encodeURIComponent(String(customerId))}`;
    return (
      await this.api.get<{ data: CrmSyncJob[] }>(`/v1/crm/sync-jobs${query}`)
    ).data;
  }

  async retrySyncJob(id: string): Promise<{ queued: true }> {
    return (
      await this.api.post<{ data: { queued: true } }>(
        `/v1/crm/sync-jobs/${encodeURIComponent(id)}/retry`,
        {},
      )
    ).data;
  }
}
