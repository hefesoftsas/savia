import type { ApiClient } from "./api-client";

export type AssistantConfigurationKeyState =
  "configured" | "inherited" | "deployment_fallback" | "not_configured";

export type TranscriptionEndpoint = "audio/transcriptions" | "chat/completions";

export type AssistantConfigurationSetting = {
  scope: "global" | "tenant";
  tenantId?: number;
  keyState: AssistantConfigurationKeyState;
  model: string | null;
  allowedModels?: string[] | null;
  transcriptionModel?: string | null;
  transcriptionEndpoint?: TranscriptionEndpoint | null;
  summaryModel?: string | null;
  updatedAt?: string;
  updatedBy?: string;
};

export type AssistantConfigurationSummary = {
  canManageGlobal?: boolean;
  manageableTenantIds?: number[];
  global: AssistantConfigurationSetting | null;
  tenants: AssistantConfigurationSetting[];
  deployment: {
    keyState: "deployment_fallback" | "not_configured";
    model: string;
    transcriptionModel?: string;
    transcriptionEndpoint?: TranscriptionEndpoint;
    summaryModel?: string;
  };
};

export type AssistantConfigurationWrite = {
  apiKey?: string;
  clearApiKey?: boolean;
  model?: string | null;
  allowedModels?: string[] | null;
  transcriptionModel?: string | null;
  transcriptionEndpoint?: TranscriptionEndpoint | null;
  summaryModel?: string | null;
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
  transcriptionEndpoint?: TranscriptionEndpoint;
};

export type AssistantModelPolicy = {
  defaultModel: string;
  allowedModels: AssistantModel[];
};

export type AssistantActiveTenant = {
  activeTenantId?: number;
  tenants: { id: number; name: string }[];
};

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

  clearTenantOverride(tenantId: number): Promise<void> {
    return this.apiClient.delete(
      `/v1/assistant/configuration/tenants/${tenantId}`,
    );
  }

  async models(tenantId?: number): Promise<AssistantModel[]> {
    const response = await this.apiClient.get<{ models: AssistantModel[] }>(
      tenantId === undefined
        ? "/v1/assistant/models"
        : `/v1/assistant/models?tenantId=${tenantId}`,
    );
    return response.models;
  }

  modelPolicy(): Promise<AssistantModelPolicy> {
    return this.apiClient.get("/v1/assistant/model-policy");
  }

  activeTenant(): Promise<AssistantActiveTenant> {
    return this.apiClient.get("/v1/assistant/active-tenant");
  }

  async setActiveTenant(tenantId: number): Promise<AssistantActiveTenant> {
    const state = await this.apiClient.put<AssistantActiveTenant>(
      "/v1/assistant/active-tenant",
      { tenantId },
    );
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event("savia:active-tenant-changed"));
    return state;
  }
}
