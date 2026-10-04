import { describe, expect, it, vi } from "vitest";
import { createPersonalIntegrationNangoClient } from "../src/personal-integrations/nango";

describe("personal Nango proxy", () => {
  it("completes a retry when deployed Nango returns unknown_connection", async () => {
    const client = createPersonalIntegrationNangoClient(
      { baseUrl: "https://nango.example.test", apiKey: "test-key" },
      async () =>
        Response.json(
          { error: { code: "unknown_connection" } },
          { status: 400 },
        ),
    );
    await expect(
      client.deleteConnection("removed-connection", "jira"),
    ).resolves.toBeUndefined();
  });

  it.each([
    { error: { code: "invalid_provider_config" } },
    { error: { code: "invalid_secret_key_format" } },
    { code: "unknown_connection" },
    null,
  ])("keeps unrelated bad requests retryable: %j", async (body) => {
    const client = createPersonalIntegrationNangoClient(
      { baseUrl: "https://nango.example.test", apiKey: "test-key" },
      async () => Response.json(body, { status: 400 }),
    );
    await expect(client.deleteConnection("connection", "jira")).rejects.toThrow(
      "The personal integration request could not be completed",
    );
  });

  it("completes cleanup when a connection is already absent in Nango", async () => {
    const client = createPersonalIntegrationNangoClient(
      { baseUrl: "https://nango.example.test", apiKey: "test-key" },
      async () => new Response(null, { status: 404 }),
    );
    await expect(
      client.deleteConnection("removed-connection", "jira"),
    ).resolves.toBeUndefined();
  });

  it("keeps failed cleanup retryable when Nango rejects deletion", async () => {
    const client = createPersonalIntegrationNangoClient(
      { baseUrl: "https://nango.example.test", apiKey: "test-key" },
      async () => new Response("private-error", { status: 503 }),
    );
    await expect(client.deleteConnection("connection", "jira")).rejects.toThrow(
      "The personal integration request could not be completed",
    );
  });
  it("forwards a fixed raw OneDrive create request with its no-overwrite guard", async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        expect(request.method).toBe("PUT");
        expect(request.url).toBe(
          "https://nango.example.test/proxy/v1.0/me/drive/root:/renewal.txt:/content?%40microsoft.graph.conflictBehavior=fail",
        );
        expect(request.headers.get("authorization")).toBe(
          "Bearer nango-secret",
        );
        expect(request.headers.get("connection-id")).toBe("nango-connection");
        expect(request.headers.get("provider-config-key")).toBe(
          "onedrive-personal",
        );
        expect(request.headers.get("content-type")).toBe(
          "text/plain; charset=utf-8",
        );
        expect(request.headers.get("nango-proxy-if-match")).toBe("0");
        expect(request.headers.get("base-url-override")).toBe(
          "https://graph.microsoft.com",
        );
        expect(await request.text()).toBe("Renewal details.");
        return Response.json({ id: "file-1" });
      },
    );
    const client = createPersonalIntegrationNangoClient(
      {
        baseUrl: "https://nango.example.test",
        apiKey: "nango-secret",
      },
      fetcher,
    );

    const response = await client.proxy({
      method: "PUT",
      path: "/v1.0/me/drive/root:/renewal.txt:/content?%40microsoft.graph.conflictBehavior=fail",
      connection: {
        id: "connection-1",
        principalId: "principal-1",
        provider: "onedrive_personal",
        status: "connected",
        externalAccountLabel: null,
        externalAccountId: null,
        scopes: [],
        lastValidatedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        nangoConnectionId: "nango-connection",
        nangoIntegrationId: "onedrive-personal",
      },
      rawBody: "Renewal details.",
      contentType: "text/plain; charset=utf-8",
      upstreamHeaders: { "if-match": "0" },
    });

    expect(response.ok).toBe(true);
  });

  it("routes Zoom proxy requests to the Zoom REST API host", async () => {
    const fetcher = vi.fn(async () => Response.json({ id: 123 }));
    const client = createPersonalIntegrationNangoClient(
      { baseUrl: "https://nango.example.test", apiKey: "test-key" },
      fetcher,
    );

    await client.proxy({
      method: "POST",
      path: "/v2/users/me/meetings",
      connection: {
        provider: "zoom",
        nangoConnectionId: "zoom-account",
        nangoIntegrationId: "zoom-app",
      },
      body: { topic: "Planning" },
    });

    const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe(
      "https://nango.example.test/proxy/v2/users/me/meetings",
    );
    expect(new Headers(init.headers).get("base-url-override")).toBe(
      "https://api.zoom.us",
    );
  });
  it.each([
    ["onedrive_personal", "https://graph.microsoft.com"],
    ["jira", "https://api.atlassian.com"],
    ["linear", "https://api.linear.app"],
    ["github", "https://api.github.com"],
    ["google_drive", null],
  ] as const)(
    "pins only the configured provider API destination for %s",
    async (provider) => {
      const fetcher = vi.fn(async () => Response.json({ value: [] }));
      const client = createPersonalIntegrationNangoClient(
        { baseUrl: "https://nango.example.test", apiKey: "test-key" },
        fetcher,
      );
      await client.proxy({
        method: "GET",
        path: "/v1.0/me/drive/root/children",
        connection: {
          id: "connection",
          principalId: "principal",
          provider,
          status: "connected",
          externalAccountLabel: null,
          externalAccountId: null,
          scopes: [],
          lastValidatedAt: null,
          createdAt: "2026-01-01",
          updatedAt: "2026-01-01",
          nangoConnectionId: "nango-connection",
          nangoIntegrationId: "integration",
        },
      });
      const init = (
        fetcher.mock.calls[0] as unknown as [unknown, RequestInit]
      )[1];
      expect(new Headers(init.headers).get("base-url-override")).toBe(
        provider === "onedrive_personal"
          ? "https://graph.microsoft.com"
          : provider === "jira"
            ? "https://api.atlassian.com"
            : provider === "linear"
              ? "https://api.linear.app"
              : provider === "github"
                ? "https://api.github.com"
                : null,
      );
    },
  );

  it("rejects proxy paths that could escape the configured Nango endpoint", async () => {
    const fetcher = vi.fn(async () => Response.json({}));
    const client = createPersonalIntegrationNangoClient(
      { baseUrl: "https://nango.example.test", apiKey: "test-key" },
      fetcher,
    );

    await expect(
      client.proxy({
        method: "GET",
        path: "//attacker.example.test/api",
        connection: {
          id: "connection",
          principalId: "principal",
          provider: "jira",
          status: "connected",
          externalAccountLabel: null,
          externalAccountId: null,
          scopes: [],
          lastValidatedAt: null,
          createdAt: "2026-01-01",
          updatedAt: "2026-01-01",
          nangoConnectionId: "nango-connection",
          nangoIntegrationId: "jira-integration",
        },
      }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
it("preserves cloud content redirects for explicit validation before download", async () => {
  let redirect: RequestRedirect | undefined;
  const client = createPersonalIntegrationNangoClient(
    { baseUrl: "https://nango.example.test", apiKey: "test-key" },
    async (_url, init) => {
      redirect = init?.redirect;
      return new Response(null, {
        status: 302,
        headers: { location: "https://tenant.sharepoint.com/audio" },
      });
    },
  );
  const response = await client.proxy({
    method: "GET",
    path: "/v1.0/me/drive/items/file/content",
    connection: {
      provider: "onedrive_business",
      nangoConnectionId: "owner",
      nangoIntegrationId: "onedrive",
    },
    redirect: "manual",
  });
  expect(redirect).toBe("manual");
  expect(response.status).toBe(302);
});
