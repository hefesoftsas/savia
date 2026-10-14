import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { createCollectionSourceApp } from "../src/studio/collection-sources";
const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([a], [b]) => a.localeCompare(b));
beforeAll(async () => {
  for (const [, sql] of migrations)
    for (const part of sql.split("--> statement-breakpoint")) {
      const s = part
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (s) await env.DB.exec(s);
    }
});
const KEY = "mcp-source-test-encryption-key-32-characters";
const make = (owner = "owner", tenant = "mcp-sources") =>
  createCollectionSourceApp(env.DB, env.DOCUMENTS, tenant, owner, KEY);
const call = (path: string, method = "GET", body?: unknown, app = make()) =>
  app.request(`https://savia.dev/api/${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
it("stores MCP credentials encrypted and scopes source management", async () => {
  const r = await call("sources", "POST", {
    id: "secop",
    label: "SECOP",
    kind: "mcp",
    endpoint: "https://secop-live-worker.jose-douglas-dev.workers.dev/mcp",
    authMode: "oauth",
    oauth: {
      clientId: "savia",
      clientSecret: "private-client-secret",
      scope: "read",
    },
  });
  expect(r.status, await r.clone().text()).toBe(201);
  expect(await r.text()).not.toContain("private-client-secret");
  const row = await env.DB.prepare(
    "SELECT config,encrypted_secret FROM studio_collection_sources WHERE tenant_id=? AND id=?",
  )
    .bind("mcp-sources", "secop")
    .first<{ config: string; encrypted_secret: string }>();
  expect(row?.config).not.toContain("private-client-secret");
  expect(row?.encrypted_secret).toBeTruthy();
  expect(row?.encrypted_secret).not.toContain("private-client-secret");
  expect(
    await (await call("sources", "GET", undefined, make("other"))).json(),
  ).toMatchObject({ data: [] });
  expect(
    (
      await call(
        "sources/secop/test",
        "POST",
        {},
        make("owner", "other-tenant"),
      )
    ).status,
  ).toBe(404);
  expect(
    (await call("sources/secop", "PUT", { writeEnabled: true })).status,
  ).toBe(422);
});
it("rejects private endpoints and source writes before making network requests", async () => {
  expect(
    (
      await call("sources", "POST", {
        id: "private",
        label: "Private",
        kind: "mcp",
        endpoint: "http://127.0.0.1/mcp",
        authMode: "none",
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await call("sources", "POST", {
        id: "bearer",
        label: "Bearer",
        kind: "mcp",
        endpoint: "https://mcp.public.dev/mcp",
        authMode: "bearer",
        token: "private-bearer",
      })
    ).status,
  ).toBe(201);
  expect(await (await call("sources")).text()).not.toContain("private-bearer");
  expect(
    (
      await call("sources/secop/oauth/start", "POST", {
        redirectUri: "https://evil.dev/callback",
      })
    ).status,
  ).toBe(422);
  expect(
    (await call("sources/secop/oauth/callback?state=missing&code=x")).status,
  ).toBe(422);
});

const oauthFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === "cloudflare-dns.com")
    return Response.json({
      Status: 0,
      Answer: [{ type: 1, data: "104.16.1.1" }],
    });
  if (url.pathname.includes("oauth-protected-resource"))
    return Response.json({
      resource: "https://mcp.public.dev/mcp",
      authorization_servers: ["https://mcp.public.dev"],
      scopes_supported: ["read"],
    });
  if (
    url.pathname.includes("oauth-authorization-server") ||
    url.pathname.includes("openid-configuration")
  )
    return Response.json({
      issuer: "https://mcp.public.dev",
      authorization_endpoint: "https://mcp.public.dev/authorize",
      token_endpoint: "https://mcp.public.dev/token",
      registration_endpoint: "https://mcp.public.dev/register",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  if (url.pathname === "/register")
    return Response.json(
      {
        client_id: "savia-dynamic",
        redirect_uris: [
          "https://savia.dev/api/sources/oauth_test/oauth/callback",
        ],
        token_endpoint_auth_method: "none",
      },
      { status: 201 },
    );
  if (url.pathname === "/token") {
    const params = new URLSearchParams(String(init?.body));
    expect(params.get("code_verifier")).toBeTruthy();
    expect(params.get("code")).toBe("valid-code");
    return Response.json({
      access_token: "private-access",
      refresh_token: "private-refresh",
      token_type: "Bearer",
      expires_in: 3600,
    });
  }
  return new Response(null, { status: 404 });
};
it("completes scoped PKCE OAuth once, persisting tokens encrypted", async () => {
  const oauthApp = createCollectionSourceApp(
    env.DB,
    env.DOCUMENTS,
    "mcp-oauth",
    "owner",
    KEY,
    oauthFetch,
  );
  const body = {
    id: "oauth_test",
    label: "OAuth",
    kind: "mcp",
    endpoint: "https://mcp.public.dev/mcp",
    authMode: "oauth",
  };
  expect((await call("sources", "POST", body, oauthApp)).status).toBe(201);
  const start = await call(
    "sources/oauth_test/oauth/start",
    "POST",
    { redirectUri: "https://savia.dev/api/sources/oauth_test/oauth/callback" },
    oauthApp,
  );
  expect(start.status, await start.clone().text()).toBe(200);
  const { data } = (await start.json()) as {
    data: { authorizationUrl: string };
  };
  const url = new URL(data.authorizationUrl);
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  const state = url.searchParams.get("state")!;
  expect(state).toBeTruthy();
  const wrongOwner = createCollectionSourceApp(
    env.DB,
    env.DOCUMENTS,
    "mcp-oauth",
    "other",
    KEY,
    oauthFetch,
  );
  const path = `sources/oauth_test/oauth/callback?state=${state}&code=valid-code`;
  expect((await call(path, "GET", undefined, wrongOwner)).status).toBe(404);
  const finish = await call(path, "GET", undefined, oauthApp);
  expect(finish.status, await finish.clone().text()).toBe(200);
  expect(finish.headers.get("referrer-policy")).toBe("no-referrer");
  const listed = await (
    await call("sources", "GET", undefined, oauthApp)
  ).text();
  expect(listed).not.toContain("private-access");
  expect(listed).not.toContain("private-refresh");
  expect(listed).toContain('"hasToken":true');
  expect((await call(path, "GET", undefined, oauthApp)).status).toBe(422);
  const stored = await env.DB.prepare(
    "SELECT encrypted_secret FROM studio_collection_sources WHERE tenant_id=? AND id=?",
  )
    .bind("mcp-oauth", "oauth_test")
    .first<{ encrypted_secret: string }>();
  expect(stored?.encrypted_secret).not.toContain("private-access");
});

it("binds a read-only tool, projects selected fields and rejects all mutations", async () => {
  let toolCalls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "cloudflare-dns.com") return oauthFetch(input, init);
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (body.method === "notifications/initialized")
      return new Response(null, { status: 202 });
    if (init?.method === "DELETE") return new Response(null, { status: 200 });
    let result: unknown;
    if (body.method === "initialize")
      result = {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "fixture", version: "1" },
      };
    if (body.method === "tools/list")
      result = {
        tools: [
          {
            name: "orders",
            inputSchema: { type: "object", properties: {} },
          },
          { name: "write_order", inputSchema: { type: "object" } },
        ],
      };
    if (body.method === "tools/call") {
      toolCalls++;
      result = {
        content: [],
        structuredContent: {
          data: [
            {
              ":id": "order_1",
              title: "Public contract",
              private_column: "not-selected",
            },
          ],
        },
      };
    }
    return Response.json({ jsonrpc: "2.0", id: body.id, result });
  };
  const app = createCollectionSourceApp(
    env.DB,
    env.DOCUMENTS,
    "mcp-binding",
    "owner",
    KEY,
    fetcher,
  );
  expect(
    (
      await call(
        "sources",
        "POST",
        {
          id: "remote",
          label: "Remote",
          kind: "mcp",
          endpoint: "https://mcp.public.dev/mcp",
          authMode: "none",
          readOnlyTools: ["orders"],
        },
        app,
      )
    ).status,
  ).toBe(201);
  const discovery = await call("sources/remote/inspect", "POST", {}, app);
  expect(await discovery.json()).toMatchObject({
    data: { tools: [{ name: "orders" }] },
  });
  const mcp = { idField: ":id", itemsPointer: "/data", arguments: {} };
  const fields = {
    id: { type: "Textbox", label: "ID" },
    title: { type: "Textbox", label: "Title" },
  };
  const payload = {
    name: "contracts",
    label: "Contracts",
    sourceId: "remote",
    resource: "orders",
    mcp,
    fields,
  };
  expect(
    (
      await call(
        "collection-bindings",
        "POST",
        {
          ...payload,
          name: "bad",
          capabilities: {
            list: true,
            read: true,
            create: true,
            update: false,
            delete: false,
          },
        },
        app,
      )
    ).status,
  ).toBe(422);
  const bound = await call("collection-bindings", "POST", payload, app);
  expect(bound.status, await bound.clone().text()).toBe(201);
  const listed = await call(
    "records/contracts?page=1&perPage=25",
    "GET",
    undefined,
    app,
  );
  expect(listed.status, await listed.clone().text()).toBe(200);
  expect(await listed.json()).toMatchObject({
    data: [{ id: "order_1", title: "Public contract" }],
  });
  const before = toolCalls;
  for (const [path, method] of [
    ["records/contracts", "POST"],
    ["records/contracts/order_1", "PATCH"],
    ["records/contracts/order_1", "DELETE"],
    ["collection-bindings/contracts/operations", "PUT"],
  ])
    expect((await call(path, method, {}, app)).status).toBe(405);
  expect(toolCalls).toBe(before);
  const other = createCollectionSourceApp(
    env.DB,
    env.DOCUMENTS,
    "mcp-binding",
    "other",
    KEY,
    fetcher,
  );
  expect(
    (await call("records/contracts", "GET", undefined, other)).status,
  ).toBe(404);
});

it("expires OAuth states and does not consume a state on the wrong source", async () => {
  const app = createCollectionSourceApp(
    env.DB,
    env.DOCUMENTS,
    "mcp-expiry",
    "owner",
    KEY,
    oauthFetch,
  );
  for (const id of ["oauth_test", "other_source"])
    expect(
      (
        await call(
          "sources",
          "POST",
          {
            id,
            label: id,
            kind: "mcp",
            endpoint: "https://mcp.public.dev/mcp",
            authMode: "oauth",
          },
          app,
        )
      ).status,
    ).toBe(201);
  const start = await call(
    "sources/oauth_test/oauth/start",
    "POST",
    { redirectUri: "https://savia.dev/api/sources/oauth_test/oauth/callback" },
    app,
  );
  expect(start.status, await start.clone().text()).toBe(200);
  const result = (await start.json()) as { data: { authorizationUrl: string } };
  const state = new URL(result.data.authorizationUrl).searchParams.get(
    "state",
  )!;
  expect(
    (
      await call(
        `sources/other_source/oauth/callback?state=${state}&code=valid-code`,
        "GET",
        undefined,
        app,
      )
    ).status,
  ).toBe(422);
  expect(
    await env.DB.prepare(
      "SELECT state FROM studio_mcp_oauth_flows WHERE state=?",
    )
      .bind(state)
      .first(),
  ).toBeTruthy();
  await env.DB.prepare(
    "UPDATE studio_mcp_oauth_flows SET expires_at=? WHERE state=?",
  )
    .bind(Date.now() - 1000, state)
    .run();
  expect(
    (
      await call(
        `sources/oauth_test/oauth/callback?state=${state}&code=valid-code`,
        "GET",
        undefined,
        app,
      )
    ).status,
  ).toBe(422);
  expect(
    await env.DB.prepare(
      "SELECT state FROM studio_mcp_oauth_flows WHERE state=?",
    )
      .bind(state)
      .first(),
  ).toBeNull();
});

it("generates MCP source and mapping schemas and an HTML OAuth callback", async () => {
  const { dynamicOpenApi } = await import("../src/studio/dynamic-openapi");
  const doc = await dynamicOpenApi(env.DB, {
    tenant: "tenant:0",
    apiBasePath: "/v1/studio/0",
  });
  const serialized = JSON.stringify(doc);
  expect(serialized).toContain('"mcp_source_oauth_start"');
  expect(serialized).toContain('"itemsPointer"');
  expect(serialized).toContain('"readOnlyTools"');
  expect(serialized).toContain('"text/html"');
  expect(serialized).toContain('"writeOnly":true');
});

it("refreshes expired OAuth tokens in the backend and preserves refresh credentials", async () => {
  let refreshes = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (
      url.pathname === "/token" &&
      new URLSearchParams(String(init?.body)).get("grant_type") ===
        "refresh_token"
    ) {
      refreshes++;
      expect(new URLSearchParams(String(init?.body)).get("refresh_token")).toBe(
        "private-refresh",
      );
      return Response.json({
        access_token: "refreshed-private-access",
        token_type: "Bearer",
        expires_in: 3600,
      });
    }
    return oauthFetch(input, init);
  };
  const app = createCollectionSourceApp(
    env.DB,
    env.DOCUMENTS,
    "mcp-refresh",
    "owner",
    KEY,
    fetcher,
  );
  await call(
    "sources",
    "POST",
    {
      id: "oauth_test",
      label: "Refresh",
      kind: "mcp",
      endpoint: "https://mcp.public.dev/mcp",
      authMode: "oauth",
    },
    app,
  );
  const started = (await (
    await call(
      "sources/oauth_test/oauth/start",
      "POST",
      {
        redirectUri: "https://savia.dev/api/sources/oauth_test/oauth/callback",
      },
      app,
    )
  ).json()) as { data: { authorizationUrl: string } };
  const state = new URL(started.data.authorizationUrl).searchParams.get(
    "state",
  );
  expect(
    (
      await call(
        `sources/oauth_test/oauth/callback?state=${state}&code=valid-code`,
        "GET",
        undefined,
        app,
      )
    ).status,
  ).toBe(200);
  const { encryptSecret, decryptSecret } =
    await import("@savia/studio-server/integrations");
  const context = `${JSON.stringify(["mcp-refresh", "owner"])}:collection-source:oauth_test`;
  const row = await env.DB.prepare(
    "SELECT * FROM studio_collection_sources WHERE tenant_id=? AND id=?",
  )
    .bind("mcp-refresh", "oauth_test")
    .first<{
      id: string;
      kind: string;
      config: string;
      encrypted_secret: string;
    }>();
  const credentials = JSON.parse(
    await decryptSecret(row!.encrypted_secret, KEY, context),
  );
  credentials.tokenExpiresAt = Date.now() - 1000;
  row!.encrypted_secret = await encryptSecret(
    JSON.stringify(credentials),
    KEY,
    context,
  );
  await env.DB.prepare(
    "UPDATE studio_collection_sources SET encrypted_secret=? WHERE tenant_id=? AND id=?",
  )
    .bind(row!.encrypted_secret, "mcp-refresh", "oauth_test")
    .run();
  const { createMcpSourceService } =
    await import("../src/studio/mcp-source-service");
  const connection = await createMcpSourceService({
    db: env.DB,
    tenant: "mcp-refresh",
    principalId: "owner",
    integrationKey: KEY,
    fetcher,
  }).connection(row!);
  expect(refreshes).toBe(1);
  expect(await connection.authProvider?.tokens()).toMatchObject({
    access_token: "refreshed-private-access",
    refresh_token: "private-refresh",
  });
  const exposed = await (await call("sources", "GET", undefined, app)).text();
  expect(exposed).not.toContain("refreshed-private-access");
});
