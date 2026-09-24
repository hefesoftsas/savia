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

const catalog = {
  data: [
    {
      pluginId: "custom.demo",
      label: "Demo",
      actions: [
        {
          id: "eco",
          kind: "simulation",
          label: "[custom.demo/eco] Eco",
          summary: "Devuelve un eco.",
        },
      ],
    },
  ],
};

async function startApi(): Promise<{
  url: string;
  requests: string[];
}> {
  const requests: string[] = [];
  const server = createServer(
    async (request: IncomingMessage, response: ServerResponse) => {
      const body = await readBody(request);
      requests.push(`${request.method} ${request.url}`);
      let payload: unknown = { data: [] };
      if (
        request.url === "/v1/data-domains/platform/api/plugin-store/mcp-catalog"
      ) {
        payload = catalog;
      } else if (
        request.url ===
        "/v1/data-domains/platform/api/extensions/custom.demo/actions/eco"
      ) {
        expect(JSON.parse(body)).toEqual({ input: { mensaje: "hola" } });
        payload = {
          data: { run: { status: "succeeded" }, output: { eco: 1 } },
        };
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(payload));
    },
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, requests };
}

describe("store assistant tools", () => {
  it("exposes catalog and read-only execution as static tools", async () => {
    const { url, requests } = await startApi();
    const server = createSaviaMcpServer(new SaviaApiClient(url, "caller"));
    const client = await Client.connect(server);
    try {
      const tools = await client.listTools();
      for (const name of ["savia_store_catalog", "savia_store_execute"]) {
        expect(tools).toContainEqual(
          expect.objectContaining({
            name,
            annotations: expect.objectContaining({ readOnlyHint: true }),
          }),
        );
      }
      const listed = await client.callTool("savia_store_catalog", {});
      expect(listed.structuredContent).toEqual(catalog);

      const result = await client.callTool("savia_store_execute", {
        pluginId: "custom.demo",
        actionId: "eco",
        input: { mensaje: "hola" },
      });
      expect(result.structuredContent).toEqual({ eco: 1 });
      expect(requests).toContain(
        "POST /v1/data-domains/platform/api/extensions/custom.demo/actions/eco",
      );
    } finally {
      await client.close();
    }
  });

  it("rejects actions outside the read-only catalog", async () => {
    const { url } = await startApi();
    const server = createSaviaMcpServer(new SaviaApiClient(url, "caller"));
    const client = await Client.connect(server);
    try {
      await expect(
        client.callTool("savia_store_execute", {
          pluginId: "custom.demo",
          actionId: "inexistente",
          input: {},
        }),
      ).rejects.toThrow(/not available/i);
      await expect(
        client.callTool("savia_store_execute", {
          pluginId: "otro",
          actionId: "eco",
          input: {},
        }),
      ).rejects.toThrow(/not available/i);
    } finally {
      await client.close();
    }
  });
});
