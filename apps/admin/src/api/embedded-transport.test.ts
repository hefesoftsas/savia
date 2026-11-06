import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "./api-client";
import { createEmbeddedTransport } from "./embedded-transport";
describe("embedded module transport", () => {
  it("preserves binary responses and version headers while using the authenticated API", async () => {
    let request: Request | undefined;
    const api = new ApiClient({
      baseUrl: "https://savia.test",
      tokenSource: { getAccessToken: async () => "test" },
      fetcher: async (input, init) => {
        request = new Request(input, init);
        return new Response("a,b\n1,2", {
          headers: { "content-type": "text/csv" },
        });
      },
    });
    const transport = createEmbeddedTransport(api, "/v1/dynamic-crm/101");
    const response = await transport("/api/export/contact", {
      headers: { "Idempotency-Key": "key" },
    });
    expect(request?.url).toBe(
      "https://savia.test/v1/dynamic-crm/101/api/export/contact",
    );
    expect(request?.headers.get("authorization")).toBe("Bearer test");
    expect(await response.text()).toBe("a,b\n1,2");
  });
  it("rejects foreign URLs and encoded path traversal", async () => {
    const api = new ApiClient({
      baseUrl: "https://savia.test",
      tokenSource: {
        getAccessToken: async () => {
          throw new Error("must not request token");
        },
      },
    });
    const transport = createEmbeddedTransport(api, "/v1/dynamic-crm/101");
    for (const path of [
      "https://evil.test/api/x",
      "//evil.test/api/x",
      "/api/../x",
      "/api/%2e%2e/x",
      "/api/%252e%252e/x",
    ])
      expect((await transport(path, {})).status).toBe(400);
  });
});

it("allows document analysis to exceed the ordinary API timeout without extending other requests", async () => {
  const api = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => "test" },
  });
  const request = vi
    .spyOn(api, "requestResponse")
    .mockResolvedValue(Response.json({ data: {} }));
  const transport = createEmbeddedTransport(api, "/v1/studio/12");
  await transport("/api/extensions/example.documents/document-analysis", {
    method: "POST",
  });
  expect(request).toHaveBeenLastCalledWith(
    "/v1/studio/12/api/extensions/example.documents/document-analysis",
    { method: "POST" },
    90000,
  );
  await transport("/api/records/items", { method: "GET" });
  expect(request).toHaveBeenLastCalledWith(
    "/v1/studio/12/api/records/items",
    { method: "GET" },
    undefined,
  );
});

it("preserves safe document retry metadata through normalized errors", async () => {
  const api = new ApiClient({
    baseUrl: "https://savia.test",
    tokenSource: { getAccessToken: async () => "test" },
    fetcher: async () =>
      Response.json(
        {
          error: {
            code: "ANALYSIS_PROVIDER_UNAVAILABLE",
            message: "Retry",
            fileId: "550e8400-e29b-41d4-a716-446655440000",
          },
        },
        { status: 502 },
      ),
  });
  const response = await createEmbeddedTransport(api, "/v1/studio/12")(
    "/api/extensions/example.documents/document-analysis",
    { method: "POST" },
  );
  expect(await response.json()).toMatchObject({
    error: "Retry",
    code: "ANALYSIS_PROVIDER_UNAVAILABLE",
    fileId: "550e8400-e29b-41d4-a716-446655440000",
  });
});
