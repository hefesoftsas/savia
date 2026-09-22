import type { ApiClient } from "./api-client";

export type AssistantConfigurationKeyState =
  "configured" | "inherited" | "deployment_fallback" | "not_configured";

export type AssistantConfigurationSetting = {
  scope: "global" | "agency";
  agencyId?: number;
  keyState: AssistantConfigurationKeyState;
  model: string | null;
  updatedAt: string;
  updatedBy: string;
};

export type AssistantConfigurationSummary = {
  global: AssistantConfigurationSetting | null;
  agencies: AssistantConfigurationSetting[];
  deployment: {
    keyState: "deployment_fallback" | "not_configured";
    model: string;
  };
};

export type AssistantConfigurationWrite = {
  apiKey?: string;
  clearApiKey?: boolean;
  model?: string | null;
};

export type AssistantModelModalities = {
  text: boolean;
  image: boolean;
  audio: boolean;
  file: boolean;
};

export type AssistantModel = {
  id: string;
  name: string;
  contextLength: number | null;
  inputPricePerMillion: number | null;
  outputPricePerMillion: number | null;
  modalities?: AssistantModelModalities;
  supportsTools?: boolean;
};

export type AssistantActiveTenant = {
  activeTenantId?: number;
  activeAgencyId?: number;
  tenants?: { id: number; name: string }[];
  agencies: { id: number; name: string }[];
};

export type AssistantActiveAgency = AssistantActiveTenant;

export class AssistantConfigurationClient {
  constructor(private readonly apiClient: ApiClient) {}

  summary(): Promise<AssistantConfigurationSummary> {
    return this.apiClient.get("/v1/assistant/configuration");
  }

  saveGlobal(
    input: AssistantConfigurationWrite,
  ): Promise<AssistantConfigurationSummary> {
    return this.apiClient.put("/v1/assistant/configuration/global", input);
  }

  saveTenantOverride(
    tenantId: number,
    input: AssistantConfigurationWrite,
  ): Promise<AssistantConfigurationSummary> {
    return this.apiClient.put(
      `/v1/assistant/configuration/tenants/${tenantId}`,
      input,
    );
  }

  saveAgencyOverride(
    agencyId: number,
    input: AssistantConfigurationWrite,
  ): Promise<AssistantConfigurationSummary> {
    return this.saveTenantOverride(agencyId, input);
  }

  clearTenantOverride(tenantId: number): Promise<void> {
    return this.apiClient.delete(
      `/v1/assistant/configuration/tenants/${tenantId}`,
    );
  }

  clearAgencyOverride(agencyId: number): Promise<void> {
    return this.clearTenantOverride(agencyId);
  }

  async models(): Promise<AssistantModel[]> {
    const response = await this.apiClient.get<{ models: AssistantModel[] }>(
      "/v1/assistant/models",
    );
    return response.models;
  }

  activeTenant(): Promise<AssistantActiveTenant> {
    return this.apiClient.get("/v1/assistant/active-tenant");
  }

  activeAgency(): Promise<AssistantActiveAgency> {
    return this.activeTenant();
  }

  setActiveTenant(tenantId: number): Promise<AssistantActiveTenant> {
    return this.apiClient.put("/v1/assistant/active-tenant", { tenantId });
  }

  setActiveAgency(agencyId: number): Promise<AssistantActiveAgency> {
    return this.setActiveTenant(agencyId);
  }
}

