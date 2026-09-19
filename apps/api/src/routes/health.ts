import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";

const healthResponseSchema = z.object({
  status: z.literal("ok"),
  database: z.literal("ok"),
});

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  security: [],
  responses: {
    200: {
      content: { "application/json": { schema: healthResponseSchema } },
      description: "Worker and D1 are available",
    },
  },
});

export function registerHealthRoute(app: OpenAPIHono, db: D1Database): void {
  app.openapi(healthRoute, async (context) => {
    await db.prepare("SELECT 1").first();
    return context.json({ status: "ok", database: "ok" }, 200);
  });
}
