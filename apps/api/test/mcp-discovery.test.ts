import { describe, expect, it } from "vitest";
import worker from "../../mcp/src/worker";
import { remoteMcpResponse } from "../src/mcp-gateway";

describe("modern MCP discovery", () => {
  it("discovers tools through the public gateway using modern MCP headers", async () => {
    const env = {
      SAVIA_API_URL: "https://api.test",
      SAVIA_MCP_SHARED_SECRET: "modern-discovery-secret",
    };
    const response = await remoteMcpResponse(
      new Request("https://api.test/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer external-user",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2026-07-28",
          "mcp-method": "tools/list",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientCapabilities": {},
              "io.modelcontextprotocol/clientInfo": {
                name: "discovery-test",
                version: "1",
              },
            },
          },
        }),
      }),
      {
        ...env,
        SAVIA_API_RESOURCE: "https://api.test",
        SAVIA_OAUTH_ISSUER: "https://api.test/api/auth",
        AUTH: {
          fetch: async () => Response.json({ access_token: "delegated-user" }),
        },
        MCP: {
          fetch: async (request: Request) => worker.fetch(request, env),
        } as { fetch: typeof fetch },
      },
    );
    const body = await response!.text();
    expect(response!.status, body).toBe(200);
    expect(body).toContain("savia_list_crm_collections");
  });
});
