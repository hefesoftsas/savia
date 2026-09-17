import type { AppServices } from "@/app-services";

export type CrmDomain = {
  id: string;
  label: string;
  agencyId?: number;
  tenantId?: number;
  apiBasePath: string;
  kind: "platform" | "custom" | "agency" | "tenant";
};
export const CRM_DOMAINS_CHANGED = "savia-crm-domains-changed";
export async function listCrmDomains(
  services: AppServices,
): Promise<CrmDomain[]> {
  const response = await services.apiClient.get<{ data: CrmDomain[] }>(
    "/v1/data-domains",
  );
  return response.data;
}
export function selectCrmDomain(
  domains: CrmDomain[],
  domain?: string | null,
  agencyId?: number,
): CrmDomain | undefined {
  if (domain) return domains.find((item) => item.id === domain);
  if (agencyId) return domains.find((item) => item.agencyId === agencyId);
  return (
    domains.find((item) => item.kind === "platform") ??
    (domains.length === 1 ? domains[0] : undefined)
  );
}
