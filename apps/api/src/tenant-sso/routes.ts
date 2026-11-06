import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { actorFromContext } from "../auth/middleware";
import type { AuthService } from "../auth/better-auth";
import { activeTenant } from "../tenant-branding/service";

const tenantIdParam = z.object({
  tenantId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
const dnsDomain = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
    "Use a lowercase DNS domain.",
  );
const settingsInput = z
  .object({
    displayName: z.string().trim().min(1).max(100),
    domain: dnsDomain,
    idpMetadata: z
      .string()
      .min(1)
      .refine(
        (value) => new TextEncoder().encode(value).byteLength <= 102_400,
        {
          message: "IdP metadata must be at most 100 KiB.",
        },
      )
      .refine((value) => /<\s*(?:\w+:)?EntityDescriptor\b/.test(value), {
        message: "Provide SAML IdP metadata XML.",
      }),
    enabled: z.boolean(),
    ssoOnly: z.boolean(),
  })
  .strict();
const settingsResponse = z.object({
  configured: z.boolean(),
  displayName: z.string().optional(),
  domain: z.string().optional(),
  idpMetadata: z.string().optional(),
  enabled: z.boolean().optional(),
  ssoOnly: z.boolean().optional(),
  providerId: z.string().optional(),
  entityId: z.string().optional(),
  acsUrl: z.string().optional(),
  metadataUrl: z.string().optional(),
});

type SsoBridge = Pick<AuthService, "fetch">;

async function authorizeTenantSSO(
  db: D1Database,
  actor: ReturnType<typeof actorFromContext>,
  id: number,
): Promise<void> {
  const tenant = await activeTenant(db, id);
  const platform = actor.globalRoles.includes("platform_admin");
  const membership = actor.memberships.find(
    (entry) => entry.isActive && (entry.tenantId ?? entry.agencyId) === id,
  );
  const tenantAdmin =
    !!membership && ["tenant_admin", "agency_admin"].includes(membership.role);
  if (!actor.principal.isActive || (!platform && !tenantAdmin))
    throw new HTTPException(403, {
      message: "Tenant SSO settings access denied.",
    });
  return;
}

async function callBridge(
  bridge: SsoBridge | undefined,
  key: string | undefined,
  tenantId: number,
  method: "GET" | "PUT" | "DELETE",
  body?: unknown,
): Promise<Response> {
  if (!bridge || !key?.trim())
    throw new HTTPException(503, {
      message: "Tenant SSO service unavailable.",
    });
  const response = await bridge.fetch(
    new Request(
      `https://savia-auth.internal/_internal/tenant-sso/${tenantId}`,
      {
        method,
        headers: {
          "x-savia-bridge-key": key,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    ),
  );
  const result = await response
    .json()
    .catch(() => ({ error: "Tenant SSO service unavailable." }));
  if (!response.ok) {
    const message =
      typeof result === "object" &&
      result &&
      "error" in result &&
      typeof result.error === "string"
        ? result.error
        : "Tenant SSO request failed.";
    throw new HTTPException(
      response.status as
        400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 500 | 503,
      { message },
    );
  }
  // Validate the authenticated settings contract, which intentionally includes
  // public IdP metadata while stripping unknown internal provider fields.
  return Response.json(settingsResponse.parse(result), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function setTenantSSOActivity(
  bridge: SsoBridge | undefined,
  bridgeKey: string | undefined,
  tenantId: number,
  active: boolean,
): Promise<void> {
  if (!bridge || !bridgeKey?.trim())
    throw new HTTPException(503, {
      message: "Tenant SSO service unavailable.",
    });
  let response: Response;
  try {
    response = await bridge.fetch(
      new Request(
        `https://savia-auth.internal/_internal/tenant-sso/${tenantId}/activity`,
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
      message: "Tenant SSO service unavailable.",
    });
  }
  if (!response.ok)
    throw new HTTPException(503, {
      message: "Tenant SSO activity could not be updated.",
    });
}

async function syncTenantAccountEmailDefaults(
  db: D1Database,
  bridge: SsoBridge | undefined,
  key: string | undefined,
  tenantId: number,
): Promise<void> {
  if (!bridge || !key?.trim())
    throw new HTTPException(503, {
      message: "Tenant SSO service unavailable.",
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
          "SSO settings were saved, but account delivery defaults could not be synchronized.",
      });
  }
}

export async function deleteTenantSSOSettings(
  authService: SsoBridge | undefined,
  bridgeKey: string | undefined,
  id: number,
): Promise<void> {
  await callBridge(authService, bridgeKey, id, "DELETE");
}

export function registerTenantSSORoutes(
  app: OpenAPIHono,
  db: D1Database,
  authService?: SsoBridge,
  bridgeKey?: string,
): void {
  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/tenants/{tenantId}/sso-settings",
      tags: ["Tenant SSO"],
      request: { params: tenantIdParam },
      responses: {
        200: {
          description: "Redacted tenant SAML SSO settings",
          content: { "application/json": { schema: settingsResponse } },
        },
      },
    }),
    async (c) => {
      c.header("Cache-Control", "no-store");
      const id = c.req.valid("param").tenantId;
      await authorizeTenantSSO(db, actorFromContext(c), id);
      const response = await callBridge(authService, bridgeKey, id, "GET");
      return c.json(JSON.parse(await response.text()), 200);
    },
  );
  app.openapi(
    createRoute({
      method: "put",
      path: "/v1/tenants/{tenantId}/sso-settings",
      tags: ["Tenant SSO"],
      request: {
        params: tenantIdParam,
        body: {
          required: true,
          content: { "application/json": { schema: settingsInput } },
        },
      },
      responses: {
        200: {
          description: "Saved tenant SAML SSO settings",
          content: { "application/json": { schema: settingsResponse } },
        },
      },
    }),
    async (c) => {
      c.header("Cache-Control", "no-store");
      const id = c.req.valid("param").tenantId;
      const actor = actorFromContext(c);
      await authorizeTenantSSO(db, actor, id);
      // Assign the tenant-scoped account email default before a save can turn
      // on SSO-only mode and revoke the current administrator's session.
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
      path: "/v1/tenants/{tenantId}/sso-settings",
      tags: ["Tenant SSO"],
      request: { params: tenantIdParam },
      responses: {
        200: {
          description: "Removed tenant SAML SSO settings",
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
      const id = c.req.valid("param").tenantId;
      await authorizeTenantSSO(db, actorFromContext(c), id);
      const response = await callBridge(authService, bridgeKey, id, "DELETE");
      return c.json(JSON.parse(await response.text()), 200);
    },
  );
}
