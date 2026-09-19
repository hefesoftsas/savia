import type { RealtimeHubClient } from "../realtime/hub-client";
import { PLATFORM_ROOM } from "../realtime/protocol";
import { publishRecordBundleChanges } from "../crm/record-bundle-realtime";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  actorFromContext,
  requirePlatformAdministrator,
} from "../auth/middleware";
import { AuthenticationError } from "../auth/types";
import { createCollectionGateway } from "../crm/collection-gateway";
import type { SqlBridgeClient } from "../crm/sql-bridge";
import { dynamicOpenApi } from "../crm/dynamic-openapi";
import { dynamicScalar } from "../crm/dynamic-scalar";
import type { CrmObject } from "@savia/crm-shared/metadata";
import type { ExtensionActionExecutor } from "@savia/crm-shared/extension-runtime";
import type { CrmRouteDependencies } from "./crm";
import type { SolutionOptions } from "@savia/crm-server/solutions";

const domainSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["platform", "custom", "agency", "tenant"]),
  agencyId: z.number().optional(),
  tenantId: z.number().optional(),
  apiBasePath: z.string(),
});
const inputSchema = z
  .object({
    name: z
      .string()
      .regex(/^[a-z][a-z0-9_-]{0,47}$/)
      .refine((value) => value !== "platform", "Identificador reservado"),
    label: z.string().trim().min(1).max(100),
  })
  .strict();
const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
const errorResponse = {
  description: "Solicitud rechazada",
  content: { "application/json": { schema: errorSchema } },
};
const errors = {
  400: errorResponse,
  403: errorResponse,
  409: errorResponse,
  422: errorResponse,
};
const listRoute = createRoute({
  method: "get",
  path: "/v1/data-domains",
  tags: ["Data domains"],
  summary: "List authorized data domains",
  responses: {
    200: {
      description: "Domains",
      content: {
        "application/json": {
          schema: z.object({ data: z.array(domainSchema) }),
        },
      },
    },
    ...errors,
  },
});
const createRouteDefinition = createRoute({
  method: "post",
  path: "/v1/data-domains",
  tags: ["Data domains"],
  summary: "Create an independent data domain",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: inputSchema } },
    },
  },
  responses: {
    201: {
      description: "Created",
      content: {
        "application/json": { schema: z.object({ data: domainSchema }) },
      },
    },
    ...errors,
  },
});
const customDomain = (id: string, label: string) => ({
  id,
  label,
  kind: "custom" as const,
  apiBasePath: `/v1/data-domains/${id}`,
});
export const genericSeed: CrmObject[] = [];

