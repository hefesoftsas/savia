import { useTenantBranding } from "@/features/tenant-branding/tenant-branding-provider";
import { useCurrentTenant } from "@/features/tenants/use-current-tenant";
import { useRealtimeRefresh } from "./use-realtime-refresh";

/** Mount inside the authenticated layout, after the session is established. */
export function BrandingRealtimeSync() {
  const { refetch } = useTenantBranding();
  const tenant = useCurrentTenant();
  useRealtimeRefresh({
    topics: ["settings"],
    tenantId: tenant.id ?? 0,
    enabled: !tenant.isLoading,
    accepts: (event) => event.collection === "branding",
    refresh: () => refetch({ reload: true }),
  });
  return null;
}
