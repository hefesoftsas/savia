import { useTenantBranding } from "@/features/tenant-branding/tenant-branding-provider";
import { useCurrentTenant } from "@/features/tenants/use-current-tenant";
import { useRealtimeRefresh } from "./use-realtime-refresh";

/** Mount inside the authenticated layout, after the session is established. */
export function BrandingRealtimeSync() {
  const { refetch } = useTenantBranding();
  const tenant = useCurrentTenant();
  const hasTenant =
    typeof tenant.id === "number" &&
    Number.isSafeInteger(tenant.id) &&
    tenant.id > 0;
  const canSubscribe =
    hasTenant || (!tenant.isDedicated && tenant.isPlatformAdmin);
  useRealtimeRefresh({
    topics: ["settings"],
    tenantId: hasTenant ? tenant.id! : 0,
    enabled: !tenant.isLoading && canSubscribe,
    accepts: (event) => event.collection === "branding",
    refresh: () => refetch({ reload: true }),
  });
  return null;
}
