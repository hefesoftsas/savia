import { describe, expect, it, vi } from "vitest";
import worker from "../src/worker";
import { remoteMcpResponse } from "../../api/src/mcp-gateway";

describe("Savia MCP Cloudflare Worker", () => {
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

  it("exposes tools over stateless HTTP after legacy initialization", async () => {
    const env = {
      SAVIA_API_URL: "https://api.test",
      SAVIA_MCP_SHARED_SECRET: "discovery-test-secret",
    };
    const send = (body: unknown) =>
      worker.fetch(
        new Request("https://savia-mcp.internal/mcp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "mcp-protocol-version": "2025-03-26",
            "x-savia-mcp-secret": env.SAVIA_MCP_SHARED_SECRET,
            "x-savia-user-authorization": "Bearer discovery-user",
          },
          body: JSON.stringify(body),
        }),
        env,
      );
    const initialized = await send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "discovery-test", version: "1" },
      },
    });
    expect(initialized.status).toBe(200);
    expect(await initialized.text()).toContain("capabilities");
    const listed = await send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    expect(listed.status).toBe(200);
    expect(await listed.text()).toContain("savia_list_crm_collections");
  });

  it("rejects requests when credentials are missing or invalid", async () => {
    const env = {
      SAVIA_API_URL: "https://api.test",
      SAVIA_MCP_SHARED_SECRET: "test-secret-123",
    };

    // Missing headers
    const res1 = await worker.fetch(
      new Request("https://savia-mcp.internal/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
      env,
    );
    expect(res1.status).toBe(401);

    // Bad secret
    const res2 = await worker.fetch(
      new Request("https://savia-mcp.internal/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-savia-mcp-secret": "wrong-secret",
          "x-savia-user-authorization": "Bearer user-token-abc",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
      env,
    );
    expect(res2.status).toBe(401);
  });

  it("authenticates delegated requests and executes CRM tools with the user token", async () => {
    let capturedAuth: string | undefined;
    const mockApiFetch = vi.fn().mockImplementation((url, init) => {
      capturedAuth =
        init?.headers?.get?.("authorization") ?? init?.headers?.authorization;
      return new Response(
        JSON.stringify({
          data: [
            {
              name: "customers",
              label: "Clientes",
              total: 5,
              kind: "crm",
              installed: true,
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });

    const env = {
      SAVIA_API_URL: "https://savia.app.hefesoft.com",
      SAVIA_MCP_SHARED_SECRET: "test-secret-123",
      API: { fetch: mockApiFetch as typeof fetch },
    };

    const res = await worker.fetch(
      new Request("https://savia-mcp.internal/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "x-savia-mcp-secret": "test-secret-123",
          "x-savia-user-authorization": "Bearer my-secret-jwt-token",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "savia_list_crm_collections",
            arguments: { all: true },
          },
        }),
      }),
      env,
    );

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("customers");
    expect(capturedAuth).toBe("Bearer my-secret-jwt-token");
  });
});
