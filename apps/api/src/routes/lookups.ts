import type { OpenAPIHono } from "@hono/zod-openapi";
import { actorFromContext } from "../auth/middleware";
import type { SaviaRequestService } from "./savia-request";

export function registerLookupRoutes(
  app: OpenAPIHono,
  service?: SaviaRequestService,
) {
  app.get("/api/lookups/dane", async (c) => {
    actorFromContext(c);
    if (!service) {
      return c.json(
        {
          error: {
            code: "SAVIA_REQUEST_UNAVAILABLE",
            message: "Savia request no está disponible.",
          },
        },
        503,
      );
    }
    const source = new URL(c.req.url);
    const city = c.req.query("city") ?? "";
    const department = c.req.query("department");
    if (
      city.trim().length < 2 ||
      city.length > 100 ||
      (department?.length ?? 0) > 100
    ) {
      return c.json({ error: "Indica una ciudad válida." }, 400);
    }
    const response = await service.fetch(
      new Request(
        "https://savia-request.internal/api/lookups/dane" + source.search,
        {
          method: "GET",
          headers: { "content-type": "application/json" },
        },
      ),
    );
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    });
  });
}
