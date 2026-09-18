import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { actorFromContext } from "../auth/middleware";
import { AuthenticationError, type AppActor } from "../auth/types";

const tenantIdQuery = z.object({ tenantId: z.coerce.number().int().positive() });

const policySchema = z.object({
  collection: z.string(),
  enabled: z.boolean(),
  refreshSeconds: z.number(),
  updatedAt: z.string(),
});

const putSchema = z.object({
  tenantId: z.number().int().positive(),
  collection: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/),
  enabled: z.boolean(),
  refreshSeconds: z.number().int().min(30).max(86400),
});

const deleteQuery = z.object({
  tenantId: z.coerce.number().int().positive(),
  collection: z.string().min(1).max(64),
});

const listRoute = createRoute({
  method: "get",
  path: "/v1/offline/collections",
  tags: ["Offline"],
  summary: "List offline policies for a tenant",
  security: [{ oauth2: ["savia.api.read"] }],
  request: { query: tenantIdQuery },
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ data: z.array(policySchema) }) },
      },
      description: "Per-collection offline policy rows",
    },
    403: { description: "Tenant access is required" },
  },
});

const upsertRoute = createRoute({
  method: "put",
  path: "/v1/offline/collections",
  tags: ["Offline"],
  summary: "Create or update an offline policy",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    body: {
      content: { "application/json": { schema: putSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ data: policySchema }) },
      },
      description: "Saved policy row",
    },
    400: { description: "Invalid collection or refresh interval" },
    403: { description: "Tenant administration is required" },
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/v1/offline/collections",
  tags: ["Offline"],
  summary: "Delete an offline policy (disables offline for the collection)",
  security: [{ oauth2: ["savia.api.write"] }],
  request: { query: deleteQuery },
  responses: {
    204: { description: "Policy removed" },
    403: { description: "Tenant administration is required" },
    404: { description: "Policy was not found" },
  },
});

function isPlatformAdmin(actor: AppActor): boolean {
  return actor.globalRoles.includes("platform_admin");
}

function tenantMembership(actor: AppActor, tenantId: number) {
  return actor.memberships.find(
    (membership) =>
      membership.isActive && (membership.tenantId ?? membership.agencyId) === tenantId,
  );
}

function requireTenantReader(actor: AppActor, tenantId: number): void {
  if (isPlatformAdmin(actor)) return;
  if (!tenantMembership(actor, tenantId)) {
    throw new AuthenticationError(
      "AUTHORIZATION_FORBIDDEN",
      "No tienes acceso a este tenant.",
    );
  }
}

function requireTenantManager(actor: AppActor, tenantId: number): void {
  if (isPlatformAdmin(actor)) return;
  const membership = tenantMembership(actor, tenantId);
  if (
    !membership ||
    (membership.role !== "tenant_admin" && membership.role !== "agency_admin")
  ) {
    throw new AuthenticationError(
      "AUTHORIZATION_FORBIDDEN",
      "Solo un administrador del tenant puede cambiar la política offline.",
    );
  }
}

export function registerOfflinePolicyRoutes(
  app: OpenAPIHono,
  db: D1Database,
): void {
  app.openapi(listRoute, async (context) => {
    const actor = actorFromContext(context);
    const { tenantId } = context.req.valid("query");
    requireTenantReader(actor, tenantId);
    const rows = await db
      .prepare(
        "SELECT collection, is_enabled, refresh_seconds, updated_at FROM offline_collection_policies WHERE tenant_id=? ORDER BY collection",
      )
      .bind(tenantId)
      .all<{
        collection: string;
        is_enabled: number;
        refresh_seconds: number;
        updated_at: string;
      }>();
    return context.json(
      {
        data: rows.results.map((row) => ({
          collection: row.collection,
          enabled: row.is_enabled === 1,
          refreshSeconds: row.refresh_seconds,
          updatedAt: row.updated_at,
        })),
      },
      200,
    );
  });

  app.openapi(upsertRoute, async (context) => {
    const actor = actorFromContext(context);
    const input = context.req.valid("json");
    requireTenantManager(actor, input.tenantId);
    const now = new Date().toISOString();
    const saved = await db
      .prepare(
        `INSERT INTO offline_collection_policies(tenant_id, collection, is_enabled, refresh_seconds, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, collection) DO UPDATE SET
           is_enabled=excluded.is_enabled,
           refresh_seconds=excluded.refresh_seconds,
           updated_at=excluded.updated_at
         RETURNING collection, is_enabled, refresh_seconds, updated_at`,
      )
      .bind(
        input.tenantId,
        input.collection,
        input.enabled ? 1 : 0,
        input.refreshSeconds,
        now,
        now,
      )
      .first<{
        collection: string;
        is_enabled: number;
        refresh_seconds: number;
        updated_at: string;
      }>();
    if (!saved) throw new Error("Unable to save offline policy");
    return context.json(
      {
        data: {
          collection: saved.collection,
          enabled: saved.is_enabled === 1,
          refreshSeconds: saved.refresh_seconds,
          updatedAt: saved.updated_at,
        },
      },
      200,
    );
  });

  app.openapi(deleteRoute, async (context) => {
    const actor = actorFromContext(context);
    const { tenantId, collection } = context.req.valid("query");
    requireTenantManager(actor, tenantId);
    const removed = await db
      .prepare(
        "DELETE FROM offline_collection_policies WHERE tenant_id=? AND collection=? RETURNING collection",
      )
      .bind(tenantId, collection)
      .first();
    if (!removed) {
      return context.json(
        {
          error: { code: "NOT_FOUND", message: "Policy does not exist" },
        },
        404,
      );
    }
    return context.body(null, 204);
  });
}
