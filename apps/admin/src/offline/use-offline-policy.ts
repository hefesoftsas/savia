import { useEffect } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@/api/api-client";
import { useAppServices } from "@/features/assistant/assistant-context";
import {
  setOfflinePolicySnapshot,
  type CollectionOfflinePolicy,
} from "./offline-policy";

type PolicyResponse = {
  data: CollectionOfflinePolicy[];
};

/**
 * Applies per-collection refresh intervals as TanStack query defaults, so
 * "cada cuánto se refresca" is server-driven per tenant. Safe to call with
 * an undefined client (embedded contexts without a provider skip it).
 */
export function applyOfflinePolicyDefaults(
  queryClient: QueryClient | undefined,
  policies: CollectionOfflinePolicy[],
): void {
  if (!queryClient) return;
  for (const policy of policies) {
    const refreshMs = policy.refreshSeconds * 1000;
    for (const prefix of ["pipeline", "summary"]) {
      queryClient.setQueryDefaults([prefix, policy.collection], {
        staleTime: policy.enabled ? refreshMs : 0,
        refetchInterval: policy.enabled ? refreshMs : false,
      });
    }
  }
}

/**
 * Loads a tenant's offline policy and publishes it to the snapshot (used by
 * the persister filter) plus query defaults (used by live screens).
 * Degrades gracefully outside providers: no crash, static fallback applies.
 */
export function useOfflinePolicy(tenantId?: number) {
  let apiClient: ApiClient | undefined;
  try {
    apiClient = useAppServices().apiClient;
  } catch {
    apiClient = undefined;
  }
  let queryClient: QueryClient | undefined;
  try {
    queryClient = useQueryClient();
  } catch {
    queryClient = undefined;
  }

  let query: { data: CollectionOfflinePolicy[] | undefined };
  try {
    query = useQuery({
      queryKey: ["offline-policies", tenantId],
      enabled: apiClient !== undefined && tenantId !== undefined,
      staleTime: 60_000,
      retry: false,
      queryFn: async () => {
        const response = await apiClient!.get<PolicyResponse>(
          `/v1/offline/collections?tenantId=${tenantId}`,
        );
        return response.data;
      },
    });
  } catch {
    query = { data: undefined };
  }

  useEffect(() => {
    if (tenantId === undefined || !query.data) return;
    setOfflinePolicySnapshot(tenantId, query.data);
    applyOfflinePolicyDefaults(queryClient, query.data);
  }, [tenantId, query.data, queryClient]);

  return query;
}
