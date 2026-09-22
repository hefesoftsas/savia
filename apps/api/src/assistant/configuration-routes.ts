import type { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import {
  actorFromContext,
  requirePlatformAdministrator,
} from "../auth/middleware";
import type { AppActor } from "../auth/types";
import {
  AssistantConfigurationRepository,
  AssistantConfigurationUnavailableError,
  openRouterModelCatalog,
  type AssistantModelCatalog,
} from "./configuration";

const configurationWriteSchema = z
  .object({
    apiKey: z.string().trim().min(1).max(512).optional(),
    clearApiKey: z.boolean().optional(),
    model: z.string().trim().max(160).nullable().optional(),
  })
  .superRefine((value, context) => {
    if (value.apiKey !== undefined && value.clearApiKey) {
      context.addIssue({
        code: "custom",
        message: "apiKey and clearApiKey cannot be used together",
      });
    }
    if (
      value.apiKey === undefined &&
      value.clearApiKey === undefined &&
      value.model === undefined
    ) {
      context.addIssue({ code: "custom", message: "A change is required" });
    }
  });

const activeTenantWriteSchema = z
  .object({
    agencyId: z.number().int().positive().optional(),
    tenantId: z.number().int().positive().optional(),
  })
  .refine(
    (data) => data.tenantId !== undefined || data.agencyId !== undefined,
    { message: "tenantId or agencyId is required" },
  );

const activeAgencyWriteSchema = activeTenantWriteSchema;

type AgencyRow = { id: number; name: string };

function unavailableResponse(): Response {
  return Response.json(
    {
      error: {
        code: "ASSISTANT_CONFIGURATION_UNAVAILABLE",
        message: "Assistant configuration is unavailable",
      },
    },
    { status: 503 },
  );
}

function invalidResponse(): Response {
  return Response.json(
    { error: { code: "VALIDATION_ERROR", message: "Invalid request" } },
    { status: 400 },
  );
}

function modelCatalogUnavailableResponse(): Response {
  return Response.json(
    {
      error: {
        code: "ASSISTANT_MODEL_CATALOG_UNAVAILABLE",
        message: "The model catalog is unavailable",
      },
    },
    { status: 502 },
  );
}

function configurationFailureResponse(error: unknown): Response | undefined {
  if (error instanceof AssistantConfigurationUnavailableError) {
    return unavailableResponse();
  }
  if (error instanceof TypeError) return invalidResponse();
  return undefined;
}

async function parseWrite(context: Context) {
  const body = await context.req.json().catch(() => undefined);
  return configurationWriteSchema.safeParse(body);
}

function requireConfigurationAdministrator(context: Context): AppActor {
  const actor = actorFromContext(context);
  requirePlatformAdministrator(actor);
  return actor;
}

async function activeAgencySummary(
  database: D1Database,
  repository: AssistantConfigurationRepository,
  actor: AppActor,
) {
  const tenants = actor.globalRoles.includes("platform_admin")
    ? await database
        .prepare(
          "SELECT id, name FROM tenants WHERE kind='commercial' AND is_active = 1 ORDER BY name",
        )
        .all<AgencyRow>()
    : await database
        .prepare(
          `SELECT tenants.id, tenants.name
           FROM tenants
           INNER JOIN identity_tenant_membership AS membership
             ON membership.tenant_id = tenants.id
           WHERE tenants.kind='commercial' AND membership.principal_id = ?
             AND membership.is_active = 1
             AND tenants.is_active = 1
           ORDER BY tenants.name`,
        )
        .bind(actor.principal.id)
        .all<AgencyRow>();
  const activeId = await repository.activeAgencyFor(actor.principal.id);
  return {
    activeTenantId: activeId,
    activeAgencyId: activeId,
    tenants: tenants.results,
    agencies: tenants.results,
  };
}

export function registerAssistantConfigurationRoutes(
  app: OpenAPIHono,
  database: D1Database,
  repository?: AssistantConfigurationRepository,
  modelCatalog: AssistantModelCatalog = openRouterModelCatalog(),
): void {
  app.get("/v1/assistant/configuration", async (context) => {
    requireConfigurationAdministrator(context);
    if (!repository) return unavailableResponse();
    return context.json(await repository.summary());
  });

  app.put("/v1/assistant/configuration/global", async (context) => {
    const actor = requireConfigurationAdministrator(context);
    if (!repository) return unavailableResponse();
    const parsed = await parseWrite(context);
    if (!parsed.success) return invalidResponse();
    try {
      await repository.saveGlobal({
        actorId: actor.principal.id,
        ...parsed.data,
      });
      return context.json(await repository.summary());
    } catch (error) {
      const response = configurationFailureResponse(error);
      if (response) return response;
      throw error;
    }
  });

  const handlePutTenantOverride = async (context: Context) => {
    const actor = requireConfigurationAdministrator(context);
    if (!repository) return unavailableResponse();
    const idParam =
      context.req.param("tenantId") ?? context.req.param("agencyId");
    const tenantId = Number(idParam);
    if (!Number.isInteger(tenantId) || tenantId <= 0) return invalidResponse();
    const parsed = await parseWrite(context);
    if (!parsed.success) return invalidResponse();
    try {
      await repository.saveAgencyOverride(tenantId, {
        actorId: actor.principal.id,
        ...parsed.data,
      });
      return context.json(await repository.summary());
    } catch (error) {
      const response = configurationFailureResponse(error);
      if (response) return response;
      throw error;
    }
  };
  app.put(
    "/v1/assistant/configuration/agencies/:agencyId",
    handlePutTenantOverride,
  );
  app.put(
    "/v1/assistant/configuration/tenants/:tenantId",
    handlePutTenantOverride,
  );

  const handleDeleteTenantOverride = async (context: Context) => {
    requireConfigurationAdministrator(context);
    if (!repository) return unavailableResponse();
    const idParam =
      context.req.param("tenantId") ?? context.req.param("agencyId");
    const tenantId = Number(idParam);
    if (!Number.isInteger(tenantId) || tenantId <= 0) return invalidResponse();
    await repository.clearAgencyOverride(tenantId);
    return new Response(null, { status: 204 });
  };
  app.delete(
    "/v1/assistant/configuration/agencies/:agencyId",
    handleDeleteTenantOverride,
  );
  app.delete(
    "/v1/assistant/configuration/tenants/:tenantId",
    handleDeleteTenantOverride,
  );

  app.get("/v1/assistant/models", async (context) => {
    const actor = requireConfigurationAdministrator(context);
    if (!repository) return unavailableResponse();
    try {
      const configuration = await repository.effectiveConfigurationFor(
        actor.principal.id,
      );
      return context.json({ models: await modelCatalog.list(configuration) });
    } catch (error) {
      if (error instanceof AssistantConfigurationUnavailableError) {
        return unavailableResponse();
      }
      return modelCatalogUnavailableResponse();
    }
  });

  const handleGetActiveTenant = async (context: Context) => {
    const actor = actorFromContext(context);
    if (!repository) return unavailableResponse();
    return context.json(await activeAgencySummary(database, repository, actor));
  };
  app.get("/v1/assistant/active-agency", handleGetActiveTenant);
  app.get("/v1/assistant/active-tenant", handleGetActiveTenant);

  const handlePutActiveTenant = async (context: Context) => {
    const actor = actorFromContext(context);
    if (!repository) return unavailableResponse();
    const body = await context.req.json().catch(() => undefined);
    const parsed = activeTenantWriteSchema.safeParse(body);
    if (!parsed.success) return invalidResponse();
    const targetId = parsed.data.tenantId ?? parsed.data.agencyId!;
    try {
      await repository.setActiveAgency(actor.principal.id, targetId, actor);
      return context.json(
        await activeAgencySummary(database, repository, actor),
      );
    } catch (error) {
      const response = configurationFailureResponse(error);
      if (response) return response;
      throw error;
    }
  };
  app.put("/v1/assistant/active-agency", handlePutActiveTenant);
  app.put("/v1/assistant/active-tenant", handlePutActiveTenant);
}
