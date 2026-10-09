import { useTenantBranding } from "@/features/tenant-branding/tenant-branding-provider";
import { useMemo, useRef } from "react";
import { parseTenantSlugFromHostname } from "@savia/tenant-host";
import { usePermissions } from "ra-core";
import { useQuery, QueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@/api/api-client";
import { createAdminQueryClient } from "@/queries/query-policy";
import { readKey } from "@/queries/query-keys";
import { useSessionGeneration } from "@/auth/session-scope";
import { useOptionalAppServices } from "@/features/assistant/assistant-context";
import { currentTenantQueryOptions } from "./current-tenant-query";

const fallbackClients = new WeakMap<ApiClient, QueryClient>();

function queryClientFor(apiClient?: ApiClient): QueryClient | undefined {
  if (!apiClient) return undefined;
  let client = fallbackClients.get(apiClient);
  if (!client) {
    client = createAdminQueryClient();
    fallbackClients.set(apiClient, client);
  }
  return client;
}

export type CurrentTenantInfo = {
  isDedicated: boolean;
  slug: string | null;
  name: string;
  kind: "commercial" | "platform";
  id: number | null;
  monogram: string;
  isPlatformAdmin: boolean;
  isLoading: boolean;
};

export function formatSlugToDisplayName(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function useCurrentTenant(options?: {
  hostname?: string;
}): CurrentTenantInfo {
  const { branding } = useTenantBranding();
  const hostname =
    options?.hostname ??
    (typeof window !== "undefined" ? window.location.hostname : "");
  const slug = useMemo(() => parseTenantSlugFromHostname(hostname), [hostname]);
  const isDedicated = Boolean(slug) || Boolean(branding);
  const fallbackName = slug ? formatSlugToDisplayName(slug) : "Savia";
  const appServices = useOptionalAppServices();
  const apiClient = appServices?.apiClient;
  const sessionGeneration = useSessionGeneration();
  const standaloneQueryClient = useRef<QueryClient | null>(null);
  const queryClient =
    appServices?.queryClient ??
    queryClientFor(apiClient) ??
    (standaloneQueryClient.current ??= createAdminQueryClient());

  let isPlatformAdmin = false;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { permissions } = usePermissions();
    isPlatformAdmin = Boolean(
      permissions &&
      typeof permissions === "object" &&
      "canManageIdentity" in permissions &&
      permissions.canManageIdentity,
    );
  } catch {
    // Outside react-admin context (e.g. unit tests)
  }

  const enabled = Boolean(isDedicated && hostname && apiClient);
  const tenantQuery = useQuery(
    apiClient && hostname
      ? {
          ...currentTenantQueryOptions({
            apiClient,
            sessionGeneration,
            hostname,
          }),
          enabled,
        }
      : {
          queryKey: readKey(
            {
              sessionGeneration,
              kind: isDedicated ? "tenant" : "platform",
              id: hostname || "unavailable",
            },
            "current-tenant",
            { hostname },
          ),
          queryFn: async () => undefined,
          enabled: false,
        },
    queryClient,
  );
  const tenantData = tenantQuery.data?.data;
  const kind = tenantData?.kind ?? (isDedicated ? "commercial" : "platform");
  const name = branding?.displayName || tenantData?.name || fallbackName;
  const monogram = name.charAt(0).toUpperCase() || "S";

  return {
    isDedicated,
    slug,
    name,
    kind,
    id: tenantData?.id ?? null,
    monogram,
    isPlatformAdmin,
    isLoading: enabled && tenantQuery.isPending,
  };
}
