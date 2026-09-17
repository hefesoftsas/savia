import { describe, expect, it, vi } from "vitest";
import type { AppActor } from "../src/auth/types";
import { CrmUnavailableError, CrmUpstreamError } from "../src/crm/contracts";
import { createNangoClient } from "../src/crm/nango";
import { createCrmProviderRegistry } from "../src/crm/providers";

const actor: AppActor = {
  principal: {
    id: "agency-administrator",
    issuer: "savia:test",
    subject: "agency-administrator",
    email: "administrator@acme.test",
    displayName: "Agency Administrator",
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  globalRoles: [],
  memberships: [],
};

const configuredNango = {
  baseUrl: "https://nango.example.test/",
  connectUrl: "https://connect.nango.example.test/",
  apiKey: "test-nango-api-key",
  hubspotIntegrationId: "hubspot-savia",
};

function requestFromCall(call: unknown[]): Request {
  const [input, init] = call;
  return new Request(input as RequestInfo, init as RequestInit | undefined);
}

describe("Nango CRM boundary", () => {
  it("builds a Worker-compatible request and never follows credential-bearing redirects", async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        expect(request.redirect).toBe("manual");
        expect(request.signal).toBeDefined();
        return new Response(null, {
          status: 302,
          headers: { location: "https://another.example.test" },
        });
      },
    );
    const client = createNangoClient(configuredNango, fetcher as typeof fetch);
    const response = await client.proxy({
      method: "POST",
      path: "/crm/v3/objects/contacts/search",
      body: { limit: 1 },
      connection: {
        id: "connection",
        agencyId: 101,
        provider: "hubspot",
        status: "connected",
        externalAccountId: "123",
        externalAccountLabel: null,
        scopes: [],
        lastValidatedAt: null,
        createdAt: "",
        updatedAt: "",
        nangoConnectionId: "nango-connection",
        nangoIntegrationId: "hubspot-savia",
      },
    });
    expect(response.status).toBe(302);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("allows CRM metadata, associations and archive requests but rejects unrelated proxy targets", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = createNangoClient(configuredNango, fetcher as typeof fetch);
    const connection = { id: "c", agencyId: 1, provider: "hubspot" as const,
      status: "connected" as const, externalAccountId: "123", externalAccountLabel: null,
      scopes: [], lastValidatedAt: null, createdAt: "", updatedAt: "",
      nangoConnectionId: "n", nangoIntegrationId: "hubspot-savia" };
    for (const path of ["/crm/v3/properties/deals", "/crm/v3/pipelines/deals",
      "/crm/v3/objects/contacts/123/associations/deals", "/crm/v3/objects/tickets/batch/read"]) {
      await client.proxy({ method: "GET", path, connection });
    }
    await client.proxy({ method: "DELETE", path: "/crm/v3/objects/deals/123", connection });
    expect(requestFromCall(fetcher.mock.calls.at(-1)! ).method).toBe("DELETE");
    await client.proxy({ method: "GET", path: "/crm/v4/associations/contacts/deals/labels", connection });
    await client.proxy({ method: "PUT", path: "/crm/v4/objects/contacts/123/associations/default/deals/456", connection });
    expect(requestFromCall(fetcher.mock.calls.at(-1)!).method).toBe("PUT");
    await client.proxy({ method: "DELETE", path: "/crm/v4/objects/contacts/123/associations/deals/456", connection });
    for (const path of ["https://attacker.test/crm/v3/objects/contacts", "/crm/v3/objects/custom",
      "/crm/v3/objects/contacts/123/associations/secrets", "/marketing/v3/emails/send", "/crm/v4/associations/contacts/private/labels", "/crm/v4/objects/contacts/123/associations/private/456"]) {
      await expect(client.proxy({ method: "POST", path, connection })).rejects.toBeInstanceOf(CrmUnavailableError);
    }
    expect(fetcher).toHaveBeenCalledTimes(8);
  });

  it("creates a HubSpot Connect session with one integration and agency tags", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        data: {
          token: "short-lived-connect-token",
          expires_at: "2026-01-01T01:00:00.000Z",
        },
      }),
    );
    const client = createNangoClient(configuredNango, fetcher as typeof fetch);

    const session = await client.createConnectSession({
      actor,
      agencyId: 101,
      provider: "hubspot",
    });

    expect(session).toEqual({
      token: "short-lived-connect-token",
      expiresAt: "2026-01-01T01:00:00.000Z",
      connectUrl: "https://connect.nango.example.test",
      apiUrl: "https://nango.example.test",
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    const request = requestFromCall(fetcher.mock.calls[0] ?? []);
    expect(request.url).toBe("https://nango.example.test/connect/sessions");
    expect(request.method).toBe("POST");
    expect(request.headers.get("authorization")).toBe(
      "Bearer test-nango-api-key",
    );
    const body = await request.json();
    expect(body).toEqual({
      end_user: {
        id: "agency-administrator",
        email: "administrator@acme.test",
        display_name: "Agency Administrator",
      },
      organization: { id: "user:agency-administrator" },
      allowed_integrations: ["hubspot-savia"],
      tags: { organization_id: "user:agency-administrator", agency_id: "101" },
    });
    expect(JSON.stringify(body)).not.toContain("test-nango-api-key");
    expect(JSON.stringify(session)).not.toContain("test-nango-api-key");
  });

  it("queries and removes Nango connections using a provider config query", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          data: {
            connection_id: "hubspot-connection",
            provider_config_key: "hubspot-savia",
            organization: { id: "user:agency-administrator" },
            metadata: {
              scopes: ["crm.objects.contacts.read"],
              access_token: "must-not-be-returned",
            },
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createNangoClient(configuredNango, fetcher as typeof fetch);

    await expect(
      client.getConnection("hubspot connection", "hubspot-savia"),
    ).resolves.toEqual({
      connectionId: "hubspot-connection",
      providerConfigKey: "hubspot-savia",
      organizationId: "user:agency-administrator",
      metadata: { scopes: ["crm.objects.contacts.read"] },
      scopes: ["crm.objects.contacts.read"],
      scopeSource: "metadata",
    });
    await expect(
      client.deleteConnection("hubspot connection", "hubspot-savia"),
    ).resolves.toBeUndefined();

    const requests = fetcher.mock.calls.map(requestFromCall);
    expect(requests.map((request) => request.url)).toEqual([
      "https://nango.example.test/connections/hubspot%20connection?provider_config_key=hubspot-savia",
      "https://nango.example.test/connections/hubspot%20connection?provider_config_key=hubspot-savia",
    ]);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[1]?.method).toBe("DELETE");
    expect(
      requests.map((request) => request.headers.get("authorization")),
    ).toEqual(["Bearer test-nango-api-key", "Bearer test-nango-api-key"]);
  });

  it("reads the direct connection document returned by current Nango", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        id: 42,
        connection_id: "hubspot-connection",
        provider_config_key: "hubspot-savia",
        provider: "hubspot",
        errors: [],
        end_user: {
          id: "agency-administrator",
          display_name: "Agency Administrator",
          email: "administrator@acme.test",
          tags: {},
          organization: {
            id: "user:agency-administrator",
            display_name: "Acme Brokers",
          },
        },
        tags: {
          agency_id: "101",
          organization_id: "user:agency-administrator",
        },
        metadata: { scopes: ["crm.objects.contacts.read"] },
        connection_config: {},
        webhook_url_override: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        last_fetched_at: null,
        credentials: {},
      }),
    );
    const client = createNangoClient(configuredNango, fetcher as typeof fetch);

    await expect(
      client.getConnection("hubspot-connection", "hubspot-savia"),
    ).resolves.toEqual({
      connectionId: "hubspot-connection",
      providerConfigKey: "hubspot-savia",
      organizationId: "user:agency-administrator",
      metadata: { scopes: ["crm.objects.contacts.read"] },
      scopes: ["crm.objects.contacts.read"],
      scopeSource: "metadata",
    });
  });

  it("uses Nango credential scopes and emits a token-free Cloudflare diagnostic", async () => {
    const accessToken = "access-token-must-not-be-logged";
    const refreshToken = "refresh-token-must-not-be-logged";
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        data: {
          connection_id: "hubspot-connection",
          provider_config_key: "hubspot-savia",
          organization: { id: "user:agency-administrator" },
          metadata: { scopes: ["crm.objects.contacts.read"] },
          credentials: {
            raw: {
              scopes: [
                "crm.objects.contacts.read",
                "crm.objects.contacts.write",
              ],
              access_token: accessToken,
              refresh_token: refreshToken,
            },
          },
        },
      }),
    );
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const client = createNangoClient(configuredNango, fetcher as typeof fetch);

    await expect(
      client.getConnection("hubspot-connection", "hubspot-savia"),
    ).resolves.toMatchObject({
      connectionId: "hubspot-connection",
      scopes: ["crm.objects.contacts.read", "crm.objects.contacts.write"],
      scopeSource: "credentials.raw",
    });
    expect(info).toHaveBeenCalledWith({
      event: "crm.nango.connection_scopes",
      provider: "hubspot",
      scopeSource: "credentials.raw",
      scopeCount: 2,
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain(accessToken);
    expect(JSON.stringify(info.mock.calls)).not.toContain(refreshToken);
    info.mockRestore();
  });

  it("reports Nango failures with a stable error that excludes upstream secrets", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          "upstream response including test-nango-api-key and short-lived-connect-token",
          { status: 502 },
        ),
      );
    const client = createNangoClient(configuredNango, fetcher as typeof fetch);

    let thrown: unknown;
    try {
      await client.getConnection("hubspot-connection", "hubspot-savia");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CrmUpstreamError);
    expect(thrown).toMatchObject({ code: "NANGO_REQUEST_FAILED" });
    expect(JSON.stringify(thrown)).not.toContain("test-nango-api-key");
    expect(JSON.stringify(thrown)).not.toContain("short-lived-connect-token");
    expect(thrown instanceof Error ? thrown.message : "").not.toContain(
      "test-nango-api-key",
    );
  });

  it.each([
    [{ ...configuredNango, baseUrl: undefined }],
    [{ ...configuredNango, apiKey: undefined }],
    [{ ...configuredNango, hubspotIntegrationId: undefined }],
  ])(
    "keeps HubSpot unavailable without a complete Nango configuration",
    async (configuration) => {
      const fetcher = vi.fn();
      const client = createNangoClient(configuration, fetcher as typeof fetch);

      expect(
        createCrmProviderRegistry(configuration).hubspot.availability,
      ).toBe("unavailable");
      await expect(
        client.createConnectSession({
          actor,
          agencyId: 101,
          provider: "hubspot",
        }),
      ).rejects.toBeInstanceOf(CrmUnavailableError);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
});
