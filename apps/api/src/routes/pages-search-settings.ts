import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { actorFromContext } from "../auth/middleware";
import type { AppActor } from "../auth/types";
import { activeTenant } from "../tenant-branding/service";
import {
  readPagesSearchSettings,
  type PagesSearchSettings,
} from "../pages/search-settings";

const tenantIdParam = z.object({
  tenantId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
const settingsInput = z
  .object({
    allowed: z.boolean().optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) => value.allowed !== undefined || value.enabled !== undefined,
  );
const settingsResponse = z.object({
  tenantId: z.number(),
  allowed: z.boolean(),
  enabled: z.boolean(),
  effectiveEnabled: z.boolean(),
  canGrant: z.boolean(),
});
const response = {
  200: {
    description: "Tenant page-search settings",
    content: {
      "application/json": { schema: z.object({ data: settingsResponse }) },
    },
  },
  400: { description: "Invalid settings" },
  403: { description: "Tenant administration is required" },
  404: { description: "Active commercial tenant not found" },
};

function isPlatformAdministrator(actor: AppActor) {
  return actor.globalRoles.includes("platform_admin");
}

function isOwnTenantAdministrator(actor: AppActor, tenantId: number) {
  return actor.memberships.some(
    (membership) =>
      membership.isActive &&
      (membership.tenantId ?? membership.agencyId) === tenantId &&
      ["tenant_admin", "agency_admin"].includes(membership.role),
  );
}

function responseData(settings: PagesSearchSettings, actor: AppActor) {
  return { ...settings, canGrant: isPlatformAdministrator(actor) };
}

export function registerPagesSearchSettingsRoutes(
  app: OpenAPIHono,
  db: D1Database,
): void {
  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/tenants/{tenantId}/pages-search-settings",
      tags: ["Tenant pages"],
      summary: "Read tenant page-search settings",
      security: [{ oauth2: ["savia.api.read"] }],
      request: { params: tenantIdParam },
      responses: response,
    }),
    async (c) => {
      const actor = actorFromContext(c);
      const { tenantId } = c.req.valid("param");
      await activeTenant(db, tenantId);
      if (
        !actor.principal.isActive ||
        (!isPlatformAdministrator(actor) &&
          !isOwnTenantAdministrator(actor, tenantId))
      )
        throw new HTTPException(403, {
          message: "Tenant page-search settings access denied.",
        });
      c.header("cache-control", "no-store");
      return c.json(
        {
          data: responseData(
            await readPagesSearchSettings(db, tenantId),
            actor,
          ),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/v1/tenants/{tenantId}/pages-search-settings",
      tags: ["Tenant pages"],
      summary: "Update tenant page-search settings",
      security: [{ oauth2: ["savia.api.write"] }],
      request: {
        params: tenantIdParam,
        body: {
          required: true,
          content: { "application/json": { schema: settingsInput } },
        },
      },
      responses: response,
    }),
    async (c) => {
      const actor = actorFromContext(c);
      const { tenantId } = c.req.valid("param");
      await activeTenant(db, tenantId);
      if (!actor.principal.isActive)
        throw new HTTPException(403, {
          message: "Tenant page-search settings access denied.",
        });

      const input = c.req.valid("json");
      const platform = isPlatformAdministrator(actor);
      if (!platform && !isOwnTenantAdministrator(actor, tenantId))
        throw new HTTPException(403, {
          message: "Tenant page-search settings access denied.",
        });
      if (!platform && input.allowed !== undefined)
        throw new HTTPException(403, {
          message: "Only platform administrators may change the search grant.",
        });

      const now = new Date().toISOString();
      if (platform) {
        if (input.allowed === false && input.enabled === true)
          throw new HTTPException(400, {
            message: "Page search cannot be enabled without a platform grant.",
          });
        try {
          await db
            .prepare(
              `INSERT INTO tenant_pages_search_settings(tenant_id,allowed,enabled,updated_at)
               VALUES(?,?,?,?)
               ON CONFLICT(tenant_id) DO UPDATE SET
                 allowed=CASE WHEN ? IS NULL THEN tenant_pages_search_settings.allowed ELSE excluded.allowed END,
                 enabled=CASE
                   WHEN ?=0 THEN 0
                   WHEN ? IS NULL THEN tenant_pages_search_settings.enabled
                   ELSE excluded.enabled
                 END,
                 updated_at=excluded.updated_at`,
            )
            .bind(
              tenantId,
              input.allowed === true ? 1 : 0,
              input.enabled === true ? 1 : 0,
              now,
              input.allowed === undefined ? null : 1,
              input.allowed === undefined ? 1 : input.allowed ? 1 : 0,
              input.enabled === undefined ? null : 1,
            )
            .run();
        } catch (error) {
          if (
            String(error).includes("CHECK constraint failed") ||
            (typeof error === "object" &&
              error !== null &&
              "code" in error &&
              error.code === "23514")
          )
            throw new HTTPException(400, {
              message:
                "Page search cannot be enabled without a platform grant.",
            });
          throw error;
        }
      } else {
        const result = await db
          .prepare(
            `INSERT INTO tenant_pages_search_settings(tenant_id,allowed,enabled,updated_at)
             SELECT ?,allowed,?,? FROM tenant_pages_search_settings
             WHERE tenant_id=? AND allowed=1
             ON CONFLICT(tenant_id) DO UPDATE SET
               enabled=excluded.enabled,
               updated_at=excluded.updated_at
             WHERE tenant_pages_search_settings.allowed=1
             RETURNING tenant_id`,
          )
          .bind(tenantId, input.enabled === true ? 1 : 0, now, tenantId)
          .first<{ tenant_id: number }>();
        if (!result)
          throw new HTTPException(403, {
            message: "A platform administrator must grant page search first.",
          });
      }

      c.header("cache-control", "no-store");
      return c.json(
        {
          data: responseData(
            await readPagesSearchSettings(db, tenantId),
            actor,
          ),
        },
        200,
      );
    },
  );
}
