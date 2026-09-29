import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./api-client";
import {
  fetchTenantWorkspaces,
  invalidateTenantWorkspaces,
  type TenantWorkspace,
} from "./tenant-workspaces-client";

const workspaces: TenantWorkspace[] = [
  {
    id: "tenant:0",
    tenantId: 0,
    label: "Platform",
    kind: "platform",
    apiBasePath: "/v1/studio/0",
  },
  {
    id: "tenant:7",
    tenantId: 7,
    label: "North",
    kind: "tenant",
    apiBasePath: "/v1/studio/7",
  },
];

describe("tenant workspace catalog", () => {
  beforeEach(invalidateTenantWorkspaces);

  it("fetches the authorized tenant workspace catalog", async () => {
    const get = vi.fn().mockResolvedValue({ data: workspaces });
    const client = { get } as unknown as ApiClient;

    await expect(fetchTenantWorkspaces(client)).resolves.toEqual(workspaces);
    expect(get).toHaveBeenCalledWith("/v1/tenant-workspaces");
  });

  it("deduplicates concurrent catalog requests and caches the result", async () => {
    let resolveGet!: (value: { data: TenantWorkspace[] }) => void;
    const get = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveGet = resolve;
      }),
    );
    const client = { get } as unknown as ApiClient;

    const first = fetchTenantWorkspaces(client);
    const second = fetchTenantWorkspaces(client);
    resolveGet({ data: workspaces });

    await expect(Promise.all([first, second])).resolves.toEqual([
      workspaces,
      workspaces,
    ]);
    await fetchTenantWorkspaces(client);
    expect(get).toHaveBeenCalledTimes(1);
  });
});
