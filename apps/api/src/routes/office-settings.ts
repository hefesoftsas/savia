import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { actorFromContext } from "../auth/middleware";
import {
  OfficeSettingsError,
  patchOfficeSettings,
  resolveCurrentOfficeSettings,
  resolveOfficeSettings,
} from "../office-settings/service";

const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
const settingsSchema = z.object({
  tenantId: z.number().int(),
  platformAllowed: z.boolean(),
  tenantEnabled: z.boolean(),
  enabled: z.boolean(),
  canManagePlatform: z.boolean(),
  canManageTenant: z.boolean(),
});
const patchSchema = z
  .object({
    platformAllowed: z.boolean().optional(),
    tenantEnabled: z.boolean().optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.platformAllowed !== undefined || input.tenantEnabled !== undefined,
    "At least one setting must be provided",
  );
const tenantParams = z.object({
  tenantId: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});
const jsonResponse = {
  200: {
    description: "Office suite settings",
    content: {
      "application/json": { schema: z.object({ data: settingsSchema }) },
    },
  },
  400: {
    description: "Invalid settings patch",
    content: { "application/json": { schema: errorSchema } },
  },
  403: {
    description: "Settings change is forbidden",
    content: { "application/json": { schema: errorSchema } },
  },
  404: {
    description: "Tenant is unavailable",
    content: { "application/json": { schema: errorSchema } },
  },
};
const currentRoute = createRoute({
  method: "get",
  path: "/v1/office-settings",
  tags: ["Office settings"],
  summary: "Get office settings for the active tenant",
  security: [{ oauth2: ["savia.api.read"] }],
  responses: jsonResponse,
});
const tenantGetRoute = createRoute({
  method: "get",
  path: "/v1/tenants/{tenantId}/office-settings",
  tags: ["Office settings"],
  summary: "Get office settings for a tenant",
  security: [{ oauth2: ["savia.api.read"] }],
  request: { params: tenantParams },
  responses: jsonResponse,
});
const tenantPatchRoute = createRoute({
  method: "patch",
  path: "/v1/tenants/{tenantId}/office-settings",
  tags: ["Office settings"],
  summary: "Update office settings for a tenant",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    params: tenantParams,
    body: {
      required: true,
      content: { "application/json": { schema: patchSchema } },
    },
  },
  responses: jsonResponse,
});

export function registerOfficeSettingsRoutes(app: OpenAPIHono, db: D1Database) {
  app.use("/v1/office-settings", async (c, next) => {
    await next();
    c.header("cache-control", "no-store");
  });
  app.use("/v1/tenants/*/office-settings", async (c, next) => {
    await next();
    c.header("cache-control", "no-store");
  });
  const run = async (operation: () => Promise<unknown>) => {
    try {
      return Response.json(
        { data: await operation() },
        { headers: { "cache-control": "no-store" } },
      );
    } catch (error) {
      if (error instanceof OfficeSettingsError)
        return Response.json(
          { error: { code: error.code, message: error.message } },
          { status: error.status, headers: { "cache-control": "no-store" } },
        );
      throw error;
    }
  };
  const register = (
    route: unknown,
    handler: (context: Context) => Promise<Response>,
  ) => app.openapi(route as never, handler as never);
  register(currentRoute, (c) =>
    run(() => resolveCurrentOfficeSettings(db, actorFromContext(c))),
  );
  register(tenantGetRoute, (c) =>
    run(() =>
      resolveOfficeSettings(
        db,
        Number(c.req.param("tenantId")),
        actorFromContext(c),
      ),
    ),
  );
  register(tenantPatchRoute, async (c) => {
    let patch: z.infer<typeof patchSchema>;
    try {
      patch = patchSchema.parse(await c.req.json());
    } catch {
      return Response.json(
        {
          error: {
            code: "INVALID_PATCH",
            message: "Provide at least one supported office setting",
          },
        },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    return run(() =>
      patchOfficeSettings(
        db,
        Number(c.req.param("tenantId")),
        actorFromContext(c),
        patch,
      ),
    );
  });
}
