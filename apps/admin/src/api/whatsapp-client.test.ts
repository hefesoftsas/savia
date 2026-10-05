import { describe, expect, it, vi } from "vitest";
import { WhatsappClient } from "./whatsapp-client";

describe("WhatsappClient", () => {
  it("uses only Savia's curated WhatsApp paths and opaque connection identifiers", async () => {
    const api = {
      get: vi
        .fn()
        .mockResolvedValueOnce({
          data: [
            {
              id: "whatsapp",
              kind: "whatsapp-provider",
              attributes: {
                displayName: "WhatsApp",
                availability: "enabled",
                capabilities: ["messages:write"],
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
            kind: "whatsapp-connection",
            attributes: {
              agencyId: 101,
              provider: "whatsapp",
              status: "connected",
              phoneNumberId: "123456789012345",
              displayPhoneNumber: "+573001234567",
              wabaId: "987654321098765",
              externalAccountLabel: "Acme",
              lastValidatedAt: null,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          },
        })
        .mockResolvedValueOnce({ data: { messageId: "wamid.test" } }),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const client = new WhatsappClient(api as never);

    await expect(client.listProviders(101)).resolves.toEqual([
      {
        id: "whatsapp",
        displayName: "WhatsApp",
        availability: "enabled",
        capabilities: ["messages:write"],
      },
    ]);
    await expect(client.listConnections(101)).resolves.toEqual([]);
    await expect(
      client.createConnectSession(false, 101),
    ).resolves.toMatchObject({ token: "opaque-connect-session" });
    await expect(
      client.complete("nango-connection-1", {
        agencyId: 101,
        phoneNumberId: "123456789012345",
      }),
    ).resolves.toMatchObject({
      id: "connection-1",
      phoneNumberId: "123456789012345",
    });
    await expect(
      client.testSend({ agencyId: 101, to: "+573001234567", text: "Hola" }),
    ).resolves.toEqual({ messageId: "wamid.test" });
    await expect(client.disconnect(101)).resolves.toBeUndefined();

    expect(api.get).toHaveBeenCalledWith("/v1/whatsapp/providers?agencyId=101");
    expect(api.get).toHaveBeenCalledWith(
      "/v1/whatsapp/connections?agencyId=101",
    );
    expect(api.post).toHaveBeenCalledWith(
      "/v1/whatsapp/connections/connect-session",
      { agencyId: 101 },
    );
    expect(api.post).toHaveBeenCalledWith(
      "/v1/whatsapp/connections/complete",
      expect.objectContaining({ connectionId: "nango-connection-1" }),
    );
    const rawBodies = [
      api.get.mock.calls,
      api.post.mock.calls,
      api.delete.mock.calls,
    ].flat(2);
    expect(JSON.stringify(rawBodies)).not.toContain("NANGO_API_KEY");
  });
});
