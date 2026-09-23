import type { ApiClient } from "@/api/api-client";
import type {
  BundleStatus,
  BundleSyncInput,
  BundleSyncResult,
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

export type SaviaRequestScope = { tenant?: string };

function scoped(path: string, scope?: SaviaRequestScope): string {
  if (!scope?.tenant) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}tenant=${encodeURIComponent(scope.tenant)}`;
}

export function createSaviaRequestApi(
  apiClient: ApiClient,
  scope?: SaviaRequestScope,
) {
  return {
    listFlows: () =>
      apiClient.get<FlowSummary[]>(scoped(`${apiRoot}/flows`, scope)),
    listFolders: () =>
      apiClient.get<string[]>(scoped(`${apiRoot}/folders`, scope)),
    readFlow: (id: string) =>
      apiClient.get<RequestFlow>(scoped(`${apiRoot}/flows/${id}`, scope)),
    saveFlow: (flow: RequestFlow) =>
      apiClient.put<{ ok: true }>(
        scoped(`${apiRoot}/flows/${flow.id}`, scope),
        flow,
      ),
    saveVariables: (id: string, variables: RequestVariable[]) =>
      apiClient.put<{ ok: true }>(
        scoped(`${apiRoot}/flows/${id}/variables`, scope),
        variables,
      ),
    resetVariable: (id: string, key: string) =>
      apiClient.request<{ ok: true; reverted: boolean }>(
        scoped(
          `${apiRoot}/flows/${id}/variables/${encodeURIComponent(key)}`,
          scope,
        ),
        { method: "DELETE" },
      ),
    resetFlow: (id: string) =>
      apiClient.post<{ ok: true; reverted: boolean }>(
        scoped(`${apiRoot}/flows/${id}/reset`, scope),
      ),
    revealVariable: (id: string, key: string) =>
      apiClient.post<{ value: string }>(
        scoped(`${apiRoot}/flows/${id}/variables/reveal`, scope),
        {
          key,
        },
      ),
    createFolder: (path: string) =>
      apiClient.post<{ path: string }>(scoped(`${apiRoot}/folders`, scope), {
        path,
      }),
    removeFolder: (path: string) =>
      apiClient.request<{ ok: true }>(scoped(`${apiRoot}/folders`, scope), {
        method: "DELETE",
        body: JSON.stringify({ path }),
        headers: { "Content-Type": "application/json" },
      }),
    duplicateFlow: (id: string) =>
      apiClient.post<{ id: string; name: string }>(
        scoped(`${apiRoot}/flows/${id}/duplicate`, scope),
      ),
    removeFlow: (id: string) =>
      apiClient.delete(scoped(`${apiRoot}/flows/${id}`, scope)),
    run: (id: string, mode: "mock" | "live", input: Record<string, string>) =>
      apiClient.post<RequestRun>(scoped(`${apiRoot}/flows/${id}/runs`, scope), {
        mode,
        input,
      }),
    listRuns: (id: string) =>
      apiClient.get<RequestRun[]>(scoped(`${apiRoot}/flows/${id}/runs`, scope)),
    readRun: (id: string, runId: string) =>
      apiClient.get<RequestRunDetail>(
        scoped(`${apiRoot}/flows/${id}/runs/${runId}`, scope),
      ),
    readVersion: (id: string, versionId: string) =>
      apiClient.get<RequestFlow>(
        scoped(`${apiRoot}/flows/${id}/versions/${versionId}`, scope),
      ),
    demoInput: () =>
      apiClient.get<Record<string, string>>(`${apiRoot}/demo-input`),
    publish: (id: string) =>
      apiClient.post<{ id: string }>(
        scoped(`${apiRoot}/flows/${id}/publish`, scope),
      ),
    exportSecrets: () =>
      apiClient.get<SecretsFile>(scoped(`${apiRoot}/variables/export`, scope)),
    importSecrets: (file: SecretsFile) =>
      apiClient.post<{ results: SecretsImportResult[] }>(
        scoped(`${apiRoot}/variables/import`, scope),
        file,
      ),
    bundleStatus: () =>
      apiClient.get<BundleStatus>(
        scoped(`${apiRoot}/bundles/insurance-auto-light/status`, scope),
      ),
    syncBundle: (input: BundleSyncInput = {}) =>
      apiClient.post<BundleSyncResult>(
        scoped(`${apiRoot}/bundles/insurance-auto-light/sync`, scope),
        input,
      ),
  };
}

export type SaviaRequestApi = ReturnType<typeof createSaviaRequestApi>;
