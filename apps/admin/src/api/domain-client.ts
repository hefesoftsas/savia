import type { ApiClient } from "./api-client";
import type { DomainDescriptor } from "./domain-types";

export type DataDomainItem = {
  id: string;
  label: string;
  kind: "platform" | "custom" | "agency" | "tenant";
  apiBasePath: string;
  agencyId?: number;
  tenantId?: number;
};

let sharedDataDomainsPromise: Promise<DataDomainItem[]> | null = null;
let sharedDataDomainsCache: {
  data: DataDomainItem[];
  timestamp: number;
} | null = null;

export function invalidateSharedDataDomains(): void {
  sharedDataDomainsCache = null;
  sharedDataDomainsPromise = null;
}

if (typeof window !== "undefined") {
  window.addEventListener("savia-studio-domains-changed", () => {
    invalidateSharedDataDomains();
  });
}

export async function fetchDataDomains(
  client: ApiClient,
): Promise<DataDomainItem[]> {
  if (
    sharedDataDomainsCache &&
    Date.now() - sharedDataDomainsCache.timestamp < 30_000
  ) {
    return sharedDataDomainsCache.data;
  }
  if (sharedDataDomainsPromise) {
    return sharedDataDomainsPromise;
  }
  sharedDataDomainsPromise = client
    .get<{ data: DataDomainItem[] }>("/v1/data-domains")
    .then((res) => {
      sharedDataDomainsCache = { data: res.data, timestamp: Date.now() };
      sharedDataDomainsPromise = null;
      return res.data;
    })
    .catch((err) => {
      sharedDataDomainsPromise = null;
      throw err;
    });
  return sharedDataDomainsPromise;
}

export class DomainClient {
  constructor(private readonly client: ApiClient) {}

  invalidateDataDomains(): void {
    invalidateSharedDataDomains();
  }

  async listDataDomains(): Promise<DataDomainItem[]> {
    return fetchDataDomains(this.client);
  }

  async list(): Promise<DomainDescriptor[]> {
    return (await this.client.get<{ data: DomainDescriptor[] }>("/v1/domains"))
      .data;
  }
}
