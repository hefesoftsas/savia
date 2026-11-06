import type { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import {
  actorFromContext,
  requirePlatformAdministrator,
} from "../auth/middleware";
import { AuthenticationError, type AppActor } from "../auth/types";
import {
  AssistantConfigurationRepository,
  AssistantConfigurationUnavailableError,
  openRouterModelCatalog,
  type AssistantModelCatalog,
} from "./configuration";

const transcriptionEndpointSchema = z
  .enum(["audio/transcriptions", "chat/completions"])
  .nullable();

const configurationWriteSchema = z
  .object({
    apiKey: z.string().trim().min(1).max(512).optional(),
    clearApiKey: z.boolean().optional(),
    model: z.string().trim().max(160).nullable().optional(),
    allowedModels: z
      .array(z.string().trim().min(1).max(160))
      .max(100)
      .nullable()
      .optional(),
    transcriptionModel: z.string().trim().max(160).nullable().optional(),
    transcriptionEndpoint: transcriptionEndpointSchema.optional(),
    summaryModel: z.string().trim().max(160).nullable().optional(),
    imageGenerationModel: z.string().trim().max(160).nullable().optional(),
    speechModel: z.string().trim().max(160).nullable().optional(),
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
      value.model === undefined &&
      value.allowedModels === undefined &&
      value.transcriptionModel === undefined &&
      value.transcriptionEndpoint === undefined &&
      value.summaryModel === undefined &&
      value.imageGenerationModel === undefined &&
      value.speechModel === undefined
    ) {
      context.addIssue({ code: "custom", message: "A change is required" });
    }
  });

const activeTenantWriteSchema = z
  .object({
    tenantId: z.number().int().positive().optional(),
  })
  .refine((data) => data.tenantId !== undefined, {
    message: "tenantId is required",
  });

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

function isPlatformAdministrator(actor: AppActor): boolean {
  return actor.globalRoles.includes("platform_admin");
}

async function configurationSummaryForActor(
  repository: AssistantConfigurationRepository,
  actor: AppActor,
) {
  return isPlatformAdministrator(actor)
    ? repository.summary()
    : repository.summaryForTenantAdministrator(actor.principal.id);
}

async function activeTenantSummary(
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
    tenants: tenants.results,
  };
}

