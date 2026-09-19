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

export type AssistantActiveAgency = {
  activeAgencyId?: number;
  agencies: { id: number; name: string }[];
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

  saveAgencyOverride(
    agencyId: number,
    input: AssistantConfigurationWrite,
  ): Promise<AssistantConfigurationSummary> {
    return this.apiClient.put(
      `/v1/assistant/configuration/agencies/${agencyId}`,
      input,
    );
  }

  clearAgencyOverride(agencyId: number): Promise<void> {
    return this.apiClient.delete(
      `/v1/assistant/configuration/agencies/${agencyId}`,
    );
  }

  async models(): Promise<AssistantModel[]> {
    const response = await this.apiClient.get<{ models: AssistantModel[] }>(
      "/v1/assistant/models",
    );
    return response.models;
  }

  activeAgency(): Promise<AssistantActiveAgency> {
    return this.apiClient.get("/v1/assistant/active-agency");
  }

  setActiveAgency(agencyId: number): Promise<AssistantActiveAgency> {
    return this.apiClient.put("/v1/assistant/active-agency", { agencyId });
  }
}
