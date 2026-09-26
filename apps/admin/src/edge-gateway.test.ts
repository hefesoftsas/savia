import { describe, expect, it, vi } from "vitest";

import {
  gatewayFetch,
  isImmutableAsset,
  isServicePath,
  serviceWorkerCacheControl,
  staticAssetCacheControl,
  TENANT_SLUG_HEADER,
  tenantSlugFromRequest,
} from "./edge-gateway";

describe("edge gateway", () => {
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

  it("marks fingerprinted assets as immutable", () => {
    expect(isImmutableAsset("/assets/main-CfLYpzF0.js")).toBe(true);
    expect(isImmutableAsset("/assets/main-DbU_fhi5.css")).toBe(true);
    expect(isImmutableAsset("/assets/react-SPdNq8mu.js")).toBe(true);
    expect(isImmutableAsset("/assets/app-DBD_8wTe.js")).toBe(true);
    expect(isImmutableAsset("/assets/icons-Ab12cd.js")).toBe(true);
    expect(isImmutableAsset("/")).toBe(false);
    expect(isImmutableAsset("/index.html")).toBe(false);
    expect(isImmutableAsset("/site.webmanifest")).toBe(false);
    expect(isImmutableAsset("/savia-logo-large.png")).toBe(false);
    expect(isImmutableAsset("/assets/logo.png")).toBe(false);
  });

  it("serves fingerprinted assets with immutable cache headers", async () => {
    const api = { fetch: vi.fn(async () => Response.json({ via: "api" })) };
    const assets = {
      fetch: vi.fn(async () => new Response("js", {
        headers: { "Cache-Control": "public, max-age=0, must-revalidate" },
      })),
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
      fetch: vi.fn(async () => new Response("html", {
        headers: { "Cache-Control": "public, max-age=0, must-revalidate" },
      })),
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
    expect(staticAssetCacheControl("/apple-touch-icon-v3.png")).toBe(
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
      fetch: vi.fn(async () => new Response("{}", {
        headers: { "Cache-Control": "public, max-age=0, must-revalidate" },
      })),
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
      fetch: vi.fn(async () => new Response("worker", {
        headers: { "Cache-Control": "public, max-age=3600" },
      })),
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
        new Request("https://merkaseguros.savia.app.hefesoft.com/v1/tenants"),
      ),
    ).toBe("merkaseguros");
    expect(
      tenantSlugFromRequest(
        new Request("https://savia.app.hefesoft.com/v1/tenants"),
      ),
    ).toBeNull();
    expect(
      tenantSlugFromRequest(
        new Request("https://api.savia.app.hefesoft.com/v1/tenants"),
      ),
    ).toBeNull();
  });

  it("forwards the tenant slug to the API on service paths", async () => {
    const api = {
      fetch: vi.fn(async (_request: Request) => Response.json({ via: "api" })),
    };
    const assets = { fetch: vi.fn(async () => new Response("admin")) };

    await gatewayFetch(
      new Request("https://merkaseguros.savia.app.hefesoft.com/v1/tenants"),
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
    const request = new Request("https://savia.app.hefesoft.com/v1/tenants");

    await gatewayFetch(request, { API: api, ASSETS: assets });

    expect(api.fetch).toHaveBeenCalledWith(request);
  });
});

it("serves public pages without leaking their link via referrers or caching", async () => {
  const api = { fetch: vi.fn(async () => Response.json({})) };
  const assets = { fetch: vi.fn(async () => new Response("public shell")) };
  const response = await gatewayFetch(
    new Request("https://savia.example/public/forms/fixture"),
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
});

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
