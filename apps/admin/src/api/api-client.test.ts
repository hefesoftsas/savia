import { describe, expect, it, vi } from "vitest";
import { ApiClient, ApiClientError } from "./api-client";

describe("ApiClient", () => {
  it("adds a bearer token to Savia requests", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "quote-1" } }), {
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new ApiClient({
      baseUrl: "http://127.0.0.1:8787",
      tokenSource: { getAccessToken: async () => "access-token" },
      fetcher,
    });

    await expect(
      client.get<{ data: { id: string } }>("/v1/quotes"),
    ).resolves.toEqual({
      data: { id: "quote-1" },
    });
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/v1/quotes",
      expect.any(Object),
    );
    const request = fetcher.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(request.headers);
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer access-token");
  });

  it("maps Savia error envelopes to typed errors", async () => {
    const client = new ApiClient({
      baseUrl: "http://127.0.0.1:8787",
      tokenSource: { getAccessToken: async () => null },
      fetcher: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "AUTHORIZATION_FORBIDDEN", message: "Forbidden" },
          }),
          { status: 403, headers: { "content-type": "application/json" } },
        ),
      ),
    });

    const request = client.get("/v1/domains");
    await expect(request).rejects.toBeInstanceOf(ApiClientError);
    try {
      await request;
    } catch (error) {
      expect(error).toMatchObject({
        status: 403,
        code: "AUTHORIZATION_FORBIDDEN",
        message: "Forbidden",
      });
    }
  });

  it("surfaces string-valued server error envelopes", async () => {
    const client = new ApiClient({
      baseUrl: "http://127.0.0.1:8787",
      tokenSource: { getAccessToken: async () => null },
      fetcher: vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: "Connected assistant required" },
            { status: 409 },
          ),
        ),
    });

    await expect(
      client.get("/v1/whatsapp/native/assets?agencyId=101"),
    ).rejects.toMatchObject({
      status: 409,
      code: "HTTP_409",
      message: "Connected assistant required",
    });
  });

  it("calls the browser fetch function with its global receiver", async () => {
    const browserFetch = vi.fn(function (this: typeof globalThis) {
      if (this !== globalThis) throw new Error("fetch lost its receiver");
      return Promise.resolve(
        new Response(JSON.stringify({ data: [] }), {
          headers: { "content-type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", browserFetch);
    const client = new ApiClient({
      baseUrl: "http://127.0.0.1:8787",
      tokenSource: { getAccessToken: async () => null },
    });

    await expect(client.get("/v1/domains")).resolves.toEqual({ data: [] });
    vi.unstubAllGlobals();
  });

  it("sends authenticated JSON PUT requests", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ saved: true }), {
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new ApiClient({
      baseUrl: "http://127.0.0.1:8787",
      tokenSource: { getAccessToken: async () => "access-token" },
      fetcher,
    });

    await expect(
      client.put<{ saved: boolean }>("/v1/assistant/configuration/global", {
        model: "openai/gpt-5",
      }),
    ).resolves.toEqual({ saved: true });

    const request = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(request.method).toBe("PUT");
    expect(request.body).toBe(JSON.stringify({ model: "openai/gpt-5" }));
  });

  it("sends authenticated multipart uploads without overriding the boundary content type", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ data: { mediaId: "123" } }));
    const client = new ApiClient({
      baseUrl: "http://127.0.0.1:8787",
      tokenSource: { getAccessToken: async () => "access-token" },
      fetcher,
    });
    const form = new FormData();
    form.append("file", new File(["image"], "photo.png"));
    await expect(
      client.postForm("/v1/whatsapp/native/media", form),
    ).resolves.toEqual({
      data: { mediaId: "123" },
    });
    const request = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(request.method).toBe("POST");
    expect(request.body).toBe(form);
    expect(new Headers(request.headers).get("Authorization")).toBe(
      "Bearer access-token",
    );
    expect(new Headers(request.headers).has("Content-Type")).toBe(false);
  });

  it.each([
    "/v1/domains",
    "/v1/agency-network/agency-profiles?limit=10",
    "/v1/customer-portfolio/commands/update-customer-profile",
    "/v1/reference-values/identification-types",
    "/v1/insurance-catalog/products",
  ])(
    "keeps tenant path %s on the core worker with authentication",
    async (path) => {
      const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [] }));
      const client = new ApiClient({
        baseUrl: "http://127.0.0.1:5173",
        tokenSource: { getAccessToken: async () => "token" },
        fetcher,
      });
      await client.get(path);
      expect(fetcher.mock.calls[0][0]).toBe(`http://127.0.0.1:5173${path}`);
      const init = fetcher.mock.calls[0][1] as RequestInit;
      expect(init.credentials).toBe("include");
      expect(new Headers(init.headers).get("Authorization")).toBe(
        "Bearer token",
      );
    },
  );

  it.each([
    "/api/records/contacts",
    "/v1/crm/connections",
    "/v1/domains-other",
    "/v1/assistant/configuration/global",
  ])("keeps generic %s on core", async (path) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [] }));
    const client = new ApiClient({
      baseUrl: "http://127.0.0.1:5173",
      tokenSource: { getAccessToken: async () => null },
      fetcher,
    });
    await client.get(path);
    expect(fetcher.mock.calls[0][0]).toBe(`http://127.0.0.1:5173${path}`);
  });
});
