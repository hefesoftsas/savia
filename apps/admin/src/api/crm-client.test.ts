import { describe, expect, it, vi } from "vitest";
import { CrmClient } from "./crm-client";

describe("CrmClient", () => {
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
                connectionBlocked: false,
                activeProvider: "hubspot",
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
        connectionBlocked: false,
        activeProvider: "hubspot",
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
