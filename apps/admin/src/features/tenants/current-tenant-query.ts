import type { QueryFunctionContext } from "@tanstack/react-query";
import type { ApiClient } from "@/api/api-client";
import { readKey } from "@/queries/query-keys";

export type CurrentTenantResponse = {
  data?: {
    name: string;
    kind: "commercial" | "platform";
    id: number | null;
  };
};

export function currentTenantQueryOptions({
  apiClient,
  sessionGeneration,
  hostname,
}: {
  apiClient: ApiClient;
  sessionGeneration: number;
  hostname: string;
}) {
  return {
    queryKey: readKey(
      { sessionGeneration, kind: "tenant", id: hostname },
      "current-tenant",
      { hostname },
    ),
    queryFn: ({ signal }: QueryFunctionContext) =>
      apiClient.get<CurrentTenantResponse>("/v1/tenants/current", { signal }),
  };
}
