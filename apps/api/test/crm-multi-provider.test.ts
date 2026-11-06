import { describe, expect, it, vi } from "vitest";
import { CrmUnavailableError } from "../src/external-crm/contracts";
import { createNangoClient } from "../src/external-crm/nango";
import { createCrmProviderRegistry } from "../src/external-crm/providers";
import { createRemoteCrmAdapter } from "../src/external-crm/remote-crm";
import { createRemoteWorkspaceAdapter } from "../src/external-crm/workspace-adapter";

const base = {
  baseUrl: "https://nango.example.test",
  apiKey: "nango-test-key",
};
const connection = (provider: "salesforce" | "zoho" | "pipedrive") => ({
  id: `local-${provider}`,
  agencyId: 1,
  provider,
  status: "connected" as const,
  externalAccountId: null,
  externalAccountLabel: null,
  scopes: provider === "pipedrive" ? ["contacts:full", "deals:full"] : [],
  lastValidatedAt: null,
  createdAt: "",
  updatedAt: "",
  nangoConnectionId: `nango-${provider}`,
  nangoIntegrationId: `${provider}-integration`,
});

describe("native CRM adapters", () => {
  it("enables configured providers independently of HubSpot", () => {
    const registry = createCrmProviderRegistry({
      ...base,
      salesforceIntegrationId: "sf",
      zohoIntegrationId: "zcrm",
    });
    expect(registry.hubspot.availability).toBe("unavailable");
    expect(registry.salesforce.availability).toBe("enabled");
    expect(registry.zoho.availability).toBe("enabled");
    expect(registry.pipedrive.availability).toBe("unavailable");
  });

  it("selects the provider's integration for Connect and rejects unconfigured providers", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({ data: { token: "session", expires_at: "later" } }),
      );
    const client = createNangoClient(
      { ...base, salesforceIntegrationId: "sf-integration" },
      fetcher as typeof fetch,
    );
    await client.createConnectSession({
      actor: {
        principal: { id: "u", email: null, displayName: null },
      } as never,
      agencyId: 1,
      provider: "salesforce",
    });
    const request = new Request(
      fetcher.mock.calls[0]![0] as RequestInfo,
      fetcher.mock.calls[0]![1],
    );
    expect((await request.json()).allowed_integrations).toEqual([
      "sf-integration",
    ]);
    await expect(
      client.createConnectSession({
        actor: {} as never,
        agencyId: 1,
        provider: "zoho",
      }),
    ).rejects.toBeInstanceOf(CrmUnavailableError);
  });

  it.each([
    ["salesforce", "/services/data/v60.0/query"],
    ["zoho", "/crm/v2/Contacts"],
    ["pipedrive", "/v1/persons"],
  ] as const)(
    "maps %s native fields and returns a bounded page",
    async (provider, expectedPath) => {
      const fetcher = vi
        .fn()
        .mockImplementation(async (input: RequestInfo | URL) => {
          const url = new URL(input.toString());
          expect(url.pathname).toBe(`/proxy${expectedPath}`);
          if (provider === "salesforce")
            return Response.json({
              totalSize: 3,
              done: true,
              records: [
                {
                  Id: "003000000000001AAA",
                  FirstName: "Ada",
                  LastName: "Lovelace",
                  Email: "ada@example.test",
                  attributes: { type: "Contact" },
                },
                {
                  Id: "003000000000002AAA",
                  FirstName: "Grace",
                  LastName: "Hopper",
                  Email: "grace@example.test",
                  attributes: { type: "Contact" },
                },
              ],
            });
          if (provider === "zoho")
            return Response.json({
              data: [
                {
                  id: "572000000000001",
                  First_Name: "Ada",
                  Last_Name: "Lovelace",
                  Email: "ada@example.test",
                },
              ],
              info: { more_records: true, count: 1 },
            });
          return Response.json({
            success: true,
            data: [
              {
                id: 42,
                name: "Ada Lovelace",
                email: [{ value: "ada@example.test" }],
              },
            ],
            additional_data: { pagination: { more_items_in_collection: true } },
          });
        });
      const adapter = createRemoteWorkspaceAdapter(
        provider,
        createNangoClient(
          { ...base, [`${provider}IntegrationId`]: `${provider}-integration` },
          fetcher as typeof fetch,
        ),
      );
      const fields =
        provider === "salesforce"
          ? ["FirstName", "LastName", "Email"]
          : provider === "zoho"
            ? ["First_Name", "Last_Name", "Email"]
            : ["name", "email"];
      const page = await adapter.list(connection(provider), "contacts", {
        page: 1,
        perPage: 1,
        fields,
      });
      expect(page.records[0]).toMatchObject(
        provider === "salesforce"
          ? {
              FirstName: "Ada",
              LastName: "Lovelace",
              Email: "ada@example.test",
            }
          : provider === "zoho"
            ? {
                First_Name: "Ada",
                Last_Name: "Lovelace",
                Email: "ada@example.test",
              }
            : { name: "Ada Lovelace" },
      );
      expect(page.hasNextPage).toBe(true);
      expect(page.records[0]?.id).toEqual(expect.any(String));
    },
  );

  it.each([
    ["salesforce", "/services/data/v60.0/sobjects/Contact/003000000000001AAA"],
    ["zoho", "/crm/v2/Contacts/572000000000001"],
    ["pipedrive", "/v1/persons/42"],
  ] as const)(
    "rejects cross-provider paths for %s connections",
    async (provider, safePath) => {
      const fetcher = vi.fn().mockResolvedValue(Response.json({}));
      const client = createNangoClient(
        { ...base, [`${provider}IntegrationId`]: `${provider}-integration` },
        fetcher as typeof fetch,
      );
      await client.proxy({
        method: "GET",
        path: safePath,
        connection: connection(provider),
      });
      const crossPath =
        provider === "zoho"
          ? "/services/data/v60.0/sobjects/Contact"
          : "/crm/v2/Contacts";
      await expect(
        client.proxy({
          method: "GET",
          path: crossPath,
          connection: connection(provider),
        }),
      ).rejects.toBeInstanceOf(CrmUnavailableError);
    },
  );

  it.each([
    [
      "salesforce",
      "/services/data/v60.0/query",
      { records: [{ Id: "00D000000000001AAA", Name: "Acme Salesforce" }] },
      "00D000000000001AAA",
      "Acme Salesforce",
    ],
    [
      "zoho",
      "/crm/v2/org",
      { org: [{ id: "572000000000001", company_name: "Acme Zoho" }] },
      "572000000000001",
      "Acme Zoho",
    ],
    [
      "pipedrive",
      "/v1/users/me",
      { data: { company_id: "123", company_name: "Acme Pipedrive" } },
      "123",
      "Acme Pipedrive",
    ],
  ] as const)(
    "validates the owning %s account identity",
    async (provider, expectedPath, payload, accountId, label) => {
      const fetcher = vi.fn(async (input: RequestInfo | URL) => {
        expect(new URL(input.toString()).pathname).toBe(
          `/proxy${expectedPath}`,
        );
        return Response.json(payload);
      });
      const adapter = createRemoteCrmAdapter(
        provider,
        createNangoClient(
          { ...base, [`${provider}IntegrationId`]: `${provider}-integration` },
          fetcher as typeof fetch,
        ),
      );
      await expect(
        adapter.validate(connection(provider)),
      ).resolves.toMatchObject({
        externalAccountId: accountId,
        externalAccountLabel: label,
      });
    },
  );

  it("escapes Salesforce search text inside SOQL and overfetches one row for next-page detection", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      expect(url.pathname).toBe("/proxy/services/data/v60.0/query");
      expect(url.searchParams.get("q")).toContain(
        "WHERE Name LIKE '%O\\'Reilly%'",
      );
      expect(url.searchParams.get("q")).toContain("LIMIT 3 OFFSET 0");
      return Response.json({
        totalSize: 3,
        done: true,
        records: [
          { Id: "003000000000001AAA", LastName: "One" },
          { Id: "003000000000002AAA", LastName: "Two" },
          { Id: "003000000000003AAA", LastName: "Three" },
        ],
      });
    });
    const adapter = createRemoteWorkspaceAdapter(
      "salesforce",
      createNangoClient(
        { ...base, salesforceIntegrationId: "salesforce-integration" },
        fetcher as typeof fetch,
      ),
    );
    const page = await adapter.list(connection("salesforce"), "contacts", {
      page: 1,
      perPage: 2,
      q: "O'Reilly",
      fields: ["LastName"],
    });
    expect(page.records).toHaveLength(2);
    expect(page.hasNextPage).toBe(true);
    expect(page.total).toBeUndefined();
  });

  it("keeps Salesforce describe, insert, and read inside the configured Nango proxy boundary", async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        expect(url.origin).toBe("https://nango.example.test");
        expect(request.headers.get("provider-config-key")).toBe(
          "salesforce-integration",
        );
        if (url.pathname.endsWith("/sobjects/Contact/describe"))
          return Response.json({
            queryable: true,
            retrieveable: true,
            createable: true,
            updateable: true,
            fields: [
              {
                name: "Id",
                label: "Contact ID",
                type: "id",
                nillable: false,
                defaultedOnCreate: true,
                createable: false,
                updateable: false,
              },
              {
                name: "LastName",
                label: "Last Name",
                type: "string",
                nillable: false,
                createable: true,
                updateable: true,
              },
            ],
          });
        if (request.method === "POST")
          return Response.json({
            id: "003000000000001AAA",
            success: true,
            errors: [],
          });
        return Response.json({
          Id: "003000000000001AAA",
          LastName: "Lovelace",
        });
      },
    );
    const adapter = createRemoteWorkspaceAdapter(
      "salesforce",
      createNangoClient(
        { ...base, salesforceIntegrationId: "salesforce-integration" },
        fetcher as typeof fetch,
      ),
    );
    const result = await adapter.create(connection("salesforce"), "contacts", {
      LastName: "Lovelace",
    });
    expect(result).toMatchObject({
      id: "003000000000001AAA",
      LastName: "Lovelace",
    });
    expect(
      fetcher.mock.calls.map(([input]) => new URL(String(input)).pathname),
    ).toEqual([
      "/proxy/services/data/v60.0/sobjects/Contact/describe",
      "/proxy/services/data/v60.0/sobjects/Contact",
      "/proxy/services/data/v60.0/sobjects/Contact/003000000000001AAA",
    ]);
  });

  it("encodes Pipedrive email and phone scalar edits as native arrays", async () => {
    const requests: Array<{ request: Request; body?: unknown }> = [];
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        const body =
          request.method === "POST" ? await request.clone().json() : undefined;
        requests.push({ request, body });
        if (request.url.includes("personFields"))
          return Response.json({
            success: true,
            data: [
              {
                key: "name",
                name: "Name",
                field_type: "varchar",
                mandatory_flag: true,
              },
              { key: "email", name: "Email", field_type: "varchar" },
              { key: "phone", name: "Phone", field_type: "varchar" },
            ],
          });
        if (request.method === "POST")
          return Response.json({
            success: true,
            data: { id: 42, name: "Ada Lovelace" },
          });
        return Response.json({
          success: true,
          data: {
            id: 42,
            name: "Ada Lovelace",
            email: [{ value: "ada@example.test", primary: true }],
            phone: [{ value: "+1 555 0100", primary: true }],
          },
        });
      },
    );
    const adapter = createRemoteWorkspaceAdapter(
      "pipedrive",
      createNangoClient(
        { ...base, pipedriveIntegrationId: "pipedrive-integration" },
        fetcher as typeof fetch,
      ),
    );
    await adapter.create(connection("pipedrive"), "contacts", {
      name: "Ada Lovelace",
      email: "ada@example.test",
      phone: "+1 555 0100",
    });
    expect(
      requests.find(({ request }) => request.method === "POST")?.body,
    ).toEqual({
      name: "Ada Lovelace",
      email: [{ value: "ada@example.test", primary: true }],
      phone: [{ value: "+1 555 0100", primary: true }],
    });
  });

  it("edits Zoho foreign keys and refuses to clear a relationship that changed", async () => {
    const requests: Array<{ method: string; path: string; body?: unknown }> =
      [];
    let linkedId = "572000000000002";
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        const path = new URL(request.url).pathname.replace("/proxy", "");
        const body =
          request.method === "PUT" ? await request.clone().json() : undefined;
        requests.push({ method: request.method, path, body });
        if (path.includes("settings/fields"))
          return Response.json({
            fields: [
              {
                api_name: "Account_Name",
                field_label: "Account Name",
                data_type: "lookup",
                read_only: false,
                operation_type: { api_create: true, api_update: true },
              },
              {
                api_name: "Last_Name",
                field_label: "Last Name",
                data_type: "text",
                system_mandatory: true,
                read_only: false,
                operation_type: { api_create: true, api_update: true },
              },
            ],
          });
        if (path.includes("settings/modules"))
          return Response.json({
            modules: [
              { api_name: "Contacts", creatable: true, editable: true },
            ],
          });
        if (request.method === "GET")
          return Response.json({
            data: [
              {
                id: "572000000000001",
                Account_Name: { id: linkedId, name: "Account" },
              },
            ],
          });
        return Response.json({
          data: [
            {
              code: "SUCCESS",
              status: "success",
              details: { id: "572000000000001" },
            },
          ],
        });
      },
    );
    const adapter = createRemoteWorkspaceAdapter(
      "zoho",
      createNangoClient(
        { ...base, zohoIntegrationId: "zoho-integration" },
        fetcher as typeof fetch,
      ),
    );
    await adapter.setLink!(
      connection("zoho"),
      "contacts",
      "572000000000001",
      "companies",
      "572000000000003",
      false,
    );
    expect(requests.find(({ method }) => method === "PUT")?.body).toEqual({
      data: [
        { id: "572000000000001", Account_Name: { id: "572000000000003" } },
      ],
    });
    linkedId = "572000000000004";
    await expect(
      adapter.setLink!(
        connection("zoho"),
        "contacts",
        "572000000000001",
        "companies",
        "572000000000003",
        true,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(requests.filter(({ method }) => method === "PUT")).toHaveLength(1);
  });
});
