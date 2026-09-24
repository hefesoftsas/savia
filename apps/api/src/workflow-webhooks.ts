import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  acceptWorkflowWebhook,
  readWebhookJson,
  webhookHash,
} from "@savia/studio-server/workflows/webhook-endpoints";
import type { WorkflowAuthorization } from "@savia/studio-server/workflows/runtime";
import { workflowAuthorizer } from "./workflows";
export function registerWorkflowWebhookRoutes(
  app: OpenAPIHono,
  db: D1Database,
  options: {
    authorize?: WorkflowAuthorization;
    rateLimiter?: {
      limit(input: { key: string }): Promise<{ success: boolean }>;
    };
  } = {},
) {
  app.use("/api/public/workflow-webhooks/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (
      options.rateLimiter &&
      !(
        await options.rateLimiter.limit({
          key: `workflow:${await webhookHash(c.req.header("cf-connecting-ip") ?? "unknown")}`,
        })
      ).success
    )
      return c.json({ error: "Too many requests" }, 429);
    await next();
  });
  // Register schemas without an eager JSON validator: the handler bounds the raw stream first.
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      path: "/api/public/workflow-webhooks/{endpointId}",
      tags: ["Workflows"],
      summary: "Accept an authenticated webhook event",
      security: [],
      description:
        "Requires endpoint bearer secret and Idempotency-Key. JSON object, at most 32 KiB. Accepted means queued.",
      request: {
        body: {
          required: true,
          content: {
            "application/json": { schema: z.record(z.string(), z.unknown()) },
          },
        },
        params: z.object({ endpointId: z.string() }),
        headers: z.object({
          authorization: z.string(),
          "idempotency-key": z.string().min(1).max(150),
        }),
      },
      responses: {
        202: {
          description: "Durably accepted event",
          content: {
            "application/json": {
              schema: z.object({
                data: z.object({
                  executionId: z.string(),
                  duplicate: z.boolean(),
                }),
              }),
            },
          },
        },
        404: { description: "Invalid endpoint credentials" },
        409: { description: "Inactive workflow or conflicting event" },
        413: { description: "Body exceeds 32 KiB" },
        422: { description: "Invalid JSON or key" },
        429: { description: "Admission limit reached" },
      },
    }),
  );
  app.post("/api/public/workflow-webhooks/:endpointId", async (c) => {
    const authorization = c.req.header("authorization") ?? "";
    const secret = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    if (!secret || secret.length > 256)
      return c.json({ error: "Endpoint not found" }, 404);
    const data = await readWebhookJson(c.req.raw);
    const result = await acceptWorkflowWebhook(
      db,
      {
        endpointId: c.req.param("endpointId"),
        secret,
        key: c.req.header("idempotency-key") ?? "",
        data,
      },
      options.authorize ?? workflowAuthorizer(db),
    );
    return c.json({ data: result }, 202);
  });
}
