import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./api-client";
import {
  DomainClient,
  fetchDataDomains,
  invalidateSharedDataDomains,
  type DataDomainItem,
} from "./domain-client";

describe("DomainClient and fetchDataDomains", () => {
  beforeEach(() => {
    invalidateSharedDataDomains();
  });

  const mockDomains: DataDomainItem[] = [
    {
      id: "platform",
      label: "Plataforma",
      kind: "platform",
      apiBasePath: "/v1/data-domains/platform",
    },
    {
      id: "seguros",
      label: "Seguros",
      kind: "custom",
      apiBasePath: "/v1/data-domains/seguros",
    },
  ];

  it("deduplicates concurrent in-flight requests to /v1/data-domains", async () => {
    let resolveGet!: (value: { data: DataDomainItem[] }) => void;
    const getFn = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveGet = resolve;
      }),
    );
    const mockClient = { get: getFn } as unknown as ApiClient;

    const promise1 = fetchDataDomains(mockClient);
    const promise2 = fetchDataDomains(mockClient);

    expect(getFn).toHaveBeenCalledTimes(1);
    expect(getFn).toHaveBeenCalledWith("/v1/data-domains");

    resolveGet({ data: mockDomains });
    const [res1, res2] = await Promise.all([promise1, promise2]);

    expect(res1).toEqual(mockDomains);
    expect(res2).toEqual(mockDomains);
  });

  it("serves from 30s cache on sequential calls within TTL", async () => {
    const getFn = vi.fn().mockResolvedValue({ data: mockDomains });
    const mockClient = { get: getFn } as unknown as ApiClient;

    const res1 = await fetchDataDomains(mockClient);
    const res2 = await fetchDataDomains(mockClient);

    expect(res1).toEqual(mockDomains);
    expect(res2).toEqual(mockDomains);
    expect(getFn).toHaveBeenCalledTimes(1);
  });

  it("fetches fresh data after invalidateSharedDataDomains", async () => {
    const getFn = vi.fn().mockResolvedValue({ data: mockDomains });
    const mockClient = { get: getFn } as unknown as ApiClient;

    await fetchDataDomains(mockClient);
    expect(getFn).toHaveBeenCalledTimes(1);

    invalidateSharedDataDomains();

    await fetchDataDomains(mockClient);
    expect(getFn).toHaveBeenCalledTimes(2);
  });

  it("clears in-flight promise on error so subsequent call can retry", async () => {
    const getFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({ data: mockDomains });
    const mockClient = { get: getFn } as unknown as ApiClient;

    await expect(fetchDataDomains(mockClient)).rejects.toThrow("Network error");
    expect(getFn).toHaveBeenCalledTimes(1);

    const res = await fetchDataDomains(mockClient);
    expect(res).toEqual(mockDomains);
    expect(getFn).toHaveBeenCalledTimes(2);
  });

  it("DomainClient class methods delegate correctly", async () => {
    const getFn = vi.fn().mockResolvedValue({ data: mockDomains });
    const mockClient = { get: getFn } as unknown as ApiClient;
    const client = new DomainClient(mockClient);

    const domains = await client.listDataDomains();
    expect(domains).toEqual(mockDomains);
    expect(getFn).toHaveBeenCalledWith("/v1/data-domains");

    client.invalidateDataDomains();
    await client.listDataDomains();
    expect(getFn).toHaveBeenCalledTimes(2);
  });
});
