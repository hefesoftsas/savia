import { describe, expect, it } from "vitest";
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
