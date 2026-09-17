import { describe, expect, it, vi } from "vitest";
import { CrmClient } from "./crm-client";

describe("CrmClient", () => {
  it("uses the typed automatic sync rule and job endpoints", async () => {
    const api = {
      get: vi
        .fn()
        .mockResolvedValueOnce({
          data: { rules: [], tenants: [{ id: 101, name: "Norte" }] },
        })
        .mockResolvedValueOnce({ data: [{ id: "job-1", status: "failed" }] }),
      post: vi
        .fn()
        .mockResolvedValueOnce({ data: { id: "rule-1", enabled: true } })
        .mockResolvedValueOnce({ data: { queued: true } }),
      patch: vi
        .fn()
        .mockResolvedValue({ data: { id: "rule-1", enabled: false } }),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const client = new CrmClient(api as never);

    await expect(client.listSyncRules()).resolves.toMatchObject({
      tenants: [{ id: 101 }],
    });
    await expect(client.createSyncRule(101)).resolves.toMatchObject({
      enabled: true,
    });
    await expect(
      client.setSyncRuleEnabled("rule-1", false),
    ).resolves.toMatchObject({ enabled: false });
    await client.deleteSyncRule("rule-1");
    await expect(client.listSyncJobs(42)).resolves.toMatchObject([
      { id: "job-1" },
    ]);
    await expect(client.retrySyncJob("job/1")).resolves.toEqual({
      queued: true,
    });

    expect(api.get).toHaveBeenNthCalledWith(1, "/v1/crm/sync-rules");
    expect(api.post).toHaveBeenNthCalledWith(1, "/v1/crm/sync-rules", {
      tenantId: 101,
      provider: "hubspot",
    });
    expect(api.patch).toHaveBeenCalledWith("/v1/crm/sync-rules/rule-1", {
      enabled: false,
    });
    expect(api.delete).toHaveBeenCalledWith("/v1/crm/sync-rules/rule-1");
    expect(api.get).toHaveBeenNthCalledWith(
      2,
      "/v1/crm/sync-jobs?customerId=42",
    );
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      "/v1/crm/sync-jobs/job%2F1/retry",
      {},
    );
  });
  it("uses only Savia's curated CRM paths and opaque connection identifiers", async () => {
    const api = {
      get: vi
        .fn()
        .mockResolvedValueOnce({
          data: [
            {
              id: "hubspot",
              kind: "crm-provider",
              attributes: {
                displayName: "HubSpot",
                availability: "enabled",
                capabilities: ["contacts:read"],
              },
            },
          ],
        })
        .mockResolvedValueOnce({ data: [] }),
      post: vi
        .fn()
        .mockResolvedValueOnce({
          data: {
            token: "opaque-connect-session",
            expiresAt: "2026-01-01T01:00:00.000Z",
            connectUrl: "https://connect.nango.example.test",
            apiUrl: "https://nango.example.test",
          },
        })
        .mockResolvedValueOnce({
          data: {
            id: "connection-1",
            kind: "crm-connection",
            attributes: {
              agencyId: 101,
              provider: "hubspot",
              status: "connected",
              externalAccountLabel: "Acme Insurance",
              scopes: [],
              lastValidatedAt: null,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          },
        }),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const client = new CrmClient(api as never);

    await expect(client.listProviders(101)).resolves.toEqual([
      {
        id: "hubspot",
        displayName: "HubSpot",
        availability: "enabled",
        capabilities: ["contacts:read"],
      },
    ]);
    await expect(client.listConnections(101)).resolves.toEqual([]);
    await expect(
      client.createConnectSession("hubspot", false, 101),
    ).resolves.toEqual({
      token: "opaque-connect-session",
      expiresAt: "2026-01-01T01:00:00.000Z",
      connectUrl: "https://connect.nango.example.test",
      apiUrl: "https://nango.example.test",
    });
    await expect(
      client.complete("hubspot", "nango-connection-id", 101),
    ).resolves.toMatchObject({ id: "connection-1", status: "connected" });
    await expect(client.disconnect("hubspot", 101)).resolves.toBeUndefined();

    expect(api.get).toHaveBeenNthCalledWith(
      1,
      "/v1/crm/providers?agencyId=101",
    );
    expect(api.get).toHaveBeenNthCalledWith(
      2,
      "/v1/crm/connections?agencyId=101",
    );
    expect(api.post).toHaveBeenNthCalledWith(
      1,
      "/v1/crm/connections/hubspot/connect-session",
      { agencyId: 101 },
    );
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      "/v1/crm/connections/hubspot/complete",
      { agencyId: 101, connectionId: "nango-connection-id" },
    );
    expect(api.delete).toHaveBeenCalledWith(
      "/v1/crm/connections/hubspot?agencyId=101",
    );
  });
});
