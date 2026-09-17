import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@prefecthq/fastmcp-ts/client";
import { createSaviaMcpServer } from "../src/server";
import { SaviaApiClient } from "../src/savia-api";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function startApi(
  handler: (request: IncomingMessage) => Promise<unknown>,
): Promise<string> {
  const server = createServer(
    async (request: IncomingMessage, response: ServerResponse) => {
      const payload = await handler(request);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(payload));
    },
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

describe("Savia FastMCP server", () => {
  it("exposes only read-only assistant contributions from the release catalog", async () => {
    const server = createSaviaMcpServer(
      new SaviaApiClient("https://api.test", "caller", async () =>
        Response.json({ data: [] }),
      ),
    );
    const client = await Client.connect(server);
    try {
      const tools = await client.listTools();
      expect(tools).toContainEqual(
        expect.objectContaining({
          name: "savia_extension_insurance_portfolio",
          annotations: expect.objectContaining({ readOnlyHint: true }),
        }),
      );
      expect(tools.map((tool) => tool.name)).not.toContain(
        "savia_extension_insurance_summary",
      );
      expect(tools.map((tool) => tool.name)).not.toContain(
        "savia_extension_insurance_quote",
      );
    } finally {
      await client.close();
    }
  });

  it("reads the active portfolio extension through its tenant summary endpoint", async () => {
    const requests: string[] = [];
    const apiUrl = await startApi(async (request) => {
      requests.push(request.url ?? "");
      if (request.url === "/v1/data-domains/platform/api/extensions") {
        return {
          data: [
            {
              manifest: {
                id: "insurance.portfolio-dashboard",
                version: "1.0.0",
                label: "Cartera de pólizas",
                description: "Resumen de seguros",
                requires: [],
                apiVersion: 1,
              },
              builtIn: false,
              installed: { version: "1.0.0", enabled: true },
            },
          ],
        };
      }
      if (
        request.url ===
        "/v1/data-domains/platform/api/extensions/insurance.portfolio-dashboard/summary"
      ) {
        return {
          data: {
            total: 7,
            active: 5,
            expiring: 1,
            premiumTotal: 486000000,
            asOf: "2026-09-14T00:00:00.000Z",
          },
        };
      }
      throw new Error(`Unexpected request: ${request.url}`);
    });
    const server = createSaviaMcpServer(new SaviaApiClient(apiUrl, "caller"));
    const client = await Client.connect(server);
    try {
      const result = await client.callTool(
        "savia_extension_insurance_portfolio",
        {},
      );
      expect(result.structuredContent).toEqual({
        extension: "insurance.portfolio-dashboard",
        summary: {
          total: 7,
          active: 5,
          expiring: 1,
          premiumTotal: 486000000,
          asOf: "2026-09-14T00:00:00.000Z",
        },
      });
      expect(requests).toEqual([
        "/v1/data-domains/platform/api/extensions",
        "/v1/data-domains/platform/api/extensions/insurance.portfolio-dashboard/summary",
      ]);
    } finally {
      await client.close();
    }
  });

  it("does not call a portfolio summary while its extension is inactive", async () => {
    const requests: string[] = [];
    const apiUrl = await startApi(async (request) => {
      requests.push(request.url ?? "");
      if (request.url === "/v1/data-domains/platform/api/extensions") {
        return {
          data: [
            {
              manifest: {
                id: "insurance.portfolio-dashboard",
                version: "1.0.0",
                label: "Cartera de pólizas",
                description: "Resumen de seguros",
                requires: [],
                apiVersion: 1,
              },
              builtIn: false,
              installed: { version: "1.0.0", enabled: false },
            },
          ],
        };
      }
      throw new Error(`Unexpected request: ${request.url}`);
    });
    const server = createSaviaMcpServer(new SaviaApiClient(apiUrl, "caller"));
    const client = await Client.connect(server);
    try {
      await expect(
        client.callTool("savia_extension_insurance_portfolio", {}),
      ).rejects.toThrow("extension is not active");
      expect(requests).toEqual(["/v1/data-domains/platform/api/extensions"]);
    } finally {
      await client.close();
    }
  });

  it("exposes scoped CRM tools with usable write schemas", async () => {
    const server = createSaviaMcpServer(
      new SaviaApiClient("https://api.test", "caller", async () =>
        Response.json({ data: [] }),
      ),
    );
    const client = await Client.connect(server);
    try {
      const tools = await client.listTools();
      const crm = tools.filter((tool) =>
        /savia_(list_crm|(?:get|create|update|aggregate)_crm_record)/.test(
          tool.name,
        ),
      );
      expect(crm.map((tool) => tool.name).sort()).toEqual([
        "savia_aggregate_crm_records",
        "savia_create_crm_record",
        "savia_get_crm_record",
        "savia_get_crm_record_links",
        "savia_list_crm_collections",
        "savia_list_crm_records",
        "savia_update_crm_record",
      ]);
      expect(
        tools.find((tool) => tool.name === "savia_update_crm_record")
          ?.inputSchema,
      ).toMatchObject({
        required: ["object", "id", "data"],
        properties: { data: { type: "object" } },
      });
      expect(
        crm
          .filter((tool) => !/create|update/.test(tool.name))
          .every((tool) => tool.annotations?.readOnlyHint),
      ).toBe(true);
      await expect(
        client.callTool("savia_create_crm_record", {
          object: "local",
          data: {},
        }),
      ).rejects.toThrow("not an installed CRM collection");
    } finally {
      await client.close();
    }
  });
  it("exposes CRM sync status as a read-only tool", async () => {
    const apiUrl = await startApi(async (request) => {
      expect(request.url).toBe("/v1/crm/sync-jobs?customerId=42");
      return { data: [{ id: "job-1", customerId: 42, status: "synced" }] };
    });
    const server = createSaviaMcpServer(new SaviaApiClient(apiUrl));
    const client = await Client.connect(server);
    try {
      const tools = await client.listTools();
      const tool = tools.find(
        (item) => item.name === "savia_get_crm_sync_status",
      );
      expect(tool?.annotations?.readOnlyHint).toBe(true);
      const result = await client.callTool("savia_get_crm_sync_status", {
        customerId: 42,
      });
      expect(JSON.stringify(result)).toContain('"status":"synced"');
    } finally {
      await client.close();
    }
  });
  it("exposes the domain API as tools, a resource, and an operating prompt", async () => {
    const apiUrl = await startApi(async (request) => {
      if (request.url === "/v1/domains") {
        return {
          data: [
            {
              id: "agency-network",
              collections: [],
              commands: [],
            },
          ],
        };
      }

      if (
        request.method === "POST" &&
        request.url === "/v1/agency-network/commands/create-agency"
      ) {
        expect(JSON.parse(await readBody(request))).toEqual({ name: "Savia" });
        return {
          document: {
            id: "900004",
            kind: "agencies",
            attributes: { name: "Savia" },
            relationships: {},
          },
        };
      }

      throw new Error(
        `Unexpected API request: ${request.method} ${request.url}`,
      );
    });

    const server = createSaviaMcpServer(new SaviaApiClient(apiUrl));
    const client = await Client.connect(server);

    try {
      const tools = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          "savia_execute_command",
          "savia_execute_personal_action",
          "savia_get_document",
          "savia_list_documents",
          "savia_list_domains",
          "savia_search_personal_files",
          "savia_search_personal_messages",
          "savia_list_personal_events",
          "savia_create_crm_record",
          "savia_update_crm_record",
          "savia_delete_crm_record",
        ]),
      );

      const domainResult = await client.callTool("savia_list_domains");
      expect(domainResult.structuredContent).toMatchObject({
        domains: [{ id: "agency-network" }],
      });

      const result = await client.callTool("savia_execute_command", {
        domain: "agency-network",
        command: "create-agency",
        input: { name: "Savia" },
      });
      expect(result.structuredContent).toMatchObject({
        document: { id: "900004", attributes: { name: "Savia" } },
      });

      const resources = await client.listResources();
      expect(resources.map((resource) => resource.uri)).toContain(
        "savia://domains",
      );
      const domainResource = await client.readResource("savia://domains");
      expect("text" in (domainResource[0] ?? {})).toBe(true);
      expect((domainResource[0] as { text: string }).text).toContain(
        "agency-network",
      );

      const prompts = await client.listPrompts();
      expect(prompts.map((prompt) => prompt.name)).toContain(
        "savia_operate_domain",
      );
    } finally {
      await client.close();
    }
  });

  it("uses credentials from each private MCP HTTP request to call the Domain API", async () => {
    let authorization: string | undefined;
    const apiUrl = await startApi(async (request) => {
      authorization = request.headers.authorization;
      expect(request.url).toBe("/v1/data-domains/platform/api/objects");
      return { data: [] };
    });
    const server = createSaviaMcpServer({
      apiUrl,
      mcpSharedSecret: "internal-secret",
    });

    try {
      await server.run({
        transport: "http",
        host: "127.0.0.1",
        port: 0,
        stateless: true,
      });
      const address = server.address;
      if (!address) throw new Error("FastMCP HTTP server did not start");
      const client = await Client.connect({
        mcpServers: {
          savia: {
            url: `http://127.0.0.1:${address.port}${address.path}`,
            headers: {
              "x-savia-mcp-secret": "internal-secret",
              "x-savia-user-authorization": "Bearer delegated-user-token",
            },
          },
        },
      });

      try {
        await client.callTool("savia_list_crm_collections");
        expect(authorization).toBe("Bearer delegated-user-token");
      } finally {
        await client.close();
      }
    } finally {
      await server.close();
    }
  });
});
