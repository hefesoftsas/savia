import { streamingRequest } from "../lib/streaming-request";
import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  actorFromContext,
  requirePlatformAdministrator,
} from "../auth/middleware";

export type SaviaRequestService = {
  fetch(request: Request): Promise<Response> | Response;
};

export function registerSaviaRequestRoutes(
  app: OpenAPIHono,
  service?: SaviaRequestService,
) {
  app.all("/v1/savia-request/*", async (c) => {
    requirePlatformAdministrator(actorFromContext(c));
    if (!service)
      return c.json(
        {
          error: {
            code: "SAVIA_REQUEST_UNAVAILABLE",
            message: "Savia request no está disponible.",
          },
        },
        503,
      );
    const source = new URL(c.req.url);
    const path = source.pathname.slice("/v1/savia-request".length);
    if (!/^\/(api|v1)\//.test(path))
      return c.json(
        { error: { code: "NOT_FOUND", message: "Ruta no encontrada." } },
        404,
      );
    const method = c.req.method;
    if (
      !["GET", "HEAD"].includes(method) &&
      !c.req.header("content-type")?.startsWith("application/json")
    ) {
      return c.json(
        {
          error: {
            code: "UNSUPPORTED_MEDIA_TYPE",
            message: "Usa application/json.",
          },
        },
        415,
      );
    }
    // Forward only the request payload; auth cookies and OAuth tokens stay in Savia.
    const response = await service.fetch(
      streamingRequest(
        "https://savia-request.internal" + path + source.search,
        {
          method,
          headers: { "content-type": "application/json" },
          body: ["GET", "HEAD"].includes(method) ? undefined : c.req.raw.body,
          redirect: "manual",
        },
      ),
    );
    if (!response.ok) {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === "string")
        return new Response(
          JSON.stringify({
            error: { code: "SAVIA_REQUEST_ERROR", message: body.error },
          }),
          {
            status: response.status,
            headers: {
              "content-type": "application/json",
              "cache-control": "no-store",
            },
          },
        );
      return new Response(JSON.stringify(body), {
        status: response.status,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      });
    }
    const headers = new Headers({
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    return new Response(response.body, { status: response.status, headers });
  });
}
