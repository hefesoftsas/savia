import { describe, expect, it, vi } from "vitest";

import {
  gatewayFetch,
  isServicePath,
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
    expect(isServicePath("/docs")).toBe(true);
    expect(isServicePath("/openapi.json")).toBe(true);
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
