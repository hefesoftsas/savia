import { OpenAPIHono } from "@hono/zod-openapi";
import { env } from "cloudflare:workers";
import { signPluginEntryGrant } from "@savia/studio-shared/plugin-entry-grant";
import { describe, expect, it, vi } from "vitest";
import { registerPublicPluginEntryRoutes } from "../src/routes/public-plugin-entry";

describe("public ZIP entry", () => {
  it("serves only an active installation with a valid short-lived grant", async () => {
    const first = vi.fn().mockResolvedValue({
      entry_js: "export function render() {}",
      sha256: "b".repeat(64),
    });
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
      tenantId: "tenant:0",
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
      "",
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

it("revalidates cached plugin code without reading its body and rejects disabled installations", async () => {
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS plugin_store_artifacts (tenant_id TEXT, id TEXT, version TEXT, sha256 TEXT, entry_js TEXT); CREATE TABLE IF NOT EXISTS studio_extension_installations (tenant_id TEXT, id TEXT, version TEXT, enabled INTEGER);",
  );
  const checksum = "a".repeat(64);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO plugin_store_artifacts VALUES (?, ?, ?, ?, ?)",
    ).bind(
      "cache-test",
      "custom.cached",
      "1",
      checksum,
      "export function render() {}",
    ),
    env.DB.prepare(
      "INSERT INTO studio_extension_installations VALUES (?, ?, ?, ?)",
    ).bind("cache-test", "custom.cached", "1", 1),
  ]);
  const grant = {
    tenantId: "cache-test",
    pluginId: "custom.cached",
    version: "1",
    expiresAt: Date.now() + 60_000,
  };
  const query = new URLSearchParams({
    tenant: grant.tenantId,
    version: grant.version,
    expires: String(grant.expiresAt),
    signature: await signPluginEntryGrant("cache-secret", grant),
  });
  const url = `http://localhost/api/public/plugin-store/custom.cached/entry?${query}`;
  const app = new OpenAPIHono();
  registerPublicPluginEntryRoutes(app, env.DB, "cache-secret");
  const initial = await app.request(url);
  expect(initial.status).toBe(200);
  expect(await initial.text()).toBe("export function render() {}");
  expect(initial.headers.get("etag")).toBe(`"${checksum}"`);
  expect(initial.headers.get("cache-control")).toBe("private, no-cache");
  // The payload is no longer needed when the client's validator matches.
  await env.DB.prepare(
    "UPDATE plugin_store_artifacts SET entry_js=NULL WHERE tenant_id=?",
  )
    .bind(grant.tenantId)
    .run();
  const cached = await app.request(url, {
    headers: { "If-None-Match": `W/"${checksum}"` },
  });
  expect(cached.status).toBe(304);
  expect(await cached.text()).toBe("");
  expect(cached.headers.get("etag")).toBe(initial.headers.get("etag"));
  await env.DB.prepare(
    "UPDATE plugin_store_artifacts SET sha256=?,entry_js=? WHERE tenant_id=?",
  )
    .bind(
      "b".repeat(64),
      "export function render() { /* updated */ }",
      grant.tenantId,
    )
    .run();
  const changed = await app.request(url, {
    headers: { "If-None-Match": `"${checksum}"` },
  });
  expect(changed.status).toBe(200);
  expect(await changed.text()).toContain("updated");
  expect(changed.headers.get("etag")).toBe(`"${"b".repeat(64)}"`);
  await env.DB.prepare(
    "UPDATE studio_extension_installations SET enabled=0 WHERE tenant_id=?",
  )
    .bind(grant.tenantId)
    .run();
  expect(
    (await app.request(url, { headers: { "If-None-Match": `"${checksum}"` } }))
      .status,
  ).toBe(404);
  const invalid = url.replace(query.get("signature")!, "invalid");
  expect(
    (
      await app.request(invalid, {
        headers: { "If-None-Match": `"${checksum}"` },
      })
    ).status,
  ).toBe(404);
});
