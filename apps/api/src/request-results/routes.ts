import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  actorFromContext,
  requirePlatformAdministrator,
} from "../auth/middleware";
import type { SaviaRequestService } from "../routes/savia-request";
import { requestResultSchema } from "./contracts";
import {
  normalizeResult,
  resultError,
  type FlowDescriptor,
  type RunResult,
  type ResultNormalizer,
} from "./normalize";

// Install before authentication so 401/403/validation errors use the same envelope.
export function installRequestResultEnvelope(app: OpenAPIHono) {
  app.use("/v1/request-results/*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
    if (c.res.status < 400) return;
    let body: any;
    try {
      body = await c.res.clone().json();
    } catch {}
    if (body?.schemaVersion === "1.0") return;
    const code =
      typeof body?.error?.code === "string"
        ? body.error.code
        : "REQUEST_FAILED";
    const message =
      typeof body?.error?.message === "string"
        ? body.error.message
        : "No se pudo completar la operación.";
    c.res = new Response(JSON.stringify(resultError(code, message)), {
      status: c.res.status,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    });
  });
}
const flowId = z.string().regex(/^[a-z0-9-]{1,80}$/);
const resultResponse = {
  description: "Resultado estándar; revisar status, errors y warnings.",
  content: { "application/json": { schema: requestResultSchema } },
};
const responses = {
  200: resultResponse,
  400: resultResponse,
  401: resultResponse,
  403: resultResponse,
  404: resultResponse,
  409: resultResponse,
  415: resultResponse,
  422: resultResponse,
  502: resultResponse,
  503: resultResponse,
};
const executeRoute = createRoute({
  method: "post",
  path: "/v1/request-results/flows/{flowId}/runs",
  tags: ["Request results"],
  summary: "Ejecutar un flow y devolver su resultado estándar",
  description:
    "Ejecuta una sola vez. mode=live contacta al proveedor y puede producir efectos externos; no hay reintentos automáticos. Sin versionId usa el borrador, con versionId ejecuta esa versión publicada. Conserva la respuesta original en Savia request. Solo administradores de plataforma.",
  security: [{ oauth2: ["savia.api.write"] }],
  request: {
    params: z.object({ flowId }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              mode: z.enum(["mock", "live"]),
              input: z.record(z.string(), z.string()),
              versionId: z.string().uuid().optional(),
            })
            .strict(),
        },
      },
    },
  },
  responses,
});
const readRoute = createRoute({
  method: "get",
  path: "/v1/request-results/flows/{flowId}/runs/{runId}",
  tags: ["Request results"],
  summary: "Normalizar una ejecución guardada sin contactar al proveedor",
  description:
    "Permite consumir o reprocesar resultados históricos por ID, incluso fuera de las últimas 20 ejecuciones. Solo administradores de plataforma.",
  security: [{ oauth2: ["savia.api.read"] }],
  request: { params: z.object({ flowId, runId: z.string().uuid() }) },
  responses,
});
class ServiceFailure extends Error {
  constructor(readonly status: number) {
    super("Private service failure");
  }
}
async function privateJson(
  service: SaviaRequestService,
  path: string,
  body?: unknown,
): Promise<any> {
  let response: Response;
  try {
    response = await service.fetch(
      new Request("https://savia-request.internal" + path, {
        method: body === undefined ? "GET" : "POST",
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
      }),
    );
  } catch {
    throw new ServiceFailure(503);
  }
  if (!response.ok)
    throw new ServiceFailure(
      [400, 404, 409, 422, 503].includes(response.status)
        ? response.status
        : 502,
    );
  try {
    return await response.json();
  } catch {
    throw new ServiceFailure(502);
  }
}
function failure(error: unknown) {
  const status = (error instanceof ServiceFailure ? error.status : 502) as
    400 | 404 | 409 | 422 | 502 | 503;
  return {
    body: resultError(
      status === 404 ? "RESULT_NOT_FOUND" : "RESULT_SERVICE_FAILED",
      status === 404
        ? "No se encontró el flow, versión o ejecución."
        : "No se pudo obtener el resultado. No se reintentó la operación.",
    ),
    status,
  };
}
export function registerRequestResultRoutes(
  app: OpenAPIHono,
  service?: SaviaRequestService,
  resolveNormalizers: () => Promise<
    readonly ResultNormalizer[]
  > = async () => [],
) {
  app.openapi(executeRoute, async (c) => {
    requirePlatformAdministrator(actorFromContext(c));
    if (!service)
      return c.json(
        resultError(
          "RESULT_SERVICE_UNAVAILABLE",
          "Savia request no está disponible.",
        ),
        503,
      );
    const { flowId } = c.req.valid("param");
    const body = c.req.valid("json");
    try {
      const flow = (await privateJson(
        service,
        "/api/flows/" +
          flowId +
          (body.versionId ? "/versions/" + body.versionId : ""),
      )) as FlowDescriptor;
      const run = (await privateJson(
        service,
        (body.versionId ? "/v1" : "/api") + "/flows/" + flowId + "/runs",
        body,
      )) as RunResult;
      if (run.flowId !== flowId) throw new ServiceFailure(502);
      const result = normalizeResult(flow, run, await resolveNormalizers());
      return c.json(result, result.status === "error" ? 502 : 200);
    } catch (error) {
      const failed = failure(error);
      return c.json(failed.body, failed.status);
    }
  });
  app.openapi(readRoute, async (c) => {
    requirePlatformAdministrator(actorFromContext(c));
    if (!service)
      return c.json(
        resultError(
          "RESULT_SERVICE_UNAVAILABLE",
          "Savia request no está disponible.",
        ),
        503,
      );
    const { flowId, runId } = c.req.valid("param");
    try {
      const saved = (await privateJson(
        service,
        "/api/flows/" + flowId + "/runs/" + runId,
      )) as { flow: FlowDescriptor; run: RunResult };
      if (
        saved.flow.id !== flowId ||
        saved.run.flowId !== flowId ||
        saved.run.id !== runId
      )
        throw new ServiceFailure(502);
      return c.json(
        normalizeResult(saved.flow, saved.run, await resolveNormalizers()),
        200,
      );
    } catch (error) {
      const failed = failure(error);
      return c.json(failed.body, failed.status);
    }
  });
}