export function registerDataDomainRoutes(
  app: OpenAPIHono,
  db: D1Database,
  files?: R2Bucket,
  integrationKey?: string,
  dependencies?: CrmRouteDependencies,
  externalService?: { fetch(request: Request): Promise<Response> },
  gatewayFactory = createCollectionGateway,
  sqlBridge?: SqlBridgeClient,
  actionExecutor?: ExtensionActionExecutor,
  extensionConnectionsEncryptionKey?: string,
  beforeInstall?: SolutionOptions["beforeInstall"],
  realtime?: RealtimeHubClient,
) {
  app.openapi(listRoute, async (c) => {
    const actor = actorFromContext(c),
      platform = actor.globalRoles.includes("platform_admin");
    const allowed = actor.memberships
      .filter((m) => m.isActive)
      .map((m) => m.tenantId ?? m.agencyId);
    if (!platform && !allowed.length)
      throw new AuthenticationError(
        "AUTHORIZATION_FORBIDDEN",
        "No tienes dominios de datos para administrar.",
      );
    const data: z.infer<typeof domainSchema>[] = [];
    if (platform) {
      data.push({
        id: "platform",
        label: "Plataforma",
        kind: "platform",
        apiBasePath: "/v1/data-domains/platform",
      });
      const domains = await db
        .prepare("SELECT id,label FROM crm_data_domains ORDER BY created_at,id")
        .all<{ id: string; label: string }>();
      data.push(...domains.results.map((d) => customDomain(d.id, d.label)));
    }
    const agencies = await db
      .prepare(
        `SELECT t.id,t.name FROM tenants t WHERE t.kind='commercial' AND t.is_active=1${platform ? "" : ` AND t.id IN (${allowed.map(() => "?").join(",")})`} ORDER BY t.name,t.id`,
      )
      .bind(...(platform ? [] : allowed))
      .all<{ id: number; name: string; agency_id: number | null }>();
    data.push(
      ...agencies.results.map((a) => ({
        id: `tenant:${a.id}`,
        label: a.name,
        tenantId: a.id,
        kind: "tenant" as const,
        apiBasePath: `/v1/dynamic-crm/${a.id}`,
      })),
    );
    c.header("cache-control", "no-store");
    return c.json({ data }, 200);
  });
  app.openapi(createRouteDefinition, async (c) => {
    const actor = actorFromContext(c);
    requirePlatformAdministrator(actor);
    const input = c.req.valid("json");
    const result = await db
      .prepare(
        "INSERT OR IGNORE INTO crm_data_domains(id,label,created_by) VALUES (?,?,?)",
      )
      .bind(input.name, input.label, actor.principal.id)
      .run();
    if (!result.meta.changes)
      return c.json(
        {
          error: {
            code: "DOMAIN_EXISTS",
            message: "Ya existe un dominio con ese identificador.",
          },
        },
        409,
      );
    c.header("cache-control", "no-store");
    return c.json({ data: customDomain(input.name, input.label) }, 201);
  });
  app.all("/v1/data-domains/:domainId/api/*", async (c) => {
    requirePlatformAdministrator(actorFromContext(c));
    const id = c.req.param("domainId");
    if (!/^[a-z][a-z0-9_-]{0,47}$/.test(id))
      return c.json(
        { error: { code: "INVALID_DOMAIN", message: "Dominio inválido." } },
        400,
      );
    if (
      id !== "platform" &&
      !(await db
        .prepare("SELECT 1 FROM crm_data_domains WHERE id=?")
        .bind(id)
        .first())
    )
      return c.json(
        {
          error: { code: "DOMAIN_NOT_FOUND", message: "El dominio no existe." },
        },
        404,
      );
    if (!files)
      return c.json(
        {
          error: {
            code: "CRM_UNAVAILABLE",
            message: "Almacenamiento no disponible.",
          },
        },
        503,
      );
    const base = `/v1/data-domains/${id}`,
      tenant = `domain:${id}`,
      url = new URL(c.req.url);
    let path = url.pathname.slice(base.length);
    const gateway = gatewayFactory({
      db,
      files,
      tenant,
      actor: actorFromContext(c),
      integrationKey,
      extensionConnectionsEncryptionKey,
      crm: dependencies,
      seedObjects: genericSeed,
      sqlBridge,
      externalCollections: externalService
        ? {
            fetch: async (request: Request) => {
              const target = new URL(request.url);
              target.pathname = base + target.pathname;
              const headers = new Headers(request.headers);
              for (const name of ["authorization", "cookie"]) {
                const value = c.req.header(name);
                if (value) headers.set(name, value);
              }
              return externalService.fetch(
                new Request(target, {
                  method: request.method,
                  headers,
                  body: ["GET", "HEAD"].includes(request.method)
                    ? undefined
                    : request.body,
                }),
              );
            },
          }
        : undefined,
      actionExecutor,
      beforeInstall,
    });
    await gateway.prepare();
    if (
      c.req.method === "GET" &&
      ["/api/openapi.json", "/api/docs"].includes(path)
    ) {
      const document = await dynamicOpenApi(db, { tenant, apiBasePath: base });
      c.header("cache-control", "no-store");
      return path === "/api/openapi.json"
        ? c.json(document)
        : dynamicScalar(c, document, base);
    }
    if (path.startsWith("/api/published/")) {
      const match =
        /^\/api\/published\/([a-z][a-z0-9_]{0,47})(?:\/([^/]{1,256}))?$/.exec(
          path,
        );
      if (!match)
        return c.json(
          { error: { code: "NOT_FOUND", message: "Ruta no encontrada." } },
          404,
        );
      if (
        !(match[2] ? ["GET", "PATCH", "DELETE"] : ["GET", "POST"]).includes(
          c.req.method,
        )
      )
        return c.json(
          {
            error: {
              code: "METHOD_NOT_ALLOWED",
              message: "Método no permitido.",
            },
          },
          405,
        );
      path = `/api/records/${match[1]}${match[2] ? "/" + match[2] : ""}`;
    }
    const headers = new Headers();
    for (const name of [
      "content-type",
      "idempotency-key",
      "x-savia-sync-principal",
    ]) {
      const value = c.req.header(name);
      if (value) headers.set(name, value);
    }
    const request = new Request("https://crm.internal" + path + url.search, {
      method: c.req.method,
      headers,
      body: ["GET", "HEAD"].includes(c.req.method) ? undefined : c.req.raw.body,
    });
    const response = await gateway.fetch(request);
    const bundleMatch = /^\/api\/record-bundles\/([^/]+)$/.exec(path);
    if (bundleMatch && c.req.method === "POST" && response.ok) {
      await publishRecordBundleChanges({
        db,
        tenant: tenant,
        room: PLATFORM_ROOM,
        actor: actorFromContext(c).principal.id,
        object: decodeURIComponent(bundleMatch[1]),
        response,
        hub: realtime,
      });
    }

    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("cache-control", "no-store");
    if (
      !response.ok &&
      responseHeaders.get("content-type")?.includes("application/json")
    ) {
      const body = (await response.json()) as {
        error?: unknown;
        data?: unknown;
        master?: unknown;
      };
      const message =
        typeof body.error === "string"
          ? body.error
          : body.error &&
              typeof body.error === "object" &&
              "message" in body.error
            ? String(body.error.message)
            : "No se pudo completar la operación.";
      return Response.json(
        {
          error: { code: "CRM_ERROR", message },
          ...(path.startsWith("/api/local-sync/") && response.status === 409
            ? { data: body.data ?? null, master: body.master ?? null }
            : {}),
        },
        { status: response.status, headers: responseHeaders },
      );
    }
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  });
}
