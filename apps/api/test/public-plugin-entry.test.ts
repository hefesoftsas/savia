import { OpenAPIHono } from "@hono/zod-openapi";
import { signPluginEntryGrant } from "@savia/studio-shared/plugin-entry-grant";
import { describe, expect, it, vi } from "vitest";
import { registerPublicPluginEntryRoutes } from "../src/routes/public-plugin-entry";

describe("public ZIP entry", () => {
  it("serves only an active installation with a valid short-lived grant", async () => {
    const first = vi
      .fn()
      .mockResolvedValue({ entry_js: "export function render() {}" });
    const bind = vi.fn().mockReturnValue({ first });
    const prepare = vi.fn().mockReturnValue({ bind });
    const app = new OpenAPIHono();
    registerPublicPluginEntryRoutes(
      app,
      { prepare } as unknown as D1Database,
      "test-secret",
    );

    const bootstrap = await app.request(
      "http://localhost/api/public/plugin-store/shell-bootstrap.js",
    );
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.headers.get("access-control-allow-origin")).toBe("*");
    expect(await bootstrap.text()).toContain("import.meta.url");

    const grant = {
      tenantId: "domain:platform",
      pluginId: "insurance.quotes",
      version: "1.3.1",
      expiresAt: Date.now() + 60_000,
    };
    const signature = await signPluginEntryGrant("test-secret", grant);
    const query = new URLSearchParams({
      tenant: grant.tenantId,
      version: grant.version,
      expires: String(grant.expiresAt),
      signature,
    });
    const path = `/api/public/plugin-store/${grant.pluginId}/entry?${query}`;
    const response = await app.request(`http://localhost${path}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.text()).toBe("export function render() {}");
    expect(prepare).toHaveBeenCalledWith(
      expect.stringContaining("i.enabled=1"),
    );
    expect(bind).toHaveBeenCalledWith(
      grant.tenantId,
      grant.pluginId,
      grant.version,
    );

    const invalid = await app.request(
      `http://localhost${path.replace(signature, "invalid")}`,
    );
    expect(invalid.status).toBe(404);
    expect(prepare).toHaveBeenCalledTimes(1);

    first.mockResolvedValueOnce(null);
    const disabled = await app.request(`http://localhost${path}`);
    expect(disabled.status).toBe(404);
  });
});
