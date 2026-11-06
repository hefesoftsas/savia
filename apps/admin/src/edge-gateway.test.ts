import { describe, expect, it, vi } from "vitest";

import {
  flowsContentSecurityPolicy,
  gatewayFetch,
  isImmutableAsset,
  isFlowsUiPath,
  isServicePath,
  serviceWorkerCacheControl,
  staticAssetCacheControl,
  TENANT_SLUG_HEADER,
  tenantSlugFromRequest,
} from "./edge-gateway";

describe("edge gateway", () => {
  it("forwards signed WhatsApp webhooks to the API instead of serving the admin app", async () => {
    const api = { fetch: vi.fn(async () => new Response("EVENT_RECEIVED")) };
    const assets = { fetch: vi.fn(async () => new Response("admin")) };
    const request = new Request(
      "https://savia.example.workers.dev/webhooks/whatsapp",
      { method: "POST", body: "{}" },
    );
    expect(
      await (await gatewayFetch(request, { API: api, ASSETS: assets })).text(),
    ).toBe("EVENT_RECEIVED");
    expect(api.fetch).toHaveBeenCalledWith(request);
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it("forwards API and OAuth paths only to the private API service", async () => {
    const api = { fetch: vi.fn(async () => Response.json({ via: "api" })) };
    const assets = { fetch: vi.fn(async () => new Response("asset")) };
    const request = new Request(
      "https://savia.example.workers.dev/api/auth/sign-in/email",
    );

    const response = await gatewayFetch(request, { API: api, ASSETS: assets });

    expect(await response.json()).toEqual({ via: "api" });
    expect(api.fetch).toHaveBeenCalledWith(request);
    expect(assets.fetch).not.toHaveBeenCalled();
    expect(isServicePath("/.well-known/oauth-protected-resource")).toBe(true);
    expect(isServicePath("/health")).toBe(true);
    expect(isServicePath("/mcp")).toBe(true);
    expect(isServicePath("/docs")).toBe(true);
    expect(isServicePath("/openapi.json")).toBe(true);
    expect(isServicePath("/s/0123456789abcdef")).toBe(true);
  });

  it("serves admin assets without invoking the API service", async () => {
    const api = { fetch: vi.fn(async () => Response.json({ via: "api" })) };
    const assets = { fetch: vi.fn(async () => new Response("admin")) };

    const response = await gatewayFetch(
      new Request("https://savia.example.workers.dev/#/agencies"),
      { API: api, ASSETS: assets },
    );

    expect(await response.text()).toBe("admin");
    expect(assets.fetch).toHaveBeenCalledOnce();
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it("keeps Savia Flows deep links on the child HTML shell", async () => {
    const api = { fetch: vi.fn(async () => Response.json({ via: "api" })) };
    let assetRequest: Request | undefined;
    const assets = {
      fetch: vi.fn(async (request: Request) => {
        assetRequest = request;
        return new Response("flows child shell", {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }),
    };
    const request = new Request(
      "https://savia.example.workers.dev/flows-ui/org/tenant:101/workflows/wf_1?mode=edit",
    );

    const response = await gatewayFetch(request, { API: api, ASSETS: assets });

    expect(assetRequest && new URL(assetRequest.url).pathname).toBe(
      "/flows-ui/index.html",
    );
    expect(assetRequest && new URL(assetRequest.url).search).toBe("?mode=edit");
    expect(await response.text()).toBe("flows child shell");
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-src 'self' blob:",
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "img-src 'self' data: blob:",
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "media-src 'self' data: blob:",
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "connect-src 'self' wss://savia.example.workers.dev",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it("passes hashed Flows assets through with their MIME type and immutable caching", async () => {
    const assets = {
      fetch: vi.fn(async (request: Request) => {
        expect(new URL(request.url).pathname).toBe(
          "/flows-ui/assets/editor-Ab12cdEF.js",
        );
        return new Response("export {}", {
          headers: { "content-type": "text/javascript; charset=utf-8" },
        });
      }),
    };
    const response = await gatewayFetch(
      new Request(
        "https://savia.example.workers.dev/flows-ui/assets/editor-Ab12cdEF.js",
      ),
      {
        API: { fetch: async () => Response.json({}) },
        ASSETS: assets,
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/javascript");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("does not let a missing Flows asset fall back to the Admin HTML shell", async () => {
    const assets = {
      fetch: vi.fn(
        async () =>
          new Response("admin shell", {
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
      ),
    };
    const response = await gatewayFetch(
      new Request(
        "https://savia.example.workers.dev/flows-ui/assets/missing-Ab12cdEF.js",
      ),
      {
        API: { fetch: async () => Response.json({}) },
        ASSETS: assets,
      },
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Savia Flows asset not found");
  });

  it("leaves the main Admin route on the Admin SPA shell", async () => {
    let assetRequest: Request | undefined;
    const assets = {
      fetch: vi.fn(async (request: Request) => {
        assetRequest = request;
        return new Response("admin shell", {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }),
    };
    const response = await gatewayFetch(
      new Request("https://savia.example.workers.dev/savia-flows"),
      {
        API: { fetch: async () => Response.json({}) },
        ASSETS: assets,
      },
    );
    expect(new URL(assetRequest!.url).pathname).toBe("/savia-flows");
    expect(response.headers.get("content-security-policy")).toBeNull();
  });

  it("allows a same-origin WebSocket but no wildcard external socket origin", () => {
    expect(isFlowsUiPath("/flows-ui")).toBe(true);
    expect(isFlowsUiPath("/flows-ui/org/tenant:101/workflows/wf_1")).toBe(true);
    expect(isFlowsUiPath("/flows-ui-evil/assets/app.js")).toBe(false);
    const policy = flowsContentSecurityPolicy(
      new Request("https://savia.example.workers.dev/flows-ui/"),
    );
    expect(policy).toContain("wss://savia.example.workers.dev");
    expect(policy).not.toContain("wss:*");
  });

  it("serves the public Companion catalog before falling back to admin assets", async () => {
    const fetchUpstream = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", fetchUpstream);
    const api = { fetch: vi.fn(async () => Response.json({ via: "api" })) };
    const assets = { fetch: vi.fn(async () => new Response("admin")) };
    const request = new Request(
      "https://savia-catalog-routing.test/companion-downloads.json?cache=bust",
      {
        headers: {
          Authorization: "Bearer user-token",
          Cookie: "session=secret",
        },
      },
    );

    const response = await gatewayFetch(request, { API: api, ASSETS: assets });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(fetchUpstream).toHaveBeenCalledOnce();
    expect(fetchUpstream).toHaveBeenCalledWith(
      "https://api.github.com/repos/hefesoftsas/savia/releases?per_page=30",
      expect.not.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer user-token",
        }),
      }),
    );
    expect(assets.fetch).not.toHaveBeenCalled();
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it("marks fingerprinted assets as immutable", () => {
    expect(isImmutableAsset("/assets/main-CfLYpzF0.js")).toBe(true);
    expect(isImmutableAsset("/assets/main-DbU_fhi5.css")).toBe(true);
    expect(isImmutableAsset("/assets/react-SPdNq8mu.js")).toBe(true);
    expect(isImmutableAsset("/assets/app-DBD_8wTe.js")).toBe(true);
    expect(isImmutableAsset("/assets/icons-Ab12cd.js")).toBe(true);
    expect(isImmutableAsset("/flows-ui/assets/editor-Ab12cdEF.js")).toBe(true);
    expect(isImmutableAsset("/")).toBe(false);
    expect(isImmutableAsset("/index.html")).toBe(false);
    expect(isImmutableAsset("/site.webmanifest")).toBe(false);
    expect(isImmutableAsset("/savia-logo-large.png")).toBe(false);
    expect(isImmutableAsset("/assets/logo.png")).toBe(false);
  });

  it("serves fingerprinted assets with immutable cache headers", async () => {
    const api = { fetch: vi.fn(async () => Response.json({ via: "api" })) };
    const assets = {
      fetch: vi.fn(
        async () =>
          new Response("js", {
            headers: { "Cache-Control": "public, max-age=0, must-revalidate" },
          }),
      ),
    };

    const response = await gatewayFetch(
      new Request("https://savia.example.workers.dev/assets/main-CfLYpzF0.js"),
      { API: api, ASSETS: assets },
    );

    expect(await response.text()).toBe("js");
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it("keeps must-revalidate on non-fingerprinted assets", async () => {
    const api = { fetch: vi.fn(async () => Response.json({ via: "api" })) };
    const assets = {
      fetch: vi.fn(
        async () =>
          new Response("html", {
            headers: { "Cache-Control": "public, max-age=0, must-revalidate" },
          }),
      ),
    };

    const response = await gatewayFetch(
      new Request("https://savia.example.workers.dev/savia-logo-large.png"),
      { API: api, ASSETS: assets },
    );

    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=0, must-revalidate",
    );
  });

  it("caches versioned root statics immutably and manifest hourly", () => {
    expect(staticAssetCacheControl("/savia-icon-192-v3.png")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(staticAssetCacheControl("/favicon-32-v3.png")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(staticAssetCacheControl("/apple-touch-icon-v5.png")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(staticAssetCacheControl("/savia-maskable-512-v5.png")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(staticAssetCacheControl("/savia-splash-192-v1.png")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(staticAssetCacheControl("/favicon.svg")).toBe(
      "public, max-age=86400, must-revalidate",
    );
    expect(staticAssetCacheControl("/site.webmanifest")).toBe(
      "public, max-age=3600, must-revalidate",
    );
    expect(staticAssetCacheControl("/savia-logo-large-480.webp")).toBe(
      "public, max-age=3600, must-revalidate",
    );
    expect(staticAssetCacheControl("/savia-logo-large.png")).toBeNull();
    expect(staticAssetCacheControl("/")).toBeNull();
  });

  it("serves the manifest with hourly cache headers", async () => {
    const api = { fetch: vi.fn(async () => Response.json({ via: "api" })) };
    const assets = {
      fetch: vi.fn(
        async () =>
          new Response("{}", {
            headers: { "Cache-Control": "public, max-age=0, must-revalidate" },
          }),
      ),
    };

    const response = await gatewayFetch(
      new Request("https://savia.example.workers.dev/site.webmanifest"),
      { API: api, ASSETS: assets },
    );

    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=3600, must-revalidate",
    );
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it("serves the worker script with no-store so updates are found", async () => {
    expect(serviceWorkerCacheControl("/sw.js")).toBe("no-store");
    expect(serviceWorkerCacheControl("/dev-sw.js")).toBe("no-store");
    expect(serviceWorkerCacheControl("/assets/main-CfLYpzF0.js")).toBeNull();
    const api = { fetch: vi.fn(async () => Response.json({ via: "api" })) };
    const assets = {
      fetch: vi.fn(
        async () =>
          new Response("worker", {
            headers: { "Cache-Control": "public, max-age=3600" },
          }),
      ),
    };
    const response = await gatewayFetch(
      new Request("https://savia.example.workers.dev/sw.js"),
      { API: api, ASSETS: assets },
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it("resolves the tenant slug only for direct tenant subdomains", () => {
    expect(
      tenantSlugFromRequest(
        new Request("https://merkaseguros.savia.hefesoft.com/v1/tenants"),
      ),
    ).toBe("merkaseguros");
    expect(
      tenantSlugFromRequest(
        new Request("https://savia.hefesoft.com/v1/tenants"),
      ),
    ).toBeNull();
    expect(
      tenantSlugFromRequest(
        new Request("https://api.savia.hefesoft.com/v1/tenants"),
      ),
    ).toBeNull();
  });

  it("forwards the tenant slug to the API on service paths", async () => {
    const api = {
      fetch: vi.fn(async (_request: Request) => Response.json({ via: "api" })),
    };
    const assets = { fetch: vi.fn(async () => new Response("admin")) };

    await gatewayFetch(
      new Request("https://merkaseguros.savia.hefesoft.com/v1/tenants"),
      { API: api, ASSETS: assets },
    );

    expect(api.fetch).toHaveBeenCalledOnce();
    const forwarded = api.fetch.mock.calls[0]?.[0];
    expect(forwarded?.headers.get(TENANT_SLUG_HEADER)).toBe("merkaseguros");
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it("does not add the tenant header on the canonical host", async () => {
    const api = { fetch: vi.fn(async () => Response.json({ via: "api" })) };
    const assets = { fetch: vi.fn(async () => new Response("admin")) };
    const request = new Request("https://savia.hefesoft.com/v1/tenants");

    await gatewayFetch(request, { API: api, ASSETS: assets });

    expect(api.fetch).toHaveBeenCalledWith(request);
  });

  it("redirects legacy apex and tenant hosts to their fixed new hosts", async () => {
    const api = { fetch: vi.fn(async () => Response.json({ via: "api" })) };
    const assets = { fetch: vi.fn(async () => new Response("admin")) };

    const apex = await gatewayFetch(
      new Request("https://savia.app.hefesoft.com/help/article?q=one"),
      { API: api, ASSETS: assets },
    );
    const tenant = await gatewayFetch(
      new Request(
        "https://merkaseguros.savia.app.hefesoft.com/bookings?date=2026-10-18",
      ),
      { API: api, ASSETS: assets },
    );

    expect(apex.status).toBe(308);
    expect(apex.headers.get("location")).toBe(
      "https://savia.hefesoft.com/help/article?q=one",
    );
    expect(apex.headers.get("cache-control")).toBe("no-store");
    expect(tenant.status).toBe(308);
    expect(tenant.headers.get("location")).toBe(
      "https://merkaseguros.savia.hefesoft.com/bookings?date=2026-10-18",
    );
    expect(api.fetch).not.toHaveBeenCalled();
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it("drops legacy OAuth callback query strings and restarts login at the new origin", async () => {
    const api = { fetch: vi.fn(async () => Response.json({ via: "api" })) };
    const assets = { fetch: vi.fn(async () => new Response("admin")) };

    const apiCallback = await gatewayFetch(
      new Request(
        "https://savia.app.hefesoft.com/api/auth/callback/google?code=secret&state=old-state",
      ),
      { API: api, ASSETS: assets },
    );
    const adminCallback = await gatewayFetch(
      new Request(
        "https://merkaseguros.savia.app.hefesoft.com/auth/callback?code=secret&state=old-state",
      ),
      { API: api, ASSETS: assets },
    );

    expect(apiCallback.headers.get("location")).toBe(
      "https://savia.hefesoft.com/",
    );
    expect(adminCallback.headers.get("location")).toBe(
      "https://merkaseguros.savia.hefesoft.com/",
    );
    expect(apiCallback.headers.get("referrer-policy")).toBe("no-referrer");
    expect(api.fetch).not.toHaveBeenCalled();
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it.each([
    "https://api.savia.app.hefesoft.com/",
    "https://admin.savia.app.hefesoft.com/",
    "https://a.b.savia.app.hefesoft.com/",
  ])("rejects invalid legacy host %s", async (url) => {
    const api = { fetch: vi.fn(async () => Response.json({ via: "api" })) };
    const assets = { fetch: vi.fn(async () => new Response("admin")) };

    const response = await gatewayFetch(new Request(url), {
      API: api,
      ASSETS: assets,
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    expect(api.fetch).not.toHaveBeenCalled();
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it("rejects non-read legacy requests without forwarding their body", async () => {
    const api = { fetch: vi.fn(async () => Response.json({ via: "api" })) };
    const assets = { fetch: vi.fn(async () => new Response("admin")) };
    const response = await gatewayFetch(
      new Request("https://savia.app.hefesoft.com/api/auth/admin/callback", {
        method: "POST",
        body: JSON.stringify({ code: "secret", state: "old-state" }),
        headers: { "content-type": "application/json" },
      }),
      { API: api, ASSETS: assets },
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      error: { code: "LEGACY_HOST_MIGRATED" },
    });
    expect(api.fetch).not.toHaveBeenCalled();
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it("does not redirect legacy-looking hosts for Preview or custom deployments", async () => {
    const api = { fetch: vi.fn(async () => Response.json({ via: "api" })) };
    const assets = { fetch: vi.fn(async () => new Response("admin")) };
    const legacy = new Request(
      "https://savia.app.hefesoft.com/api/auth/sign-in/email",
    );

    const preview = await gatewayFetch(legacy, {
      API: api,
      ASSETS: assets,
      CANONICAL_HOST: "savia-preview.hefesoft.com",
    });
    const custom = await gatewayFetch(legacy, {
      API: api,
      ASSETS: assets,
      CANONICAL_HOST: "savia.example.com",
    });

    expect(preview.status).toBe(200);
    expect(custom.status).toBe(200);
    expect(api.fetch).toHaveBeenCalledWith(legacy);
    expect(api.fetch).toHaveBeenCalledTimes(2);
  });
});

it.each([
  "/public/forms/fixture",
  "/public/bookings/fixture",
  "/public/bookings/manage/fixture",
  "/public/pages/fixture",
  "/public/pages/fixture/child",
  "/public/quotes/" + "a".repeat(64),
  "/register",
])(
  "serves public page %s without leaking its link or caching",
  async (path) => {
    const api = { fetch: vi.fn(async () => Response.json({})) };
    const assets = { fetch: vi.fn(async () => new Response("public shell")) };
    const response = await gatewayFetch(
      new Request("https://savia.example" + path),
      { API: api, ASSETS: assets },
    );
    expect(await response.text()).toBe("public shell");
    expect(api.fetch).not.toHaveBeenCalled();
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    await gatewayFetch(
      new Request("https://savia.example/api/public/forms/fixture"),
      { API: api, ASSETS: assets },
    );
    expect(api.fetch).toHaveBeenCalledOnce();
  },
);

it("forwards Savia short URLs to the API redirect handler", async () => {
  const api = {
    fetch: vi.fn(async () =>
      Response.redirect("https://savia.example/public/forms/token", 302),
    ),
  };
  const assets = { fetch: vi.fn(async () => new Response("admin")) };
  const request = new Request("https://savia.example/s/0123456789abcdef");

  const response = await gatewayFetch(request, { API: api, ASSETS: assets });

  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(
    "https://savia.example/public/forms/token",
  );
  expect(api.fetch).toHaveBeenCalledWith(request);
  expect(assets.fetch).not.toHaveBeenCalled();
});
