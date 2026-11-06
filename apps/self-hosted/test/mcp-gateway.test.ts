import { afterEach, expect, it, vi } from "vitest";
import { remoteMcpResponse } from "../../api/src/mcp-gateway";

afterEach(() => vi.unstubAllGlobals());

it("proxies a streamed MCP POST through Node to the private native transport", async () => {
  const message = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
  });
  const transport = vi.fn(async (request: Request) => {
    expect(request.url).toBe("http://127.0.0.1:8789/mcp");
    expect(request.headers.get("x-savia-user-authorization")).toBe(
      "Bearer exchanged-token",
    );
    expect(request.headers.get("x-savia-mcp-secret")).toBe("private-secret");
    expect(await request.text()).toBe(message);
    return Response.json({ jsonrpc: "2.0", id: 1, result: { tools: [] } });
  });
  vi.stubGlobal("fetch", transport);
  const request = new Request("https://savia.example.com/mcp", {
    method: "POST",
    headers: {
      authorization: "Bearer external-token",
      "content-type": "application/json",
    },
    body: message,
  });
  const response = await remoteMcpResponse(request, {
    SAVIA_API_RESOURCE: "https://savia.example.com",
    SAVIA_OAUTH_ISSUER: "https://savia.example.com/api/auth",
    SAVIA_MCP_SHARED_SECRET: "private-secret",
    SAVIA_MCP_URL: "http://127.0.0.1:8789/mcp",
    AUTH: {
      fetch: async () => Response.json({ access_token: "exchanged-token" }),
    },
  });
  expect(response?.status).toBe(200);
  expect(await response?.json()).toMatchObject({ result: { tools: [] } });
  expect(transport).toHaveBeenCalledTimes(1);
});
