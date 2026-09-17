import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { SaviaApiClient } from "../src/savia-api";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

async function testServer(
  handler: (
    request: IncomingMessage,
    response: ServerResponse,
  ) => void | Promise<void>,
): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function requestText(request: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) body += String(chunk);
  return body;
}

describe("SaviaApiClient", () => {
  it("reads CRM sync status with an optional customer filter", async () => {
    const received: string[] = [];
    const baseUrl = await testServer((request, response) => {
      received.push(request.url ?? "");
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ data: [] }));
    });
    const client = new SaviaApiClient(baseUrl);
    await client.getCrmSyncStatus();
    await client.getCrmSyncStatus(42);
    expect(received).toEqual([
      "/v1/crm/sync-jobs",
      "/v1/crm/sync-jobs?customerId=42",
    ]);
  });
  it("forwards a document command through the public Domain API", async () => {
    const received: { url?: string; method?: string; body?: string } = {};
    const baseUrl = await testServer(async (request, response) => {
      received.url = request.url;
      received.method = request.method;
      received.body = await requestText(request);
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          id: "900004",
          kind: "agency-profile",
          attributes: { status: "created" },
          relationships: {},
        }),
      );
    });

    const client = new SaviaApiClient(baseUrl);
    const document = await client.executeCommand(
      "agency-network",
      "create-agency",
      { name: "Savia" },
    );

    expect(received).toEqual({
      method: "POST",
      url: "/v1/agency-network/commands/create-agency",
      body: JSON.stringify({ name: "Savia" }),
    });
    expect(document).toEqual(
      expect.objectContaining({ id: "900004", kind: "agency-profile" }),
    );
  });

  it("forwards the configured Better Auth bearer token to the Domain API", async () => {
    let authorization: string | undefined;
    const baseUrl = await testServer((request, response) => {
      authorization = request.headers.authorization;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ data: [] }));
    });

    const domains = await new SaviaApiClient(
      baseUrl,
      "better-auth-session-token",
    ).listDomains();

    expect(domains).toEqual([]);
    expect(authorization).toBe("Bearer better-auth-session-token");
  });

  it("returns the Domain API status and safe error when a command is rejected", async () => {
    const baseUrl = await testServer((_request, response) => {
      response.statusCode = 409;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          error: { code: "CONFLICT", message: "Attachment upload expired" },
        }),
      );
    });

    await expect(
      new SaviaApiClient(baseUrl).executeCommand(
        "document-storage",
        "complete-attachment-upload",
        { attachmentId: "00000000-0000-4000-8000-000000000000" },
      ),
    ).rejects.toThrow("409 CONFLICT: Attachment upload expired");
  });

  it("uses fixed caller-owned personal integration operations", async () => {
    const received: Array<{ url?: string; method?: string; body?: string }> =
      [];
    const baseUrl = await testServer(async (request, response) => {
      received.push({
        url: request.url,
        method: request.method,
        body: await requestText(request),
      });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ data: [] }));
    });
    const client = new SaviaApiClient(baseUrl);

    await client.searchPersonalFiles("google_drive", "renewal");
    await client.searchPersonalMessages("gmail", "renewal");
    await client.listPersonalEvents("google_calendar");
    await client.executePersonalAction("approved-personal-action");

    expect(received).toEqual([
      {
        method: "GET",
        url: "/v1/personal-integrations/files?provider=google_drive&query=renewal",
        body: "",
      },
      {
        method: "GET",
        url: "/v1/personal-integrations/messages?provider=gmail&query=renewal",
        body: "",
      },
      {
        method: "GET",
        url: "/v1/personal-integrations/events?provider=google_calendar",
        body: "",
      },
      {
        method: "POST",
        url: "/v1/personal-integrations/actions/approved-personal-action/execute",
        body: "",
      },
    ]);
  });
});

