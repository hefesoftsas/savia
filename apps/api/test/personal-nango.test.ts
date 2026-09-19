import { describe, expect, it, vi } from "vitest";
import { createPersonalIntegrationNangoClient } from "../src/personal-integrations/nango";

describe("personal Nango proxy", () => {
  it("forwards a fixed raw OneDrive create request with its no-overwrite guard", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(request.method).toBe("PUT");
      expect(request.url).toBe(
        "https://nango.example.test/proxy/v1.0/me/drive/root:/renewal.txt:/content?%40microsoft.graph.conflictBehavior=fail",
      );
      expect(request.headers.get("authorization")).toBe("Bearer nango-secret");
      expect(request.headers.get("connection-id")).toBe("nango-connection");
      expect(request.headers.get("provider-config-key")).toBe("onedrive-personal");
      expect(request.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(request.headers.get("nango-proxy-if-match")).toBe("0");
      expect(await request.text()).toBe("Renewal details.");
      return Response.json({ id: "file-1" });
    });
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
});
