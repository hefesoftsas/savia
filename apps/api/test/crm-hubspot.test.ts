import { describe, expect, it, vi } from "vitest";
import type {
  ActiveCrmConnection,
  NangoClient,
  NangoConnectionSummary,
} from "../src/external-crm/contracts";
import { CrmUpstreamError, crmListQuerySchema } from "../src/external-crm/contracts";
import { createHubSpotAdapter } from "../src/external-crm/hubspot";

const connection: ActiveCrmConnection = {
  id: "savia-hubspot-connection",
  agencyId: 101,
  provider: "hubspot",
  status: "connected",
  externalAccountId: null,
  externalAccountLabel: null,
  scopes: [],
  lastValidatedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  nangoConnectionId: "nango-hubspot-connection",
  nangoIntegrationId: "hubspot-savia",
};

function nangoClient(
  proxy: ReturnType<typeof vi.fn>,
  getConnection = vi.fn().mockResolvedValue({
    connectionId: "nango-hubspot-connection",
    providerConfigKey: "hubspot-savia",
    organizationId: "agency:101",
    metadata: {},
    scopes: [],
    scopeSource: "none",
  } satisfies NangoConnectionSummary),
): NangoClient {
  return {
    createConnectSession: vi.fn(),
    getConnection,
    deleteConnection: vi.fn(),
    proxy,
  } as NangoClient;
}