describe("installed CRM collections", () => {
  it("discovers only CRM objects and gates all record operations with metadata", async () => {
    const calls: Array<{
      path: string;
      method: string;
      body: string;
      auth: string | null;
    }> = [];
    const crm = {
      name: "provider_contacts",
      config: { studio: { collection: { kind: "crm" } } },
      fields: [{ name: "email" }],
    };
    const client = new SaviaApiClient(
      "https://api.test",
      "caller",
      async (url, init) => {
        const path =
          new URL(String(url)).pathname + new URL(String(url)).search;
        calls.push({
          path,
          method: init?.method ?? "GET",
          body: String(init?.body ?? ""),
          auth: new Headers(init?.headers).get("authorization"),
        });
        return Response.json({
          data: path.endsWith("/objects") ? [crm, { name: "local" }] : [],
        });
      },
    );
    expect(await client.listCrmCollections()).toEqual({ data: [crm] });
    await client.listCrmRecords("provider_contacts", 2, 10, "a+b");
    await client.getCrmRecord("provider_contacts", "a/b");
    await client.createCrmRecord("provider_contacts", { email: "a@test.co" });
    await client.updateCrmRecord("provider_contacts", "42", {
      email: "b@test.co",
      _version: 2,
    });
    await client.getCrmRecordLinks("provider_contacts", "42");
    await client.deleteCrmRecord("provider_contacts", "42", 2);
    const operations = calls.filter((c) => !c.path.endsWith("/objects"));
    expect(operations.map((c) => [c.path, c.method, c.body])).toEqual([
      [
        "/v1/data-domains/platform/api/records/provider_contacts?page=2&perPage=10&q=a%2Bb",
        "GET",
        "",
      ],
      [
        "/v1/data-domains/platform/api/records/provider_contacts/a%2Fb",
        "GET",
        "",
      ],
      [
        "/v1/data-domains/platform/api/records/provider_contacts",
        "POST",
        '{"email":"a@test.co"}',
      ],
      [
        "/v1/data-domains/platform/api/records/provider_contacts/42",
        "PATCH",
        '{"email":"b@test.co","_version":2}',
      ],
      [
        "/v1/data-domains/platform/api/record-links/provider_contacts/42",
        "GET",
        "",
      ],
      [
        "/v1/data-domains/platform/api/records/provider_contacts/42?version=2",
        "DELETE",
        "",
      ],
    ]);
    expect(calls.every((c) => c.auth === "Bearer caller")).toBe(true);
    const before = operations.length;
    for (const object of ["local", "missing", "../objects"]) {
      await expect(client.createCrmRecord(object, {})).rejects.toThrow();
      await expect(client.getCrmRecord(object, "42")).rejects.toThrow();
    }
    expect(calls.filter((c) => !c.path.endsWith("/objects"))).toHaveLength(
      before,
    );
  });
});

it("discovers and queries authorized collections hidden only from navigation", async () => {
  const paths: string[] = [];
  const client = new SaviaApiClient(
    "https://api.test",
    "caller",
    async (url) => {
      const path = new URL(String(url)).pathname;
      paths.push(path);
      return Response.json(
        path.endsWith("/objects")
          ? {
              data: [
                {
                  name: "cotizaciones",
                  label: "Cotizaciones",
                  count: 1,
                  config: {
                    studio: { screen: { hidden: true } },
                    fields: { name: { type: "Textbox" } },
                  },
                },
              ],
            }
          : { data: [{ id: "quote-1", name: "COT-1" }], total: 1 },
      );
    },
  );
  expect((await client.listCrmCollections({ all: true })).data).toEqual([
    expect.objectContaining({ name: "cotizaciones", recordCount: 1 }),
  ]);
  expect(await client.listCrmRecords("cotizaciones", { page: 1 })).toEqual({
    data: [{ id: "quote-1", name: "COT-1" }],
    total: 1,
  });
  expect(paths).toContain("/v1/data-domains/platform/api/records/cotizaciones");
});

it("summarizes a quote in three authorized reads without inventing a winner for tied premiums", async () => {
  const paths: string[] = [];
  const client = new SaviaApiClient(
    "https://api.test",
    "caller",
    async (url) => {
      const path = new URL(String(url)).pathname;
      paths.push(path);
      if (path.endsWith("/objects"))
        return Response.json({
          data: [
            { name: "cotizaciones", count: 7 },
            { name: "cotizaciones_detalle" },
          ],
        });
      if (path.endsWith("/cotizaciones"))
        return Response.json({
          data: [{ id: "q1", name: "COT-1", estado: "Recibida" }],
          total: 1,
        });
      return Response.json({
        data: [
          {
            producto: "Liberty Full",
            aseguradora: "Liberty",
            estado: "Recibida",
            prima: 1448081,
            numero_cotizacion: "A",
          },
          {
            producto: "Liberty Integral",
            aseguradora: "Liberty",
            estado: "Recibida",
            prima: 1448081,
            numero_cotizacion: "B",
          },
          { producto: "Equidad", estado: "Recibida" },
          { producto: "SBS", estado: "Error", prima: 100 },
        ],
        total: 4,
      });
    },
  );
  const result = await client.getQuoteSummary("COT-1");
  expect(paths).toHaveLength(3);
  expect(result).toMatchObject({
    totalQuotes: 7,
    quote: { reference: "COT-1" },
    totalOffers: 4,
    failedOffers: 1,
    unpricedOffers: 1,
    lowestPremium: 1448081,
    priceTie: true,
    coverageAvailable: false,
  });
  expect(result.lowestPriceOffers).toHaveLength(2);
});
