import type { ApiClient } from "@/api/api-client";
import type {
  FlowSummary,
  RequestFlow,
  RequestRun,
  RequestRunDetail,
  RequestVariable,
} from "./types";
import type { SecretsFile } from "./secrets-transfer";

export type SecretsImportResult = {
  flowId: string;
  applied: number;
  skipped: number;
  status: "updated" | "unchanged" | "unknown" | "error";
};

const apiRoot = "/v1/savia-request/api";

export function createSaviaRequestApi(apiClient: ApiClient) {
  return {
    listFlows: () => apiClient.get<FlowSummary[]>(`${apiRoot}/flows`),
    listFolders: () => apiClient.get<string[]>(`${apiRoot}/folders`),
    readFlow: (id: string) =>
      apiClient.get<RequestFlow>(`${apiRoot}/flows/${id}`),
    saveFlow: (flow: RequestFlow) =>
      apiClient.put<{ ok: true }>(`${apiRoot}/flows/${flow.id}`, flow),
    saveVariables: (id: string, variables: RequestVariable[]) =>
      apiClient.put<{ ok: true }>(
        `${apiRoot}/flows/${id}/variables`,
        variables,
      ),
    revealVariable: (id: string, key: string) =>
      apiClient.post<{ value: string }>(
        `${apiRoot}/flows/${id}/variables/reveal`,
        {
          key,
        },
      ),
    createFolder: (path: string) =>
      apiClient.post<{ path: string }>(`${apiRoot}/folders`, { path }),
    removeFolder: (path: string) =>
      apiClient.request<{ ok: true }>(`${apiRoot}/folders`, {
        method: "DELETE",
        body: JSON.stringify({ path }),
        headers: { "Content-Type": "application/json" },
      }),
    duplicateFlow: (id: string) =>
      apiClient.post<{ id: string; name: string }>(
        `${apiRoot}/flows/${id}/duplicate`,
      ),
    removeFlow: (id: string) =>
      apiClient.delete(`${apiRoot}/flows/${id}`, {
        body: "{}",
        headers: { "Content-Type": "application/json" },
      }),
    run: (id: string, mode: "mock" | "live", input: Record<string, string>) =>
      apiClient.post<RequestRun>(`${apiRoot}/flows/${id}/runs`, {
        mode,
        input,
      }),
    listRuns: (id: string) =>
      apiClient.get<RequestRun[]>(`${apiRoot}/flows/${id}/runs`),
    readRun: (id: string, runId: string) =>
      apiClient.get<RequestRunDetail>(`${apiRoot}/flows/${id}/runs/${runId}`),
    readVersion: (id: string, versionId: string) =>
      apiClient.get<RequestFlow>(
        `${apiRoot}/flows/${id}/versions/${versionId}`,
      ),
    demoInput: () =>
      apiClient.get<Record<string, string>>(`${apiRoot}/demo-input`),
    publish: (id: string) =>
      apiClient.post<{ id: string }>(`${apiRoot}/flows/${id}/publish`),
    exportSecrets: () =>
      apiClient.get<SecretsFile>(`${apiRoot}/variables/export`),
    importSecrets: (file: SecretsFile) =>
      apiClient.post<{ results: SecretsImportResult[] }>(
        `${apiRoot}/variables/import`,
        file,
      ),
  };
}

export type SaviaRequestApi = ReturnType<typeof createSaviaRequestApi>;
