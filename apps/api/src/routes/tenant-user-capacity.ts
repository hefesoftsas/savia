import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  actorFromContext,
  requirePlatformAdministrator,
} from "../auth/middleware";
import { AuthenticationError } from "../auth/types";
import { tenantUserCapacity } from "../auth/tenant-user-capacity";

const param = z.object({ tenantId: z.coerce.number().int().positive().safe() });
const limit = z.number().int().min(0).max(2147483647).nullable();
const capacity = z.object({
  tenantId: z.number(),
  maxActiveUsers: limit,
  activeUsers: z.number(),
});
const responses = {
  200: {
    description: "Tenant active-user capacity",
    content: { "application/json": { schema: z.object({ data: capacity }) } },
  },
  403: {
    description:
      "Tenant administration is required; only platform administrators may change capacity",
  },
  404: { description: "Commercial tenant not found" },
};
const read = createRoute({
  method: "get",
  path: "/v1/tenants/{tenantId}/user-capacity",
  tags: ["Tenants"],
  summary: "Read tenant active-user capacity",
  security: [{ oauth2: ["savia.api.read"] }],
  request: { params: param },
  responses,
});
const write = createRoute({
  method: "put",
  path: "/v1/tenants/{tenantId}/user-capacity",
  tags: ["Tenants"],
  summary: "Set tenant active-user capacity",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    params: param,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ maxActiveUsers: limit }).strict(),
        },
      },
    },
  },
  responses,
});

export function registerTenantUserCapacityRoutes(
  app: OpenAPIHono,
  db: D1Database,
) {
  const exists = (tenantId: number) =>
    db
      .prepare("SELECT id FROM tenants WHERE id=? AND kind='commercial'")
      .bind(tenantId)
      .first();
  app.openapi(read, async (c) => {
    const { tenantId } = c.req.valid("param");
    const actor = actorFromContext(c);
    if (
      !actor.globalRoles.includes("platform_admin") &&
      !actor.memberships.some(
        (m) =>
          m.isActive &&
          (m.tenantId ?? m.agencyId) === tenantId &&
          ["tenant_admin", "agency_admin"].includes(m.role),
      )
    )
      throw new AuthenticationError(
        "AUTHORIZATION_FORBIDDEN",
        "Tenant administration is required",
      );
    if (!(await exists(tenantId)))
      return c.json({ error: "Tenant not found" }, 404);
    c.header("cache-control", "no-store");
    return c.json({ data: await tenantUserCapacity(db, tenantId) }, 200);
  });
  app.openapi(write, async (c) => {
    requirePlatformAdministrator(actorFromContext(c));
    const { tenantId } = c.req.valid("param");
    if (!(await exists(tenantId)))
      return c.json({ error: "Tenant not found" }, 404);
    const { maxActiveUsers } = c.req.valid("json");
    await db
      .prepare(
        `INSERT INTO tenant_user_limits(tenant_id,max_active_users) VALUES(?,?)
      ON CONFLICT(tenant_id) DO UPDATE SET max_active_users=excluded.max_active_users`,
      )
      .bind(tenantId, maxActiveUsers)
      .run();
    c.header("cache-control", "no-store");
    return c.json({ data: await tenantUserCapacity(db, tenantId) }, 200);
  });
}
