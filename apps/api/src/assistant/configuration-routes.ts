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

const activeAgencyWriteSchema = z.object({
  agencyId: z.number().int().positive(),
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

async function activeAgencySummary(
  database: D1Database,
  repository: AssistantConfigurationRepository,
  actor: AppActor,
) {
  const agencies = actor.globalRoles.includes("platform_admin")
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
  return {
    activeAgencyId: await repository.activeAgencyFor(actor.principal.id),
    agencies: agencies.results,
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

  app.put("/v1/assistant/configuration/agencies/:agencyId", async (context) => {
    const actor = requireConfigurationAdministrator(context);
    if (!repository) return unavailableResponse();
    const agencyId = Number(context.req.param("agencyId"));
    if (!Number.isInteger(agencyId) || agencyId <= 0) return invalidResponse();
    const parsed = await parseWrite(context);
    if (!parsed.success) return invalidResponse();
    try {
      await repository.saveAgencyOverride(agencyId, {
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

  app.delete(
    "/v1/assistant/configuration/agencies/:agencyId",
    async (context) => {
      requireConfigurationAdministrator(context);
      if (!repository) return unavailableResponse();
      const agencyId = Number(context.req.param("agencyId"));
      if (!Number.isInteger(agencyId) || agencyId <= 0)
        return invalidResponse();
      await repository.clearAgencyOverride(agencyId);
      return new Response(null, { status: 204 });
    },
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

  app.get("/v1/assistant/active-agency", async (context) => {
    const actor = actorFromContext(context);
    if (!repository) return unavailableResponse();
    return context.json(await activeAgencySummary(database, repository, actor));
  });

  app.put("/v1/assistant/active-agency", async (context) => {
    const actor = actorFromContext(context);
    if (!repository) return unavailableResponse();
    const body = await context.req.json().catch(() => undefined);
    const parsed = activeAgencyWriteSchema.safeParse(body);
    if (!parsed.success) return invalidResponse();
    try {
      await repository.setActiveAgency(
        actor.principal.id,
        parsed.data.agencyId,
        actor,
      );
      return context.json(
        await activeAgencySummary(database, repository, actor),
      );
    } catch (error) {
      const response = configurationFailureResponse(error);
      if (response) return response;
      throw error;
    }
  });
}
