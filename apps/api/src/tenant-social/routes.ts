import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { actorFromContext } from "../auth/middleware";
import type { AuthService } from "../auth/better-auth";
import { activeTenant } from "../tenant-branding/service";

const tenantIdParam = z.object({
  tenantId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
const uuid = z.string().uuid();
const settingsInput = z
  .object({
    googleEnabled: z.boolean(),
    microsoftEnabled: z.boolean(),
    microsoftTenantId: z
      .string()
      .trim()
      .refine((value) => value === "" || uuid.safeParse(value).success, {
        message: "Enter a Microsoft Entra tenant UUID.",
      }),
  })
  .strict()
  .refine(
    (value) =>
      !value.microsoftEnabled ||
      uuid.safeParse(value.microsoftTenantId).success,
    {
      message:
        "A Microsoft Entra tenant UUID is required when Microsoft sign-in is enabled.",
    },
  );
const settingsResponse = z.object({
  configured: z.boolean(),
  googleEnabled: z.boolean(),
  microsoftEnabled: z.boolean(),
  microsoftTenantId: z.string(),
  googleAvailable: z.boolean(),
  microsoftAvailable: z.boolean(),
  googleCallbackUrl: z.string(),
  microsoftCallbackUrl: z.string(),
});

type SocialBridge = Pick<AuthService, "fetch">;

async function authorizeTenantSocial(
  db: D1Database,
  actor: ReturnType<typeof actorFromContext>,
  id: number,
): Promise<void> {
  await activeTenant(db, id);
  const platform = actor.globalRoles.includes("platform_admin");
  const membership = actor.memberships.find(
    (entry) => entry.isActive && (entry.tenantId ?? entry.agencyId) === id,
  );
  const tenantAdmin =
    !!membership && ["tenant_admin", "agency_admin"].includes(membership.role);
  if (!actor.principal.isActive || (!platform && !tenantAdmin))
    throw new HTTPException(403, {
      message: "Tenant social login settings access denied.",
    });
}

async function callBridge(
  bridge: SocialBridge | undefined,
  key: string | undefined,
  tenantId: number,
  method: "GET" | "PUT" | "DELETE",
  body?: unknown,
): Promise<Response> {
  if (!bridge || !key?.trim())
    throw new HTTPException(503, {
      message: "Tenant social login service unavailable.",
    });
  let response: Response;
  try {
    response = await bridge.fetch(
      new Request(
        `https://savia-auth.internal/_internal/tenant-social/${tenantId}`,
        {
          method,
          headers: {
            "x-savia-bridge-key": key,
            ...(body === undefined
              ? {}
              : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
      ),
    );
  } catch {
    throw new HTTPException(503, {
      message: "Tenant social login service unavailable.",
    });
  }
  const result = await response
    .json()
    .catch(() => ({ error: "Tenant social login service unavailable." }));
  if (!response.ok) {
    const message =
      typeof result === "object" &&
      result &&
      "error" in result &&
      typeof result.error === "string"
        ? result.error
        : "Tenant social login request failed.";
    throw new HTTPException(
      response.status as 400 | 401 | 403 | 404 | 409 | 422 | 500 | 503,
      { message },
    );
  }
  return Response.json(settingsResponse.parse(result), {
    headers: { "Cache-Control": "no-store" },
  });
}

async function syncTenantAccountEmailDefaults(
  db: D1Database,
  bridge: SocialBridge | undefined,
  key: string | undefined,
  tenantId: number,
): Promise<void> {
  if (!bridge || !key?.trim())
    throw new HTTPException(503, {
      message: "Tenant social login service unavailable.",
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
          "Social login settings were saved, but account delivery defaults could not be synchronized.",
      });
  }
}

export async function deleteTenantSocialSettings(
  authService: SocialBridge | undefined,
  bridgeKey: string | undefined,
  id: number,
): Promise<void> {
  await callBridge(authService, bridgeKey, id, "DELETE");
}

export async function setTenantSocialActivity(
  bridge: SocialBridge | undefined,
  bridgeKey: string | undefined,
  tenantId: number,
  active: boolean,
): Promise<void> {
  if (!bridge || !bridgeKey?.trim())
    throw new HTTPException(503, {
      message: "Tenant social login service unavailable.",
    });
  let response: Response;
  try {
    response = await bridge.fetch(
      new Request(
        `https://savia-auth.internal/_internal/tenant-social/${tenantId}/activity`,
        {
          method: "PATCH",
          headers: {
            "x-savia-bridge-key": bridgeKey,
            "content-type": "application/json",
          },
          body: JSON.stringify({ active }),
        },
      ),
    );
  } catch {
    throw new HTTPException(503, {
      message: "Tenant social login activity could not be updated.",
    });
  }
  if (!response.ok)
    throw new HTTPException(503, {
      message: "Tenant social login activity could not be updated.",
    });
}

export function registerTenantSocialRoutes(
  app: OpenAPIHono,
  db: D1Database,
  authService?: SocialBridge,
  bridgeKey?: string,
): void {
  const path = "/v1/tenants/{tenantId}/social-settings";
  app.openapi(
    createRoute({
      method: "get",
      path,
      tags: ["Tenant Social Login"],
      request: { params: tenantIdParam },
      responses: {
        200: {
          description: "Tenant Google and Microsoft sign-in settings",
          content: { "application/json": { schema: settingsResponse } },
        },
      },
    }),
    async (c) => {
      c.header("Cache-Control", "no-store");
      const id = c.req.valid("param").tenantId;
      await authorizeTenantSocial(db, actorFromContext(c), id);
      const response = await callBridge(authService, bridgeKey, id, "GET");
      return c.json(JSON.parse(await response.text()), 200);
    },
  );
  app.openapi(
    createRoute({
      method: "put",
      path,
      tags: ["Tenant Social Login"],
      request: {
        params: tenantIdParam,
        body: {
          required: true,
          content: { "application/json": { schema: settingsInput } },
        },
      },
      responses: {
        200: {
          description: "Saved tenant Google and Microsoft sign-in settings",
          content: { "application/json": { schema: settingsResponse } },
        },
      },
    }),
    async (c) => {
      c.header("Cache-Control", "no-store");
      const id = c.req.valid("param").tenantId;
      const actor = actorFromContext(c);
      await authorizeTenantSocial(db, actor, id);
      await syncTenantAccountEmailDefaults(db, authService, bridgeKey, id);
      const response = await callBridge(authService, bridgeKey, id, "PUT", {
        ...c.req.valid("json"),
        actorSubject: actor.principal.subject,
      });
      return c.json(JSON.parse(await response.text()), 200);
    },
  );
  app.openapi(
    createRoute({
      method: "delete",
      path,
      tags: ["Tenant Social Login"],
      request: { params: tenantIdParam },
      responses: {
        200: {
          description: "Removed tenant social login settings",
          content: { "application/json": { schema: settingsResponse } },
        },
      },
    }),
    async (c) => {
      c.header("Cache-Control", "no-store");
      const id = c.req.valid("param").tenantId;
      await authorizeTenantSocial(db, actorFromContext(c), id);
      const response = await callBridge(authService, bridgeKey, id, "DELETE");
      return c.json(JSON.parse(await response.text()), 200);
    },
  );
}
