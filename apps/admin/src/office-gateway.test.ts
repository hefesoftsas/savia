import { describe, expect, it, vi } from "vitest";
import { gatewayFetch } from "./edge-gateway";
describe("Office isolation", () => {
  it("isolates only the editor document", async () => {
    const env = {
      API: { fetch: vi.fn() },
      ASSETS: {
        fetch: async () =>
          new Response("<html></html>", {
            headers: { "Content-Type": "text/html" },
          }),
      },
    };
    const office = await gatewayFetch(
      new Request("https://savia.test/office/"),
      env,
    );
    expect(office.headers.get("Cross-Origin-Opener-Policy")).toBe(
      "same-origin",
    );
    expect(office.headers.get("Cross-Origin-Embedder-Policy")).toBe(
      "require-corp",
    );
    expect(office.headers.get("Cache-Control")).toBe("no-store");
    const admin = await gatewayFetch(new Request("https://savia.test/"), env);
    expect(admin.headers.has("Cross-Origin-Opener-Policy")).toBe(false);
  });
  it("does not return the admin shell when runtime assets are missing", async () => {
    const env = {
      API: { fetch: vi.fn() },
      ASSETS: { fetch: async () => new Response("<html>admin</html>") },
    };
    const response = await gatewayFetch(
      new Request("https://savia.test/office/runtime/not-a-build/soffice.wasm"),
      env,
    );
    expect(response.status).toBe(404);
  });
});

it("streams only pinned runtime objects with their original encoding", async () => {
  const { officeAssetResponse } = await import("./office-gateway");
  const { default: manifest } = await import("../office-runtime.json");
  const compressed = new Uint8Array([1, 2, 3]);
  const bucket = {
    get: vi.fn(async () => ({
      body: new Response(compressed).body!,
      size: 3,
      httpMetadata: { contentEncoding: "br" },
    })),
  };
  const url =
    "https://savia.test/office/runtime/" + manifest.build + "/soffice.wasm";
  const response = await officeAssetResponse(new Request(url), bucket);
  expect(response.headers.get("Content-Encoding")).toBe("br");
  expect(response.headers.get("Content-Type")).toBe("application/wasm");
  expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe(
    "same-origin",
  );
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(compressed);
  expect(bucket.get).toHaveBeenCalledWith(
    "office-runtime/" + manifest.build + "/soffice.wasm",
  );
  expect((await officeAssetResponse(new Request(url), undefined)).status).toBe(
    503,
  );
  expect(
    (await officeAssetResponse(new Request(url, { method: "HEAD" }), bucket))
      .body,
  ).toBeNull();
});
