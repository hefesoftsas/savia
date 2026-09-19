import { describe, expect, it, vi } from "vitest";
import worker from "../src/worker";

describe("Savia MCP Cloudflare Worker", () => {
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
      capturedAuth = init?.headers?.get?.("authorization") ?? init?.headers?.authorization;
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
          "accept": "application/json, text/event-stream",
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
