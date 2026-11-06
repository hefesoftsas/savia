import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { actorFromContext } from "../auth/middleware";

const workspaceSchema = z.object({
  id: z.string(),
  tenantId: z.number(),
  label: z.string(),
  kind: z.enum(["platform", "tenant"]),
  apiBasePath: z.string(),
});

const listRoute = createRoute({
  method: "get",
  path: "/v1/tenant-workspaces",
  tags: ["Tenants"],
  summary: "List authorized tenant workspaces",
  responses: {
    200: {
      description: "Authorized tenant workspaces",
      content: {
        "application/json": {
          schema: z.object({ data: z.array(workspaceSchema) }),
        },
      },
    },
  },
});

export function registerTenantWorkspaceRoutes(
  app: OpenAPIHono,
  db: D1Database,
) {
  app.openapi(listRoute, async (c) => {
    const actor = actorFromContext(c);
    const platform = actor.globalRoles.includes("platform_admin");
    const membershipIds = actor.memberships
      .filter((membership) => membership.isActive)
      .map((membership) => membership.tenantId ?? membership.agencyId);
    const rows = platform
      ? await db
          .prepare(
            "SELECT id,name,kind FROM tenants WHERE is_active=1 ORDER BY CASE WHEN kind='platform' THEN 0 ELSE 1 END,name,id",
          )
          .all<{ id: number; name: string; kind: string }>()
      : membershipIds.length
        ? await db
            .prepare(
              `SELECT id,name,kind FROM tenants WHERE is_active=1 AND kind='commercial' AND id IN (${membershipIds.map(() => "?").join(",")}) ORDER BY name,id`,
            )
            .bind(...membershipIds)
            .all<{ id: number; name: string; kind: string }>()
        : { results: [] as Array<{ id: number; name: string; kind: string }> };
    c.header("cache-control", "no-store");
    return c.json(
      {
        data: rows.results.map((row) => ({
          id: `tenant:${row.id}`,
          tenantId: row.id,
          label: row.name,
          kind:
            row.kind === "platform"
              ? ("platform" as const)
              : ("tenant" as const),
          apiBasePath: `/v1/studio/${row.id}`,
        })),
      },
      200,
    );
  });
}
