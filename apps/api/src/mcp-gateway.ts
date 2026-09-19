import type { AuthService } from "./auth/better-auth";

type McpEnvironment = {
  SAVIA_API_RESOURCE?: string;
  SAVIA_OAUTH_ISSUER?: string;
  SAVIA_MCP_SHARED_SECRET?: string;
  SAVIA_MCP_URL?: string;
  AUTH?: AuthService;
  MCP?: { fetch: typeof fetch };
};

/** Public OAuth boundary; the existing MCP Worker remains private and stateless. */
export async function remoteMcpResponse(
  request: Request,
  env: McpEnvironment,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const metadataPath = "/.well-known/oauth-protected-resource/mcp";
  const discovery = [
    "/.well-known/oauth-authorization-server/api/auth",
    "/.well-known/openid-configuration",
  ];
  if (
    !discovery.includes(url.pathname) &&
    url.pathname !== metadataPath &&
    url.pathname !== "/mcp"
  )
    return;
  if (!env.SAVIA_API_RESOURCE || !env.SAVIA_OAUTH_ISSUER || !env.AUTH)
    return Response.json(
      { error: "MCP OAuth is not configured" },
      { status: 503 },
    );
  const apiResource = env.SAVIA_API_RESOURCE.replace(/\/$/, "");
  const resource = `${apiResource}/mcp`;
  const metadataUrl = `${apiResource}${metadataPath}`;
  const responseHeaders = { "cache-control": "no-store" };
  if (discovery.includes(url.pathname)) {
    if (request.method !== "GET")
      return new Response(null, { status: 405, headers: { allow: "GET" } });
    return env.AUTH.fetch(
      new Request(new URL(url.pathname, env.SAVIA_OAUTH_ISSUER), {
        headers: { accept: "application/json" },
      }),
    );
  }
  if (url.pathname === metadataPath) {
    if (request.method !== "GET")
      return new Response(null, { status: 405, headers: { allow: "GET" } });
    return Response.json(
      {
        resource,
        authorization_servers: [env.SAVIA_OAUTH_ISSUER],
        scopes_supported: [
          "savia.api.read",
          "savia.api.write",
          "offline_access",
        ],
        bearer_methods_supported: ["header"],
      },
      { headers: responseHeaders },
    );
  }
  const origin = request.headers.get("origin");
  // Cloud-hosted connectors do not send a browser Origin. Do not accept arbitrary websites.
  if (
    origin &&
    ![
      new URL(apiResource).origin,
      "https://chatgpt.com",
      "https://claude.ai",
    ].includes(origin)
  )
    return new Response("Origin is not allowed", { status: 403 });
  if (!["POST", "GET", "DELETE"].includes(request.method))
    return new Response(null, {
      status: 405,
      headers: { allow: "POST, GET, DELETE" },
    });
  const challenge = (status: 401 | 403) =>
    Response.json(
      { error: status === 401 ? "invalid_token" : "insufficient_scope" },
      {
        status,
        headers: {
          ...responseHeaders,
          "www-authenticate": `Bearer resource_metadata="${metadataUrl}", scope="savia.api.read", error="${status === 401 ? "invalid_token" : "insufficient_scope"}"`,
        },
      },
    );
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ") || request.headers.has("dpop"))
    return challenge(401);
  if (!env.SAVIA_MCP_SHARED_SECRET || (!env.MCP && !env.SAVIA_MCP_URL))
    return Response.json(
      { error: "MCP transport is not configured" },
      { status: 503 },
    );
  try {
    const exchanged = await env.AUTH.fetch(
      new Request("https://savia-auth.internal/_internal/oauth/mcp-exchange", {
        method: "POST",
        headers: { authorization },
      }),
    );
    if (exchanged.status === 401 || exchanged.status === 403)
      return challenge(exchanged.status);
    if (!exchanged.ok) throw new Error("Token exchange unavailable");
    const credentials = (await exchanged.json()) as { access_token?: unknown };
    if (
      typeof credentials.access_token !== "string" ||
      !credentials.access_token
    )
      throw new Error("Invalid exchange response");
    const headers = new Headers({
      "x-savia-mcp-secret": env.SAVIA_MCP_SHARED_SECRET,
      "x-savia-user-authorization": `Bearer ${credentials.access_token}`,
    });
    for (const name of ["content-type", "accept", "mcp-protocol-version"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const upstream = new Request(
      env.MCP ? "https://savia-mcp.internal/mcp" : env.SAVIA_MCP_URL!,
      {
        method: request.method,
        headers,
        body: request.method === "POST" ? request.body : undefined,
        signal: request.signal,
        redirect: "manual",
      },
    );
    const response = await (env.MCP
      ? env.MCP.fetch(upstream)
      : fetch(upstream));
    if (response.status >= 300 && response.status < 400)
      throw new Error("MCP redirects are not allowed");
    const outgoing = new Headers(response.headers);
    outgoing.delete("set-cookie");
    outgoing.delete("mcp-session-id");
    outgoing.set("cache-control", "no-store");
    return new Response(response.body, {
      status: response.status,
      headers: outgoing,
    });
  } catch {
    return Response.json(
      { error: "MCP service is unavailable" },
      { status: 502, headers: responseHeaders },
    );
  }
}
