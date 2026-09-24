import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { actorFromContext } from "../auth/middleware";
import {
  createSyncRule,
  deleteSyncRule,
  listSyncJobs,
  listSyncRules,
  retrySyncJob,
  setSyncRuleEnabled,
} from "../external-crm/auto-sync";

const rule = z.object({
  id: z.string(),
  tenantId: z.number(),
  tenantName: z.string(),
  provider: z.string(),
  accountLabel: z.string(),
  enabled: z.boolean(),
  connectionId: z.string(),
  createdAt: z.string(),
});
const job = z.object({
  id: z.string(),
  ruleId: z.string(),
  customerId: z.number(),
  provider: z.string(),
  status: z.string(),
  attempts: z.number(),
  lastError: z.string().nullable(),
  updatedAt: z.string(),
  externalUrl: z.string().nullable(),
});
const json = (schema: z.ZodType) => ({
  description: "Resultado",
  content: { "application/json": { schema } },
});
const tags = ["CRM synchronization"];

export function registerCrmAutomaticSyncRoutes(
  app: OpenAPIHono,
  db: D1Database,
): void {
  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/crm/sync-rules",
      tags,
      summary: "List my customer synchronization rules and authorized tenants",
      responses: {
        200: json(
          z.object({
            data: z.object({
              rules: z.array(rule),
              tenants: z.array(z.object({ id: z.number(), name: z.string() })),
            }),
          }),
        ),
      },
    }),
    async (context) => {
      context.header("cache-control", "no-store");
      return context.json({
        data: await listSyncRules(db, actorFromContext(context)),
      });
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/crm/sync-rules",
      tags,
      summary: "Enable automatic HubSpot customer synchronization",
      request: {
        body: {
          required: true,
          content: {
            "application/json": {
              schema: z
                .object({
                  tenantId: z.number().int().positive(),
                  provider: z.literal("hubspot"),
                })
                .strict(),
            },
          },
        },
      },
      responses: { 200: json(z.object({ data: rule })) },
    }),
    async (context) =>
      context.json({
        data: await createSyncRule(
          db,
          actorFromContext(context),
          context.req.valid("json"),
        ),
      }),
  );
  app.openapi(
    createRoute({
      method: "patch",
      path: "/v1/crm/sync-rules/{id}",
      tags,
      summary: "Enable or pause an automatic synchronization rule",
      request: {
        params: z.object({ id: z.string().max(100) }),
        body: {
          required: true,
          content: {
            "application/json": {
              schema: z.object({ enabled: z.boolean() }).strict(),
            },
          },
        },
      },
      responses: { 200: json(z.object({ data: rule })) },
    }),
    async (context) =>
      context.json({
        data: await setSyncRuleEnabled(
          db,
          actorFromContext(context),
          context.req.valid("param").id,
          context.req.valid("json").enabled,
        ),
      }),
  );
  app.openapi(
    createRoute({
      method: "delete",
      path: "/v1/crm/sync-rules/{id}",
      tags,
      summary: "Delete an automatic synchronization rule",
      request: { params: z.object({ id: z.string().max(100) }) },
      responses: { 204: { description: "Synchronization rule deleted" } },
    }),
    async (context) => {
      await deleteSyncRule(
        db,
        actorFromContext(context),
        context.req.valid("param").id,
      );
      return context.body(null, 204);
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/crm/sync-jobs",
      tags,
      summary: "Read recent automatic synchronization outcomes",
      request: {
        query: z.object({
          customerId: z.coerce.number().int().positive().optional(),
        }),
      },
      responses: { 200: json(z.object({ data: z.array(job) })) },
    }),
    async (context) => {
      context.header("cache-control", "no-store");
      return context.json({
        data: await listSyncJobs(
          db,
          actorFromContext(context),
          context.req.valid("query").customerId,
        ),
      });
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/crm/sync-jobs/{id}/retry",
      tags,
      summary: "Retry a known failed automatic synchronization",
      request: { params: z.object({ id: z.string().max(160) }) },
      responses: {
        200: json(z.object({ data: z.object({ queued: z.literal(true) }) })),
      },
    }),
    async (context) =>
      context.json({
        data: await retrySyncJob(
          db,
          actorFromContext(context),
          context.req.valid("param").id,
        ),
      }),
  );
}
