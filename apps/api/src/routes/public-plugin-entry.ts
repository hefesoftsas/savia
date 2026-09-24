import type { OpenAPIHono } from "@hono/zod-openapi";
import { verifyPluginEntryGrant } from "@savia/studio-shared/plugin-entry-grant";
import { shellBootstrapJs } from "@savia/studio-server/plugin-store";

export function registerPublicPluginEntryRoutes(
  app: OpenAPIHono,
  db: D1Database,
  secret?: string,
) {
  app.get(
    "/api/public/plugin-store/shell-bootstrap.js",
    () =>
      new Response(shellBootstrapJs(), {
        headers: {
          "content-type": "text/javascript; charset=utf-8",
          "access-control-allow-origin": "*",
          "cache-control": "public, max-age=3600",
          "x-content-type-options": "nosniff",
        },
      }),
  );

  app.get("/api/public/plugin-store/:id/entry", async (c) => {
    const tenantId = c.req.query("tenant") ?? "";
    const pluginId = c.req.param("id");
    const version = c.req.query("version") ?? "";
    const expiresAt = Number(c.req.query("expires"));
    const signature = c.req.query("signature") ?? "";
    if (
      !secret ||
      !tenantId ||
      !pluginId ||
      !version ||
      !(await verifyPluginEntryGrant(
        secret,
        { tenantId, pluginId, version, expiresAt },
        signature,
      ))
    )
      return new Response(null, { status: 404 });

    const artifact = await db
      .prepare(
        `SELECT a.entry_js FROM plugin_store_artifacts a
         JOIN studio_extension_installations i
           ON i.tenant_id=a.tenant_id AND i.id=a.id
           AND i.version=a.version AND i.enabled=1
         WHERE a.tenant_id=? AND a.id=? AND a.version=?`,
      )
      .bind(tenantId, pluginId, version)
      .first<{ entry_js: string }>();
    if (!artifact) return new Response(null, { status: 404 });
    return new Response(artifact.entry_js, {
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        "access-control-allow-origin": "*",
        "cache-control": "private, no-store",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      },
    });
  });
}
