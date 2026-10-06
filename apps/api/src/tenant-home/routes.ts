import type { OpenAPIHono } from "@hono/zod-openapi";

/**
 * Internal tenant-home lookup used by the auth worker to redirect an email
 * to its dedicated tenant subdomain (`<slug>.<canonical>`).
 *
 * Only active commercial tenants are routable through public tenant hosts.
 */
export function registerTenantHomeRoutes(
  app: OpenAPIHono,
  db: D1Database,
  bridgeKey?: string,
): void {
  app.get("/_internal/tenants/:id/home", async (c) => {
    if (
      !bridgeKey?.trim() ||
      c.req.header("x-savia-bridge-key") !== bridgeKey
    ) {
      return c.json({ error: "Forbidden" }, 401);
    }
    const id = Number(c.req.param("id"));
    if (!Number.isSafeInteger(id) || id < 1) {
      return c.json({ error: "Invalid tenant" }, 400);
    }
    const row = await db
      .prepare(
        "SELECT id_slug AS slug FROM tenants WHERE id=? AND kind='commercial' AND is_active=1 LIMIT 1",
      )
      .bind(id)
      .first<{ slug: string }>();
    if (!row?.slug) {
      return c.json({ error: "Tenant not found" }, 404);
    }
    c.header("cache-control", "no-store");
    return c.json({ id, slug: row.slug }, 200);
  });
}
