import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/api/api-client";
import { hashKey } from "@tanstack/react-query";
import { currentTenantQueryOptions } from "./current-tenant-query";

describe("currentTenantQueryOptions", () => {
  it("keys the read by session generation and hostname", async () => {
    const get = vi.fn().mockResolvedValue({ data: { id: 1 } });
    const options = currentTenantQueryOptions({
      apiClient: { get } as unknown as ApiClient,
      sessionGeneration: 3,
      hostname: "merka.savia.app.hefesoft.com",
    });

    expect(options.queryKey).toEqual([
      "savia-read",
      3,
      "tenant",
      "merka.savia.app.hefesoft.com",
      "current-tenant",
      { hostname: "merka.savia.app.hefesoft.com" },
    ]);
    expect(
      hashKey(
        currentTenantQueryOptions({
          apiClient: { get } as unknown as ApiClient,
          sessionGeneration: 4,
          hostname: "merka.savia.app.hefesoft.com",
        }).queryKey,
      ),
    ).not.toBe(hashKey(options.queryKey));
  });

  it("passes the query abort signal to the API client", async () => {
    const get = vi.fn().mockResolvedValue({ data: { id: 1 } });
    const options = currentTenantQueryOptions({
      apiClient: { get } as unknown as ApiClient,
      sessionGeneration: 3,
      hostname: "merka.savia.app.hefesoft.com",
    });
    const controller = new AbortController();

    await options.queryFn({
      queryKey: options.queryKey,
      signal: controller.signal,
      meta: undefined,
      client: {} as never,
    });

    expect(get).toHaveBeenCalledWith("/v1/tenants/current", {
      signal: controller.signal,
    });
  });
});
