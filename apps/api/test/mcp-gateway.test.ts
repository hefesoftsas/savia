import { describe, expect, it, vi } from "vitest";
import { remoteMcpResponse } from "../src/mcp-gateway";
const origin = "https://savia.example.test";
function environment() {
  return {
    SAVIA_API_RESOURCE: origin,
    SAVIA_OAUTH_ISSUER: `${origin}/api/auth`,
    SAVIA_MCP_SHARED_SECRET: "private-secret",
    AUTH: {
      fetch: vi.fn(async (_request: Request) =>
        Response.json({ access_token: "internal-api-token" }),
      ),
    },
    MCP: {
      fetch: vi.fn(async (_request: Request) =>
        Response.json({ jsonrpc: "2.0", id: 1, result: {} }),
      ),
    },
  };
}
describe("public MCP boundary", () => {
  it("advertises an exact MCP audience and challenges without contacting MCP", async () => {
    const env = environment();
    const metadata = await remoteMcpResponse(
      new Request(`${origin}/.well-known/oauth-protected-resource/mcp`),
      env,
    );
    expect(await metadata!.json()).toMatchObject({
      resource: `${origin}/mcp`,
      authorization_servers: [`${origin}/api/auth`],
    });
    const response = await remoteMcpResponse(
      new Request(`${origin}/mcp`, { method: "POST" }),
      env,
    );
    expect(response!.status).toBe(401);
    expect(response!.headers.get("www-authenticate")).toContain(
      `${origin}/.well-known/oauth-protected-resource/mcp`,
    );
    expect(env.MCP.fetch).not.toHaveBeenCalled();
  });
  it("exchanges the bearer and strips client cookies and forged delegation headers", async () => {
    const env = environment();
    await remoteMcpResponse(
      new Request(`${origin}/mcp`, {
        method: "POST",
        headers: {
          authorization: "Bearer external-token",
          cookie: "admin=forged",
          "x-savia-mcp-secret": "forged",
          "x-savia-user-authorization": "Bearer forged",
          "mcp-session-id": "someone-else",
          "mcp-protocol-version": "2026-07-28",
          "mcp-method": "tools/call",
          "mcp-name": "savia_list_domains",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"savia_list_domains","arguments":{}}}',
      }),
      env,
    );
    const authRequest = env.AUTH.fetch.mock.calls[0]?.[0] as unknown as Request;
    const mcpRequest = env.MCP.fetch.mock.calls[0]?.[0] as unknown as Request;
    expect(authRequest.headers.get("authorization")).toBe(
      "Bearer external-token",
    );
    expect(mcpRequest.headers.get("authorization")).toBeNull();
    expect(mcpRequest.headers.get("cookie")).toBeNull();
    expect(mcpRequest.headers.get("mcp-session-id")).toBeNull();
    expect(mcpRequest.headers.get("mcp-protocol-version")).toBe("2026-07-28");
    expect(mcpRequest.headers.get("mcp-method")).toBe("tools/call");
    expect(mcpRequest.headers.get("mcp-name")).toBe("savia_list_domains");
    expect(mcpRequest.headers.get("x-savia-user-authorization")).toBe(
      "Bearer internal-api-token",
    );
    expect(mcpRequest.headers.get("x-savia-mcp-secret")).toBe("private-secret");
  });
  it("fails closed on denied token exchange and rejects untrusted origins", async () => {
    const env = environment();
    env.AUTH.fetch.mockResolvedValue(new Response(null, { status: 401 }));
    const response = await remoteMcpResponse(
      new Request(`${origin}/mcp`, {
        method: "POST",
        headers: { authorization: "Bearer invalid" },
      }),
      env,
    );
    expect(response!.status).toBe(401);
    expect(env.MCP.fetch).not.toHaveBeenCalled();
    expect(
      (await remoteMcpResponse(
        new Request(`${origin}/mcp`, {
          headers: { origin: "https://evil.test" },
        }),
        env,
      ))!.status,
    ).toBe(403);
  });
  it("forwards issuer discovery and leaves unrelated endpoints alone", async () => {
    const env = environment();
    expect(
      await remoteMcpResponse(new Request(`${origin}/health`), env),
    ).toBeUndefined();
    await remoteMcpResponse(
      new Request(`${origin}/.well-known/oauth-authorization-server/api/auth`),
      env,
    );
    expect(env.AUTH.fetch).toHaveBeenCalledOnce();
  });
});
