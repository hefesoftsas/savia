import { dialectFor } from "@savia/db/dialect";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  actorFromContext,
  requirePlatformAdministrator,
} from "../auth/middleware";
import type { SaviaRequestService } from "../routes/savia-request";
import {
  requestPageSchema,
  requestOperations,
} from "@savia/studio-shared/request-page";
import {
  configSchema,
  validateRecord,
  type StudioObject,
} from "@savia/studio-shared/metadata";
import {
  normalizeResult,
  type FlowDescriptor,
  type RunResult,
} from "../request-results/normalize";
import { requestResultSchema } from "../request-results/contracts";
import type { ResultNormalizer } from "../request-results/normalize";
import { validateJsonSchema } from "@savia/studio-shared/json-schema";
const domainId = z
  .string()
  .regex(/^(?:[a-z][a-z0-9_-]{0,47}|tenant:[1-9][0-9]*)$/);
const pageName = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);
const formValues = z.record(
  z.string().max(48),
  z.union([z.string().max(100000), z.number().finite(), z.boolean(), z.null()]),
);
const runSchema = z.object({
  id: z.string(),
  domainId: z.string(),
  pageName: z.string(),
  actionId: z.string(),
  label: z.string(),
  mode: z.enum(["mock", "live"]),
  status: z.enum(["running", "complete", "failed"]),
  values: formValues,
  result: requestResultSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
});
const response = {
  description: "Ejecución guardada",
  content: { "application/json": { schema: runSchema } },
};
const errorResponse = {
  description: "Solicitud rechazada",
  content: {
    "application/json": {
      schema: z.object({
        error: z.object({ code: z.string(), message: z.string() }),
      }),
    },
  },
};
const executeRoute = createRoute({
  method: "post",
  path: "/v1/request-pages/runs",
  tags: ["Generated request pages"],
  summary: "Ejecutar una acción configurada en una página generada",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              id: z.string().uuid(),
              domainId,
              pageName,
              actionId: z.string().regex(/^[a-z0-9-]{1,80}$/),
              mode: z.enum(["mock", "live"]),
              values: formValues,
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    200: response,
    400: errorResponse,
    404: errorResponse,
    409: errorResponse,
    503: errorResponse,
  },
});
const listRoute = createRoute({
  method: "get",
  path: "/v1/request-pages/runs",
  tags: ["Generated request pages"],
  summary:
    "Recuperar las ejecuciones propias de una página sin llamar al proveedor",
  request: { query: z.object({ domainId, pageName }) },
  responses: {
    200: {
      description: "Historial",
      content: {
        "application/json": { schema: z.object({ data: z.array(runSchema) }) },
      },
    },
  },
});
type Row = {
  id: string;
  domain_id: string;
  page_name: string;
  action_id: string;
  action_label: string;
  mode: "mock" | "live";
  status: "running" | "complete" | "failed";
  form_values: string;
  result: string | null;
  error: string | null;
  created_at: string;
};
function publicRun(row: Row) {
  return {
    id: row.id,
    domainId: row.domain_id,
    pageName: row.page_name,
    actionId: row.action_id,
    label: row.action_label,
    mode: row.mode,
    status: row.status,
    values: JSON.parse(row.form_values),
    result: row.result ? JSON.parse(row.result) : null,
    error: row.error,
    createdAt: row.created_at,
  };
}
async function privateJson(
  service: SaviaRequestService,
  path: string,
  body?: unknown,
): Promise<any> {
  const response = await service.fetch(
    new Request("https://savia-request.internal" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    }),
  );
  if (!response.ok)
    throw new Error(
      "Savia request no pudo completar la operación. Revisa su configuración.",
    );
  return response.json();
}
export function registerRequestPageRoutes(
  app: OpenAPIHono,
  db: D1Database,
  service?: SaviaRequestService,
  normalizersForDomain: (
    domainId: string,
  ) => Promise<readonly ResultNormalizer[]> = async () => [],
) {
  app.use("/v1/request-pages/*", async (c, next) => {
    requirePlatformAdministrator(actorFromContext(c));
    c.header("cache-control", "no-store");
    await next();
  });
  app.get("/v1/request-pages/openapi.json", async (c) => {
    if (!service)
      return c.json(
        {
          error: {
            code: "UNAVAILABLE",
            message: "Savia request no está disponible.",
          },
        },
        503,
      );
    return c.json(await privateJson(service, "/api/openapi.json"));
  });
  app.openapi(listRoute, async (c) => {
    const query = c.req.valid("query");
    const rows = await db
      .prepare(
        "SELECT * FROM request_page_runs WHERE principal_id=? AND domain_id=? AND page_name=? ORDER BY created_at DESC LIMIT 100",
      )
      .bind(actorFromContext(c).principal.id, query.domainId, query.pageName)
      .all<Row>();
    return c.json({ data: rows.results.map(publicRun) }, 200);
  });
  app.openapi(executeRoute, async (c) => {
    const body = c.req.valid("json"),
      owner = actorFromContext(c).principal.id;
    const error = (message: string, status: 400 | 404 | 409 | 503 = 400) =>
      c.json({ error: { code: "REQUEST_PAGE_ERROR", message } }, status);
    const existing = await db
      .prepare("SELECT * FROM request_page_runs WHERE id=? AND principal_id=?")
      .bind(body.id, owner)
      .first<Row>();
    if (existing) {
      if (
        existing.domain_id !== body.domainId ||
        existing.page_name !== body.pageName ||
        existing.action_id !== body.actionId ||
        existing.mode !== body.mode ||
        existing.form_values !== JSON.stringify(body.values)
      )
        return error("Ese identificador corresponde a otra ejecución.", 409);
      return c.json(publicRun(existing), 200);
    }
    if (!service) return error("Savia request no está disponible.", 503);
    const tenant = body.domainId.startsWith("tenant:")
      ? body.domainId.replace("tenant:", "agency:")
      : "domain:" + body.domainId;
    const stored = await db
      .prepare(
        "SELECT name,label,description,config FROM crm_objects WHERE tenant_id=? AND name=?",
      )
      .bind(tenant, body.pageName)
      .first<{
        name: string;
        label: string;
        description: string;
        config: string;
      }>();
    if (!stored) return error("Página no encontrada.", 404);
    const object: StudioObject = {
      ...stored,
      config: configSchema.parse(
        JSON.parse(stored.config),
      ) as StudioObject["config"],
    };
    const config = requestPageSchema.parse(object.config.studio?.requestPage);
    const action = config.actions.find((a) => a.id === body.actionId);
    if (!action || object.config.studio?.screen?.hidden)
      return error("La acción no está disponible en esta página.", 404);
    const document = await privateJson(service, "/api/openapi.json");
    const catalog = requestOperations(document);
    const operation = catalog.find(
      (o) => o.id === action.id && o.operationId === action.operationId,
    );
    if (!operation)
      return error(
        "El request ya no está disponible. Actualiza la página.",
        409,
      );
    if (
      Object.keys(operation.input).some((key) => !action.input[key]) ||
      Object.keys(action.input).some(
        (key) => !Object.hasOwn(operation.input, key),
      )
    )
      return error(
        "Cambió el contrato del request. Vuelve a generar la página.",
        409,
      );
    if (action.kind === "submit") {
      const validation = validateRecord(object, body.values);
      if (Object.keys(validation.errors).length)
        return error(Object.values(validation.errors).join(" "));
    }
    const input: Record<string, string> = {};
    for (const [key, field] of Object.entries(action.input)) {
      if (!object.config.fields[field])
        return error("La acción referencia un campo que ya no existe.", 409);
      const value = String(body.values[field] ?? "").trim();
      if (
        !value &&
        (action.kind === "lookup" || object.config.fields[field].required)
      )
        return error("Completa " + object.config.fields[field].label + ".");
      input[key] =
        object.config.fields[field].config?.requestTransform === "uppercase"
          ? value.toUpperCase()
          : value;
    }
    for (const [key, value] of Object.entries(input)) {
      const schema = operation.input[key];
      let errors = validateJsonSchema(document, schema, value);
      if (schema.contentSchema) {
        try {
          errors = errors.concat(
            validateJsonSchema(
              document,
              schema.contentSchema,
              JSON.parse(value),
            ),
          );
        } catch {
          errors.push("JSON inválido");
        }
      }
      if (errors.length)
        return error(
          "Los datos no cumplen el contrato vigente de " +
            key +
            ": " +
            errors.join(" ") +
            ". Revisa el request o vuelve a generar la página.",
        );
    }
    const now = new Date().toISOString();
    const inserted = await db
      .prepare(
        dialectFor(db).name === "postgres"
          ? "INSERT INTO request_page_runs(id,principal_id,domain_id,page_name,action_id,action_label,mode,status,form_values,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'running',?,?,?) ON CONFLICT (id) DO NOTHING"
          : "INSERT OR IGNORE INTO request_page_runs(id,principal_id,domain_id,page_name,action_id,action_label,mode,status,form_values,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'running',?,?,?)",
      )
      .bind(
        body.id,
        owner,
        body.domainId,
        body.pageName,
        action.id,
        action.label,
        body.mode,
        JSON.stringify(body.values),
        now,
        now,
      )
      .run();
    if (!inserted.meta.changes) {
      const concurrent = await db
        .prepare(
          "SELECT * FROM request_page_runs WHERE id=? AND principal_id=?",
        )
        .bind(body.id, owner)
        .first<Row>();
      if (!concurrent)
        return error("Identificador de ejecución no disponible.", 409);
      if (
        concurrent.domain_id !== body.domainId ||
        concurrent.page_name !== body.pageName ||
        concurrent.action_id !== body.actionId ||
        concurrent.mode !== body.mode ||
        concurrent.form_values !== JSON.stringify(body.values)
      )
        return error("Ese identificador corresponde a otra ejecución.", 409);
      return c.json(publicRun(concurrent), 200);
    }
    try {
      const flow = (await privateJson(
        service,
        "/api/flows/" + action.id,
      )) as FlowDescriptor;
      const run = (await privateJson(
        service,
        "/api/flows/" + action.id + "/runs",
        { mode: body.mode, input },
      )) as RunResult;
      if (run.flowId !== action.id)
        throw new Error("El proveedor devolvió una ejecución inesperada.");
      const result = normalizeResult(
        flow,
        run,
        await normalizersForDomain(body.domainId),
      );
      const configurationError = (run as RunResult & { error?: string }).error;
      if (
        typeof configurationError === "string" &&
        /^Completa las variables: [a-zA-Z0-9_., -]+$/.test(configurationError)
      ) {
        result.errors = [
          {
            code: "REQUEST_CONFIGURATION_MISSING",
            message: configurationError + ". Configúralas en Savia request.",
            field: null,
          },
        ];
      }
      await db
        .prepare(
          "UPDATE request_page_runs SET status='complete',result=?,updated_at=? WHERE id=? AND principal_id=?",
        )
        .bind(JSON.stringify(result), new Date().toISOString(), body.id, owner)
        .run();
    } catch {
      await db
        .prepare(
          "UPDATE request_page_runs SET status='failed',error=?,updated_at=? WHERE id=? AND principal_id=?",
        )
        .bind(
          "No se pudo completar la ejecución. Consulta el historial antes de reintentar: el proveedor podría haber recibido la solicitud.",
          new Date().toISOString(),
          body.id,
          owner,
        )
        .run();
    }
    const saved = await db
      .prepare("SELECT * FROM request_page_runs WHERE id=? AND principal_id=?")
      .bind(body.id, owner)
      .first<Row>();
    return c.json(publicRun(saved!), 200);
  });
}