describe("HubSpot CRM adapter", () => {
  it("accepts only bounded list limits before the adapter builds a request", () => {
    expect(crmListQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(crmListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(crmListQuerySchema.parse({ limit: 100, search: "acme" })).toEqual({
      limit: 100,
      search: "acme",
    });
  });

  it("validates only safe account data and granted scopes", async () => {
    const proxy = vi
      .fn()
      .mockResolvedValue(
        Response.json({ portalId: 424242, accountName: "Acme Insurance" }),
      );
    const getConnection = vi.fn().mockResolvedValue({
      connectionId: "nango-hubspot-connection",
      providerConfigKey: "hubspot-savia",
      organizationId: "agency:101",
      metadata: {
        scopes: ["crm.objects.contacts.read", "crm.objects.contacts.write"],
        access_token: "not-exposed",
      },
      scopes: ["crm.objects.contacts.read", "crm.objects.contacts.write"],
      scopeSource: "metadata",
    } satisfies NangoConnectionSummary);
    const adapter = createHubSpotAdapter(nangoClient(proxy, getConnection));

    await expect(adapter.validate(connection)).resolves.toEqual({
      externalAccountId: "424242",
      externalAccountLabel: "Acme Insurance",
      scopes: ["crm.objects.contacts.read", "crm.objects.contacts.write"],
    });
    expect(proxy).toHaveBeenCalledWith({
      method: "GET",
      path: "/account-info/v3/details",
      connection,
    });
    expect(getConnection).toHaveBeenCalledWith(
      "nango-hubspot-connection",
      "hubspot-savia",
    );
  });

  it("preserves whitespace-delimited HubSpot scopes returned by Nango", async () => {
    const proxy = vi
      .fn()
      .mockResolvedValue(
        Response.json({ portalId: 424242, accountName: "Acme Insurance" }),
      );
    const getConnection = vi.fn().mockResolvedValue({
      connectionId: "nango-hubspot-connection",
      providerConfigKey: "hubspot-savia",
      organizationId: "agency:101",
      metadata: {
        scopes: "crm.objects.contacts.read crm.objects.contacts.write",
      },
      scopes: ["crm.objects.contacts.read", "crm.objects.contacts.write"],
      scopeSource: "metadata",
    } satisfies NangoConnectionSummary);
    const adapter = createHubSpotAdapter(nangoClient(proxy, getConnection));

    await expect(adapter.validate(connection)).resolves.toMatchObject({
      scopes: ["crm.objects.contacts.read", "crm.objects.contacts.write"],
    });
  });

  it("persists granted credential scopes even when Nango metadata is empty", async () => {
    const proxy = vi
      .fn()
      .mockResolvedValue(
        Response.json({ portalId: 424242, accountName: "Acme Insurance" }),
      );
    const getConnection = vi.fn().mockResolvedValue({
      connectionId: "nango-hubspot-connection",
      providerConfigKey: "hubspot-savia",
      organizationId: "agency:101",
      metadata: {},
      scopes: ["crm.objects.contacts.read", "crm.objects.contacts.write"],
      scopeSource: "credentials.raw",
    });
    const adapter = createHubSpotAdapter(nangoClient(proxy, getConnection));

    await expect(adapter.validate(connection)).resolves.toMatchObject({
      scopes: ["crm.objects.contacts.read", "crm.objects.contacts.write"],
    });
  });

  it("uses fixed contacts paths and moves text search into HubSpot filter groups", async () => {
    const proxy = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          results: [
            {
              id: "contact-1",
              properties: {
                email: "ada@acme.test",
                firstname: "Ada",
                lastname: "Lovelace",
                associatedcompanyid: "company-1",
                lastmodifieddate: "2026-01-01T00:00:00.000Z",
                secret: "must-be-ignored",
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(Response.json({ results: [] }));
    const adapter = createHubSpotAdapter(nangoClient(proxy));

    await expect(
      adapter.listContacts(connection, { limit: 25 }),
    ).resolves.toEqual([
      {
        id: "contact-1",
        email: "ada@acme.test",
        firstName: "Ada",
        lastName: "Lovelace",
        companyId: "company-1",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    await expect(
      adapter.listContacts(connection, { limit: 10, search: "ada@acme.test" }),
    ).resolves.toEqual([]);

    expect(proxy.mock.calls[0]?.[0]).toEqual({
      method: "GET",
      path: "/crm/v3/objects/contacts?limit=25&properties=email&properties=firstname&properties=lastname&properties=associatedcompanyid&properties=lastmodifieddate",
      connection,
    });
    expect(proxy.mock.calls[1]?.[0]).toEqual({
      method: "POST",
      path: "/crm/v3/objects/contacts/search",
      connection,
      body: {
        filterGroups: [
          {
            filters: [
              {
                propertyName: "email",
                operator: "CONTAINS_TOKEN",
                value: "ada@acme.test",
              },
            ],
          },
        ],
        properties: [
          "email",
          "firstname",
          "lastname",
          "associatedcompanyid",
          "lastmodifieddate",
        ],
        limit: 10,
      },
    });
  });

  it("finds initial customer matches with exact email and company-name filters", async () => {
    const proxy = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          results: [
            {
              id: "contact-1",
              properties: { email: "ada@acme.test" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          results: [
            {
              id: "company-1",
              properties: { name: "Acme S.A.S." },
            },
          ],
        }),
      );
    const adapter = createHubSpotAdapter(nangoClient(proxy));

    await expect(
      adapter.findContactByEmail(connection, "ada@acme.test"),
    ).resolves.toMatchObject([{ id: "contact-1", email: "ada@acme.test" }]);
    await expect(
      adapter.findCompanyByName(connection, "Acme S.A.S."),
    ).resolves.toMatchObject([{ id: "company-1", name: "Acme S.A.S." }]);

    expect(proxy.mock.calls.map((call) => call[0])).toEqual([
      {
        method: "POST",
        path: "/crm/v3/objects/contacts/search",
        connection,
        body: {
          filterGroups: [
            {
              filters: [
                {
                  propertyName: "email",
                  operator: "EQ",
                  value: "ada@acme.test",
                },
              ],
            },
          ],
          properties: [
            "email",
            "firstname",
            "lastname",
            "associatedcompanyid",
            "lastmodifieddate",
          ],
          limit: 2,
        },
      },
      {
        method: "POST",
        path: "/crm/v3/objects/companies/search",
        connection,
        body: {
          filterGroups: [
            {
              filters: [
                {
                  propertyName: "name",
                  operator: "EQ",
                  value: "Acme S.A.S.",
                },
              ],
            },
          ],
          properties: ["name", "domain", "hs_lastmodifieddate"],
          limit: 2,
        },
      },
    ]);
  });

  it("writes normalized contacts and URL-encodes contact identifiers", async () => {
    const proxy = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          id: "contact-2",
          properties: {
            email: "grace@acme.test",
            firstname: "Grace",
            lastname: "Hopper",
            lastmodifieddate: "2026-01-01T00:00:00.000Z",
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "contact-2",
          properties: {
            email: "grace@acme.test",
            firstname: "Rear Admiral Grace",
            lastname: "Hopper",
          },
        }),
      );
    const adapter = createHubSpotAdapter(nangoClient(proxy));
    const input = {
      email: "grace@acme.test",
      firstName: "Grace",
      lastName: "Hopper",
      phone: "+57 300 123 4567",
      address: "Calle 1 # 2-3",
      city: "Bogotá",
      state: "Cundinamarca",
      companyId: "company-2",
    };

    await expect(
      adapter.createContact(connection, input),
    ).resolves.toMatchObject({
      id: "contact-2",
      email: "grace@acme.test",
      companyId: null,
    });
    await expect(
      adapter.updateContact(connection, "contact / 2", {
        firstName: "Rear Admiral Grace",
      }),
    ).resolves.toMatchObject({
      id: "contact-2",
      firstName: "Rear Admiral Grace",
    });

    expect(proxy.mock.calls[0]?.[0]).toEqual({
      method: "POST",
      path: "/crm/v3/objects/contacts",
      connection,
      body: {
        properties: {
          email: "grace@acme.test",
          firstname: "Grace",
          lastname: "Hopper",
          phone: "+57 300 123 4567",
          address: "Calle 1 # 2-3",
          city: "Bogotá",
          state: "Cundinamarca",
        },
        associations: [
          {
            to: { id: "company-2" },
            types: [
              {
                associationCategory: "HUBSPOT_DEFINED",
                associationTypeId: 1,
              },
            ],
          },
        ],
      },
    });
    expect(proxy.mock.calls[1]?.[0]).toEqual({
      method: "PATCH",
      path: "/crm/v3/objects/contacts/contact%20%2F%202",
      connection,
      body: { properties: { firstname: "Rear Admiral Grace" } },
    });
  });

  it("creates and updates companies through fixed URL-encoded paths", async () => {
    const proxy = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          id: "company-2",
          properties: { name: "Acme S.A.S." },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "company-2",
          properties: { name: "Acme Seguros S.A.S." },
        }),
      );
    const adapter = createHubSpotAdapter(nangoClient(proxy));
    const input = {
      name: "Acme S.A.S.",
      phone: "+57 300 123 4567",
      address: "Calle 1 # 2-3",
      city: "Bogotá",
      state: "Cundinamarca",
    };

    await expect(
      adapter.createCompany(connection, input),
    ).resolves.toMatchObject({
      id: "company-2",
      name: "Acme S.A.S.",
    });
    await expect(
      adapter.updateCompany(connection, "company / 2", {
        ...input,
        name: "Acme Seguros S.A.S.",
      }),
    ).resolves.toMatchObject({ id: "company-2", name: "Acme Seguros S.A.S." });

    expect(proxy.mock.calls.map((call) => call[0])).toEqual([
      {
        method: "POST",
        path: "/crm/v3/objects/companies",
        connection,
        body: { properties: input },
      },
      {
        method: "PATCH",
        path: "/crm/v3/objects/companies/company%20%2F%202",
        connection,
        body: {
          properties: { ...input, name: "Acme Seguros S.A.S." },
        },
      },
    ]);
  });

  it("normalizes companies and deals through bounded read and search paths", async () => {
    const proxy = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          results: [
            {
              id: "company-1",
              properties: {
                name: "Acme Insurance",
                domain: "acme.test",
                hs_lastmodifieddate: "2026-01-01T00:00:00.000Z",
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          results: [
            {
              id: "deal-1",
              properties: {
                dealname: "Renewal",
                amount: "120000",
                dealstage: "closedwon",
                hs_lastmodifieddate: "2026-01-01T00:00:00.000Z",
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          results: [],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          results: [],
        }),
      );
    const adapter = createHubSpotAdapter(nangoClient(proxy));

    await expect(
      adapter.listCompanies(connection, { limit: 1 }),
    ).resolves.toEqual([
      {
        id: "company-1",
        name: "Acme Insurance",
        domain: "acme.test",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    await expect(adapter.listDeals(connection, { limit: 1 })).resolves.toEqual([
      {
        id: "deal-1",
        name: "Renewal",
        amount: "120000",
        stage: "closedwon",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    await expect(
      adapter.listCompanies(connection, { limit: 5, search: "acme" }),
    ).resolves.toEqual([]);
    await expect(
      adapter.listDeals(connection, { limit: 5, search: "renewal" }),
    ).resolves.toEqual([]);
    expect(proxy.mock.calls.map((call) => call[0]?.path)).toEqual([
      "/crm/v3/objects/companies?limit=1&properties=name&properties=domain&properties=hs_lastmodifieddate",
      "/crm/v3/objects/deals?limit=1&properties=dealname&properties=amount&properties=dealstage&properties=hs_lastmodifieddate",
      "/crm/v3/objects/companies/search",
      "/crm/v3/objects/deals/search",
    ]);
    expect(proxy.mock.calls[2]?.[0]?.body).toEqual({
      filterGroups: [
        {
          filters: [
            {
              propertyName: "name",
              operator: "CONTAINS_TOKEN",
              value: "acme",
            },
          ],
        },
      ],
      properties: ["name", "domain", "hs_lastmodifieddate"],
      limit: 5,
    });
    expect(proxy.mock.calls[3]?.[0]?.body).toEqual({
      filterGroups: [
        {
          filters: [
            {
              propertyName: "dealname",
              operator: "CONTAINS_TOKEN",
              value: "renewal",
            },
          ],
        },
      ],
      properties: ["dealname", "amount", "dealstage", "hs_lastmodifieddate"],
      limit: 5,
    });
  });

  it.each([401, 403])(
    "marks a %i HubSpot response as requiring reconnection without returning its body",
    async (status) => {
      const proxy = vi
        .fn()
        .mockResolvedValue(
          new Response("refresh_token=must-not-leak", { status }),
        );
      const adapter = createHubSpotAdapter(nangoClient(proxy));

      let thrown: unknown;
      try {
        await adapter.listDeals(connection, { limit: 1 });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(CrmUpstreamError);
      expect(thrown).toMatchObject({ code: "RECONNECT_REQUIRED" });
      expect(thrown instanceof Error ? thrown.message : "").not.toContain(
        "refresh_token",
      );
    },
  );
});
