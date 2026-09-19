import { useTenantBranding } from "@/features/tenant-branding/tenant-branding-provider";
import { useEffect, useMemo, useState } from "react";
import { parseTenantSlugFromHostname } from "@savia/tenant-host";
import { usePermissions } from "ra-core";
import { useAppServices } from "@/features/assistant/assistant-context";

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

  const [tenantData, setTenantData] = useState<{
    name: string;
    kind: "commercial" | "platform";
    id: number | null;
    isLoading: boolean;
  }>({
    name: fallbackName,
    kind: isDedicated ? "commercial" : "platform",
    id: null,
    isLoading: isDedicated,
  });

  let appServices: ReturnType<typeof useAppServices> | undefined;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    appServices = useAppServices();
  } catch {
    // Outside services provider
  }

  useEffect(() => {
    if (!isDedicated) {
      setTenantData({
        name: "Savia",
        kind: "platform",
        id: null,
        isLoading: false,
      });
      return;
    }

    if (!appServices?.apiClient) {
      setTenantData({
        name: fallbackName,
        kind: "commercial",
        id: null,
        isLoading: false,
      });
      return;
    }

    let isMounted = true;
    appServices.apiClient
      .get<{
        data: {
          name: string;
          kind: "commercial" | "platform";
          id: number | null;
        };
      }>("/v1/tenants/current")
      .then((response) => {
        if (!isMounted || !response?.data) return;
        setTenantData({
          name: response.data.name || fallbackName,
          kind: response.data.kind || "commercial",
          id: response.data.id,
          isLoading: false,
        });
      })
      .catch(() => {
        if (!isMounted) return;
        setTenantData((prev) => ({
          ...prev,
          name: fallbackName,
          isLoading: false,
        }));
      });

    return () => {
      isMounted = false;
    };
  }, [isDedicated, slug, fallbackName, appServices?.apiClient]);

  const name = branding?.displayName || tenantData.name || fallbackName;
  const monogram = name.charAt(0).toUpperCase() || "S";

  return {
    isDedicated,
    slug,
    name,
    kind: tenantData.kind,
    id: tenantData.id,
    monogram,
    isPlatformAdmin,
    isLoading: tenantData.isLoading,
  };
}