export function registerAssistantConfigurationRoutes(
  app: OpenAPIHono,
  database: D1Database,
  repository?: AssistantConfigurationRepository,
  modelCatalog: AssistantModelCatalog = openRouterModelCatalog(),
): void {
  app.get("/v1/assistant/configuration", async (context) => {
    const actor = actorFromContext(context);
    if (!repository) return unavailableResponse();
    return context.json(await configurationSummaryForActor(repository, actor));
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
    const actor = actorFromContext(context);
    if (!repository) return unavailableResponse();
    const idParam = context.req.param("tenantId");
    const tenantId = Number(idParam);
    if (!Number.isInteger(tenantId) || tenantId <= 0) return invalidResponse();
    const parsed = await parseWrite(context);
    if (!parsed.success) return invalidResponse();
    try {
      if (!isPlatformAdministrator(actor)) {
        await repository.assertTenantAdministrator(
          actor.principal.id,
          tenantId,
        );
      }
      await repository.saveAgencyOverride(tenantId, {
        actorId: actor.principal.id,
        ...parsed.data,
      });
      return context.json(
        await configurationSummaryForActor(repository, actor),
      );
    } catch (error) {
      const response = configurationFailureResponse(error);
      if (response) return response;
      throw error;
    }
  };
  app.put(
    "/v1/assistant/configuration/tenants/:tenantId",
    handlePutTenantOverride,
  );

  const handleDeleteTenantOverride = async (context: Context) => {
    const actor = actorFromContext(context);
    if (!repository) return unavailableResponse();
    const idParam = context.req.param("tenantId");
    const tenantId = Number(idParam);
    if (!Number.isInteger(tenantId) || tenantId <= 0) return invalidResponse();
    if (!isPlatformAdministrator(actor)) {
      await repository.assertTenantAdministrator(actor.principal.id, tenantId);
    }
    await repository.clearAgencyOverride(tenantId);
    return new Response(null, { status: 204 });
  };
  app.delete(
    "/v1/assistant/configuration/tenants/:tenantId",
    handleDeleteTenantOverride,
  );

  app.get("/v1/assistant/models", async (context) => {
    const actor = actorFromContext(context);
    if (!repository) return unavailableResponse();
    try {
      const requestedTenant = context.req.query("tenantId");
      let configuration;
      if (requestedTenant !== undefined) {
        const tenantId = Number(requestedTenant);
        if (!Number.isInteger(tenantId) || tenantId <= 0)
          return invalidResponse();
        if (!isPlatformAdministrator(actor)) {
          await repository.assertTenantAdministrator(
            actor.principal.id,
            tenantId,
          );
        }
        configuration = isPlatformAdministrator(actor)
          ? await repository.effectiveConfigurationForPlatformTenant(tenantId)
          : await repository.effectiveConfigurationForTenant(
              actor.principal.id,
              tenantId,
            );
      } else if (isPlatformAdministrator(actor)) {
        configuration = await repository.effectiveGlobalConfiguration();
      } else {
        const manageableTenantIds = await repository.manageableTenantIds(
          actor.principal.id,
        );
        if (!manageableTenantIds.length) {
          throw new AuthenticationError(
            "AUTHORIZATION_FORBIDDEN",
            "An active tenant administrator membership is required",
          );
        }
        const activeTenant = await repository.activeTenantFor(
          actor.principal.id,
        );
        const tenantId =
          activeTenant && manageableTenantIds.includes(activeTenant)
            ? activeTenant
            : manageableTenantIds.length === 1
              ? manageableTenantIds[0]
              : undefined;
        if (!tenantId) return invalidResponse();
        configuration = await repository.effectiveConfigurationForTenant(
          actor.principal.id,
          tenantId,
        );
      }
      return context.json({ models: await modelCatalog.list(configuration) });
    } catch (error) {
      if (error instanceof AssistantConfigurationUnavailableError) {
        return unavailableResponse();
      }
      if (error instanceof AuthenticationError) throw error;
      return modelCatalogUnavailableResponse();
    }
  });

  app.get("/v1/assistant/model-policy", async (context) => {
    const actor = actorFromContext(context);
    if (!repository) return unavailableResponse();
    try {
      const activeTenantId = await repository.activeTenantFor(
        actor.principal.id,
      );
      if (activeTenantId === undefined && !isPlatformAdministrator(actor)) {
        throw new AuthenticationError(
          "AUTHORIZATION_FORBIDDEN",
          "An active tenant membership is required",
        );
      }
      const configuration = await repository.effectiveConfigurationFor(
        actor.principal.id,
      );
      const allowedModels = new Set(configuration.allowedModels ?? []);
      if (!allowedModels.size) {
        return context.json({
          defaultModel: configuration.model,
          allowedModels: [],
        });
      }
      const catalog = await modelCatalog.list(configuration, {
        includeGenerationPricing: false,
      });
      return context.json({
        defaultModel: configuration.model,
        allowedModels: catalog.filter(
          (model) =>
            allowedModels.has(model.id) && model.modalities?.text === true,
        ),
      });
    } catch (error) {
      if (error instanceof AssistantConfigurationUnavailableError) {
        return unavailableResponse();
      }
      if (error instanceof AuthenticationError) throw error;
      return modelCatalogUnavailableResponse();
    }
  });

  const handleGetActiveTenant = async (context: Context) => {
    const actor = actorFromContext(context);
    if (!repository) return unavailableResponse();
    return context.json(await activeTenantSummary(database, repository, actor));
  };
  app.get("/v1/assistant/active-tenant", handleGetActiveTenant);

  const handlePutActiveTenant = async (context: Context) => {
    const actor = actorFromContext(context);
    if (!repository) return unavailableResponse();
    const body = await context.req.json().catch(() => undefined);
    const parsed = activeTenantWriteSchema.safeParse(body);
    if (!parsed.success) return invalidResponse();
    const targetId = parsed.data.tenantId!;
    try {
      await repository.setActiveAgency(actor.principal.id, targetId, actor);
      return context.json(
        await activeTenantSummary(database, repository, actor),
      );
    } catch (error) {
      const response = configurationFailureResponse(error);
      if (response) return response;
      throw error;
    }
  };
  app.put("/v1/assistant/active-tenant", handlePutActiveTenant);
}
