import type { AppServices } from "@/app-services";

export type StudioDomain = {
  id: string;
  label: string;
  agencyId?: number;
  tenantId?: number;
  apiBasePath: string;
  kind: "platform" | "custom" | "agency" | "tenant";
};
export const STUDIO_DOMAINS_CHANGED = "savia-studio-domains-changed";
export async function listStudioDomains(
  services: AppServices,
): Promise<StudioDomain[]> {
  // The authorized workspace catalog must reflect tenant creation and access changes
  // immediately. Background-only metadata revalidation leaves the selector stale.
  return (
    await services.apiClient.get<{ data: StudioDomain[] }>("/v1/data-domains")
  ).data;
}
export function selectStudioDomain(
  domains: StudioDomain[],
  domain?: string | null,
  agencyId?: number,
  tenantId?: number,
): StudioDomain | undefined {
  if (domain) return domains.find((item) => item.id === domain);
  const targetId = tenantId ?? agencyId;
  if (targetId)
    return domains.find(
      (item) => (item.tenantId ?? item.agencyId) === targetId,
    );
  return (
    domains.find((item) => item.kind === "platform") ??
    (domains.length === 1 ? domains[0] : undefined)
  );
}
