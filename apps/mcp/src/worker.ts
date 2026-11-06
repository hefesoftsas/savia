import { createHash } from "node:crypto";
import type { FastMCP } from "@prefecthq/fastmcp-ts/server";
import { readDelegatedRequestCredentials } from "./request-credentials";
import { createSaviaMcpServer } from "./server";

type McpWorkerEnvironment = {
  SAVIA_API_URL?: string;
  SAVIA_MCP_SHARED_SECRET?: string;
  API?: { fetch: typeof fetch };
};

let activeServer: FastMCP | undefined;
let activeConfiguration: string | undefined;

function serverFor(environment: McpWorkerEnvironment): FastMCP {
  const apiUrl = environment.SAVIA_API_URL?.trim();
  const mcpSharedSecret = environment.SAVIA_MCP_SHARED_SECRET?.trim();
  if (!apiUrl || !mcpSharedSecret) {
    throw new Error("FastMCP production configuration is incomplete");
  }

  const hasApiBinding = Boolean(environment.API);
  const configuration = `${apiUrl}\u0000${mcpSharedSecret}\u0000${hasApiBinding}`;
  if (activeServer && activeConfiguration === configuration)
    return activeServer;

  const apiFetch = environment.API
    ? environment.API.fetch.bind(environment.API)
    : undefined;

  activeServer = createSaviaMcpServer({ apiUrl, mcpSharedSecret, apiFetch });
  activeConfiguration = configuration;
  return activeServer;
}

export default {
  async fetch(
    request: Request,
    environment: McpWorkerEnvironment,
  ): Promise<Response> {
    const apiUrl = environment.SAVIA_API_URL?.trim();
    const mcpSharedSecret = environment.SAVIA_MCP_SHARED_SECRET?.trim();
    if (!apiUrl || !mcpSharedSecret) {
      return new Response(
        JSON.stringify({
          error: "FastMCP production configuration is incomplete",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    let authInfo;
    try {
      const { authorization } = readDelegatedRequestCredentials(
        request.headers,
        mcpSharedSecret,
      );
      authInfo = {
        token: createHash("sha256").update(authorization).digest("hex"),
        clientId: "savia-client",
        scopes: [],
        extra: { delegatedAuthorization: authorization },
      };
    } catch (error) {
      return new Response(
        JSON.stringify({
          error:
            error instanceof Error
              ? error.message
              : "MCP request credentials are invalid",
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    const server = serverFor(environment);
    return server.fetch(request, { authInfo });
  },
};
