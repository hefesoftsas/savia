import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { actorFromContext } from "../auth/middleware";
import type { AuthService } from "../auth/better-auth";
import { activeTenant } from "../tenant-branding/service";

const tenantIdParam = z.object({
  tenantId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
const settingsInput = z
  .object({
    host: z.string().trim().min(1).max(253),
    port: z.coerce.number().int().min(1).max(65535),
    username: z.string().max(255).optional().default(""),
    password: z.string().max(4096).nullable().optional(),
    from: z.string().trim().email().max(254),
    security: z.enum(["tls", "starttls"]),
  })
  .strict();
const settingsResponse = z.object({
  configured: z.boolean(),
  host: z.string().optional(),
  port: z.number().optional(),
  username: z.string().optional(),
  from: z.string().optional(),
  security: z.enum(["tls", "starttls"]).optional(),
  passwordConfigured: z.boolean().optional(),
});

type EmailBridge = Pick<AuthService, "fetch">;

export async function deleteTenantEmailSettings(
  authService: EmailBridge | undefined,
  bridgeKey: string | undefined,
  tenantId: number,
): Promise<void> {
  await callBridge(authService, bridgeKey, tenantId, "DELETE");
}

async function authorizeTenantEmail(
  db: D1Database,
  actor: ReturnType<typeof actorFromContext>,
  id: number,
) {
  const tenant = await activeTenant(db, id);
  const platform = actor.globalRoles.includes("platform_admin");
  const membership = actor.memberships.find(
    (entry) => entry.isActive && (entry.tenantId ?? entry.agencyId) === id,
  );
  const tenantAdmin =
    !!membership && ["tenant_admin", "agency_admin"].includes(membership.role);
  if (!actor.principal.isActive || (!platform && !tenantAdmin)) {
    throw new HTTPException(403, {
      message: "Tenant email settings access denied.",
    });
  }
  return { tenant, canManage: platform || tenantAdmin };
}

async function callBridge(
  bridge: EmailBridge | undefined,
  key: string | undefined,
  tenantId: number,
  action: "GET" | "PUT" | "DELETE" | "test",
  body?: unknown,
): Promise<Response> {
  if (!bridge || !key?.trim())
    throw new HTTPException(503, {
      message: "Email settings service unavailable.",
    });
  const suffix = action === "test" ? "/test" : "";
  const response = await bridge.fetch(
    new Request(
      `https://savia-auth.internal/_internal/tenant-email/${tenantId}${suffix}`,
      {
        method: action === "test" ? "POST" : action,
        headers: {
          "x-savia-bridge-key": key,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    ),
  );
  const result = (await response
    .json()
    .catch(() => ({ error: "Email settings service unavailable." }))) as {
    error?: unknown;
  };
  if (!response.ok)
    throw new HTTPException(
      response.status as
        400 | 401 | 403 | 404 | 405 | 409 | 413 | 415 | 422 | 500 | 503,
      {
        message:
          typeof result?.error === "string"
            ? result.error
            : "Email settings request failed.",
      },
    );
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}

async function syncTenantAccountEmailDefaults(
  db: D1Database,
  bridge: EmailBridge | undefined,
  key: string | undefined,
  tenantId: number,
): Promise<void> {
  if (!bridge || !key?.trim())
    throw new HTTPException(503, {
      message: "Email settings service unavailable.",
    });
  const members = await db
    .prepare(
      "SELECT p.subject FROM identity_principal p JOIN identity_tenant_membership m ON m.principal_id=p.id WHERE p.issuer='savia:better-auth' AND p.is_active=1 AND m.tenant_id=? AND m.is_active=1 AND NOT EXISTS(SELECT 1 FROM identity_global_role g WHERE g.principal_id=p.id AND g.role='platform_admin')",
    )
    .bind(tenantId)
    .all<{ subject: string }>();
  for (const { subject } of members.results ?? []) {
    const response = await bridge.fetch(
      new Request(
        `https://savia-auth.internal/_internal/users/${encodeURIComponent(subject)}`,
        {
          method: "PATCH",
          headers: {
            "x-savia-bridge-key": key,
            "content-type": "application/json",
          },
          body: JSON.stringify({ tenantId }),
        },
      ),
    );
    if (!response.ok)
      throw new HTTPException(503, {
        message:
          "Email settings were saved, but account delivery defaults could not be synchronized.",
      });
  }
}

export function registerTenantEmailRoutes(
  app: OpenAPIHono,
  db: D1Database,
  authService?: EmailBridge,
  bridgeKey?: string,
): void {
  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/tenants/{tenantId}/email-settings",
      tags: ["Tenant email"],
      request: { params: tenantIdParam },
      responses: {
        200: {
          description: "Redacted tenant SMTP settings",
          content: { "application/json": { schema: settingsResponse } },
        },
      },
    }),
    async (c) => {
      c.header("Cache-Control", "no-store");
      const { tenant } = await authorizeTenantEmail(
        db,
        actorFromContext(c),
        c.req.valid("param").tenantId,
      );
      const response = await callBridge(
        authService,
        bridgeKey,
        tenant.id,
        "GET",
      );
      return c.json(JSON.parse(await response.text()), 200);
    },
  );
  app.openapi(
    createRoute({
      method: "put",
      path: "/v1/tenants/{tenantId}/email-settings",
      tags: ["Tenant email"],
      request: {
        params: tenantIdParam,
        body: {
          required: true,
          content: { "application/json": { schema: settingsInput } },
        },
      },
      responses: {
        200: {
          description: "Saved tenant SMTP settings",
          content: { "application/json": { schema: settingsResponse } },
        },
      },
    }),
    async (c) => {
      c.header("Cache-Control", "no-store");
      const { tenant } = await authorizeTenantEmail(
        db,
        actorFromContext(c),
        c.req.valid("param").tenantId,
      );
      const response = await callBridge(
        authService,
        bridgeKey,
        tenant.id,
        "PUT",
        c.req.valid("json"),
      );
      await syncTenantAccountEmailDefaults(
        db,
        authService,
        bridgeKey,
        tenant.id,
      );
      return c.json(JSON.parse(await response.text()), 200);
    },
  );
  app.openapi(
    createRoute({
      method: "delete",
      path: "/v1/tenants/{tenantId}/email-settings",
      tags: ["Tenant email"],
      request: { params: tenantIdParam },
      responses: {
        200: {
          description: "Removed tenant SMTP settings",
          content: {
            "application/json": {
              schema: z.object({ configured: z.literal(false) }),
            },
          },
        },
      },
    }),
    async (c) => {
      c.header("Cache-Control", "no-store");
      const { tenant } = await authorizeTenantEmail(
        db,
        actorFromContext(c),
        c.req.valid("param").tenantId,
      );
      const response = await callBridge(
        authService,
        bridgeKey,
        tenant.id,
        "DELETE",
      );
      return c.json(JSON.parse(await response.text()), 200);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/tenants/{tenantId}/email-settings/test",
      tags: ["Tenant email"],
      request: { params: tenantIdParam },
      responses: {
        200: {
          description: "Test email sent to the authenticated actor",
          content: {
            "application/json": { schema: z.object({ sent: z.literal(true) }) },
          },
        },
      },
    }),
    async (c) => {
      c.header("Cache-Control", "no-store");
      const { tenant } = await authorizeTenantEmail(
        db,
        actorFromContext(c),
        c.req.valid("param").tenantId,
      );
      const actor = actorFromContext(c);
      const response = await callBridge(
        authService,
        bridgeKey,
        tenant.id,
        "test",
        { actorEmail: actor.principal.email },
      );
      return c.json(JSON.parse(await response.text()), 200);
    },
  );
}
