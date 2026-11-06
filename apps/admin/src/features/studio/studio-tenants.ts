import type { AppServices } from "@/app-services";
import {
  fetchTenantWorkspaces,
  type TenantWorkspace,
} from "@/api/tenant-workspaces-client";

export type StudioTenant = TenantWorkspace;
export const STUDIO_TENANTS_CHANGED = "savia-studio-tenants-changed";

export function listStudioTenants(
  services: AppServices,
): Promise<StudioTenant[]> {
  return fetchTenantWorkspaces(services.apiClient);
}

export function selectStudioTenant(
  tenants: StudioTenant[],
  tenantId?: number | null,
): StudioTenant | undefined {
  if (tenantId !== undefined && tenantId !== null) {
    return tenants.find((item) => item.tenantId === tenantId);
  }
  return tenants.length === 1 ? tenants[0] : undefined;
}
