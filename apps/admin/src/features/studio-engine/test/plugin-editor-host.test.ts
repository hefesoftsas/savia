import { describe, expect, it } from "vitest";
import host from "../../../../../plugin-editor-runtime/src/index";

describe("asset-only extension host", () => {
  it("blocks API requests and adds CSP to documents and workers", async () => {
    const env = {
      ASSETS: {
        fetch: async () =>
          new Response("asset", {
            headers: { "content-type": "text/javascript" },
          }),
      },
    };
    const api = await host.fetch(
      new Request("https://editor.example.net/api/secret"),
      env,
    );
    expect(api.status).toBe(404);
    const script = await host.fetch(
      new Request("https://editor.example.net/assets/worker.js"),
      env,
    );
    expect(script.headers.get("Content-Security-Policy")).toContain(
      "connect-src 'self' blob:",
    );
    expect(script.headers.get("Content-Security-Policy")).not.toContain(
      "connect-src *",
    );
    expect(script.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(script.headers.get("Set-Cookie")).toBeNull();
  });
  it.each([".html", ""])(
    "replaces the bundled iframe meta policy including canonical %s assets",
    async (suffix) => {
      const html =
        '<meta http-equiv="Content-Security-Policy" content="connect-src https:"><script>bootstrap()</script>';
      const env = {
        ASSETS: {
          fetch: async () =>
            new Response(html, { headers: { "content-type": "text/html" } }),
        },
      };
      const result = await host.fetch(
        new Request(
          `https://editor.example.net/assets/webWorkerExtensionHostIframe-test${suffix}`,
        ),
        env,
      );
      expect(await result.text()).not.toContain(
        'http-equiv="Content-Security-Policy"',
      );
      expect(result.headers.get("Content-Security-Policy")).toContain(
        "connect-src 'self' blob:",
      );
    },
  );
});
