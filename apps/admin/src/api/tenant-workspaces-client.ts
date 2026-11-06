import type { ApiClient } from "./api-client";

export type TenantWorkspace = {
  id: string;
  tenantId: number;
  label: string;
  kind: "platform" | "tenant";
  apiBasePath: string;
};

let sharedPromise: Promise<TenantWorkspace[]> | null = null;
let sharedCache: { data: TenantWorkspace[]; timestamp: number } | null = null;

export function invalidateTenantWorkspaces(): void {
  sharedCache = null;
  sharedPromise = null;
}

if (typeof window !== "undefined") {
  window.addEventListener(
    "savia-studio-tenants-changed",
    invalidateTenantWorkspaces,
  );
}

export async function fetchTenantWorkspaces(
  client: ApiClient,
): Promise<TenantWorkspace[]> {
  if (sharedCache && Date.now() - sharedCache.timestamp < 30_000) {
    return sharedCache.data;
  }
  if (sharedPromise) return sharedPromise;

  sharedPromise = client
    .get<{ data: TenantWorkspace[] }>("/v1/tenant-workspaces")
    .then(({ data }) => {
      sharedCache = { data, timestamp: Date.now() };
      sharedPromise = null;
      return data;
    })
    .catch((error) => {
      sharedPromise = null;
      throw error;
    });
  return sharedPromise;
}
