import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { AuthService } from "../auth/better-auth";
import { actorFromContext } from "../auth/middleware";
import { activeTenant } from "../tenant-branding/service";
import {
  captchaConfiguration,
  type CaptchaOptions,
} from "../public-forms/captcha";

export const registrationSettingsSchema = z.object({
  allowEmailRegistration: z.boolean(),
  captchaMode: z.enum(["inherit", "tenant"]),
  siteKey: z.string(),
  secretConfigured: z.boolean(),
  emailReady: z.boolean(),
  revision: z.string(),
  passwordAllowed: z.boolean().optional(),
});
const inputSchema = z
  .object({
    allowEmailRegistration: z.boolean(),
    captchaMode: z.enum(["inherit", "tenant"]),
    siteKey: z.string().max(2048).optional(),
    secretKey: z.string().max(4096).nullable().optional(),
  })
  .strict();
const responseSchema = registrationSettingsSchema.extend({
  captchaProvider: z.enum(["turnstile", "altcha"]),
  captchaReady: z.boolean(),
  registrationReady: z.boolean(),
});
const params = z.object({
  tenantId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
type Bridge = Pick<AuthService, "fetch">;
export async function registrationBridge(
  bridge: Bridge | undefined,
  key: string | undefined,
  tenantId: number,
  method = "GET",
  body?: unknown,
  effective = false,
): Promise<unknown> {
  if (!bridge || !key?.trim())
    throw new HTTPException(503, {
      message: "Registration service unavailable.",
    });
  let response: Response;
  try {
    response = await bridge.fetch(
      new Request(
        `https://savia-auth.internal/_internal/tenant-registration/${tenantId}${effective ? "/effective" : ""}`,
        {
          method,
          headers: {
            "x-savia-bridge-key": key,
            "content-type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
      ),
    );
  } catch {
    throw new HTTPException(503, {
      message: "Registration service unavailable.",
    });
  }
  const result = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!response.ok)
    throw new HTTPException(response.status as 400 | 403 | 503, {
      message:
        typeof result?.error === "string"
          ? result.error
          : "Registration settings unavailable.",
    });
  return result;
}
export function registrationCaptchaOptions(
  base: CaptchaOptions,
  settings: { captchaMode: string; siteKey: string; secretKey?: string },
): CaptchaOptions {
  return {
    ...base,
    disableCaptcha: false,
    ...(settings.captchaMode === "tenant" && base.captchaProvider !== "altcha"
      ? { siteKey: settings.siteKey, secretKey: settings.secretKey }
      : {}),
  };
}
export function registrationReadiness(
  base: CaptchaOptions,
  settings: z.infer<typeof registrationSettingsSchema> & { secretKey?: string },
) {
  const captchaProvider =
    base.captchaProvider === "altcha"
      ? ("altcha" as const)
      : ("turnstile" as const);
  let captchaReady = false;
  try {
    captchaConfiguration(registrationCaptchaOptions(base, settings));
    captchaReady = !!base.rateLimiter;
  } catch {
    /* Fail closed on missing credentials. */
  }
  return {
    ...registrationSettingsSchema.parse(settings),
    captchaProvider,
    captchaReady,
    registrationReady:
      settings.allowEmailRegistration &&
      settings.emailReady &&
      captchaReady &&
      settings.passwordAllowed !== false,
  };
}
export async function deleteTenantRegistrationSettings(
  bridge: Bridge | undefined,
  key: string | undefined,
  tenantId: number,
) {
  await registrationBridge(bridge, key, tenantId, "DELETE");
}
export function registerTenantRegistrationSettingsRoutes(
  app: OpenAPIHono,
  db: D1Database,
  bridge?: Bridge,
  key?: string,
  options: CaptchaOptions = {},
) {
  const path = "/v1/tenants/{tenantId}/registration-settings";
  for (const method of ["get", "put", "delete"] as const) {
    app.openapi(
      createRoute({
        method,
        path,
        tags: ["Tenant Registration"],
        request: {
          params,
          ...(method === "put"
            ? {
                body: {
                  required: true,
                  content: { "application/json": { schema: inputSchema } },
                },
              }
            : {}),
        },
        responses: {
          200: {
            description: "Safe tenant registration settings and readiness",
            content: { "application/json": { schema: responseSchema } },
          },
        },
      }),
      async (c) => {
        const tenantId = c.req.valid("param").tenantId;
        await activeTenant(db, tenantId);
        const actor = actorFromContext(c);
        if (
          !actor.principal.isActive ||
          (!actor.globalRoles.includes("platform_admin") &&
            !actor.memberships.some(
              (m) =>
                m.isActive &&
                (m.tenantId ?? m.agencyId) === tenantId &&
                ["tenant_admin", "agency_admin"].includes(m.role),
            ))
        )
          throw new HTTPException(403, {
            message: "Tenant registration settings access denied.",
          });
        let effective = (await registrationBridge(
          bridge,
          key,
          tenantId,
          "GET",
          undefined,
          true,
        )) as z.infer<typeof registrationSettingsSchema> & {
          secretKey?: string;
        };
        if (method === "put") {
          const body = inputSchema.parse(await c.req.json());
          if (
            options.captchaProvider === "altcha" &&
            body.captchaMode !== "inherit"
          )
            throw new HTTPException(400, {
              message: "Docker uses server-managed ALTCHA credentials.",
            });
          const candidate = {
            ...effective,
            ...body,
            siteKey: body.siteKey ?? effective.siteKey,
            secretKey:
              body.secretKey === null
                ? ""
                : body.secretKey?.trim() || effective.secretKey,
          };
          const ready = registrationReadiness(options, candidate);
          if (
            body.allowEmailRegistration &&
            (!ready.emailReady || !ready.captchaReady)
          )
            throw new HTTPException(400, {
              message:
                "Configure email delivery and CAPTCHA before enabling registration.",
            });
          await registrationBridge(bridge, key, tenantId, "PUT", {
            ...body,
            captchaReady: ready.captchaReady,
          });
          effective = (await registrationBridge(
            bridge,
            key,
            tenantId,
            "GET",
            undefined,
            true,
          )) as typeof effective;
        } else if (method === "delete")
          effective = (await registrationBridge(
            bridge,
            key,
            tenantId,
            "DELETE",
          )) as typeof effective;
        c.header("Cache-Control", "no-store");
        return c.json(registrationReadiness(options, effective), 200);
      },
    );
  }
}
