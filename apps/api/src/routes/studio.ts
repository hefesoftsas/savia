import { dialectFor } from "@savia/db/dialect";
import { streamingRequest } from "../lib/streaming-request";
import { publishRecordBundleChanges } from "../studio/record-bundle-realtime";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { ExtensionActionExecutor } from "@savia/studio-shared/extension-runtime";
import type { SaviaRequestService } from "@savia/studio-shared/savia-request-quotes";
import { actorFromContext } from "../auth/middleware";
import { hasCustomAccess } from "../auth/access-context";
import { loadAccessPolicy } from "../auth/access-repository";
import { AuthenticationError } from "../auth/types";
import {
  canAccessSharedCrm,
  canManageSharedCrm,
} from "../external-crm/hubspot-access";
import { createCollectionGateway } from "../studio/collection-gateway";
import type { SqlBridgeClient } from "../studio/sql-bridge";
import { dynamicOpenApi } from "../studio/dynamic-openapi";
import { dynamicScalar } from "../studio/dynamic-scalar";
import type { CrmRouteDependencies } from "./crm";
import { genericSeed } from "./data-domains";
import type { SolutionOptions } from "@savia/studio-server/solutions";
import type { RealtimeHubClient } from "../realtime/hub-client";
import { publishRealtime } from "../realtime/hub-client";
import { tenantRoom } from "../realtime/protocol";

export async function resolveStudioTenantKey(
  db: D1Database,
  tenantId: number,
  preferredPrefix?: "tenant" | "agency",
): Promise<string> {
  const hasTenant = await db
    .prepare("SELECT 1 FROM studio_objects WHERE tenant_id=? LIMIT 1")
    .bind(`tenant:${tenantId}`)
    .first();
  if (hasTenant) return `tenant:${tenantId}`;

  const hasAgency = await db
    .prepare(
      "SELECT 1 FROM studio_objects WHERE tenant_id=? UNION ALL SELECT 1 FROM studio_solution_installations WHERE tenant_id=? LIMIT 1",
    )
    .bind(`agency:${tenantId}`, `agency:${tenantId}`)
    .first();
  if (hasAgency) return `agency:${tenantId}`;

  return preferredPrefix === "tenant"
    ? `tenant:${tenantId}`
    : `agency:${tenantId}`;
}

export function registerStudioRoutes(
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
  saviaRequestService?: SaviaRequestService,
  realtime?: RealtimeHubClient,
) {
  const handleStudioRequest = async (c: any) => {
    const actor = actorFromContext(c);
    const expectedPrincipal = c.req.header("X-Savia-Sync-Principal");
    if (
      expectedPrincipal !== undefined &&
      expectedPrincipal !== actor.principal.id
    )
      return c.json(
        {
          error: "The authenticated principal changed. Reopen this workspace.",
        },
        403,
      );
    const paramValue = c.req.param("tenantId") ?? c.req.param("agencyId");
    const tenantId = Number(paramValue);
    if (!Number.isSafeInteger(tenantId) || tenantId <= 0)
      return c.json(
        {
          error: {
            code: "INVALID_TENANT",
            message: "Selecciona un tenant válido.",
          },
        },
        400,
      );
    const url = new URL(c.req.url);
    const isTenantRoute = url.pathname.startsWith("/v1/tenants/");
    const tenantKey = await resolveStudioTenantKey(
      db,
      tenantId,
      isTenantRoute ? "tenant" : "agency",
    );
    const manager = canManageSharedCrm(actor, tenantKey);
    const accessPolicy =
      !manager &&
      (await hasCustomAccess(db, actor.principal.id, `tenant:${tenantId}`))
        ? await loadAccessPolicy(db, actor, `tenant:${tenantId}`)
        : undefined;
    let sharedNames: Set<string> | undefined;
    // Canonical prefix is /v1/studio; /v1/dynamic-crm stays as a legacy
    // alias and echoes back so old clients keep working.
    const routePrefix = isTenantRoute
      ? `/v1/tenants/${paramValue}/crm`
      : url.pathname.startsWith("/v1/studio/")
        ? `/v1/studio/${paramValue}`
        : `/v1/dynamic-crm/${paramValue}`;
    const requestedPath = url.pathname.slice(routePrefix.length);
    const readOnlyBootstrap =
      c.req.method === "POST" &&
      ["/api/bootstrap", "/api/business/setup"].includes(requestedPath);
    if (!manager && !accessPolicy) {
      if (
        !canAccessSharedCrm(actor, tenantKey) ||
        (c.req.method !== "GET" && !readOnlyBootstrap)
      )
        throw new AuthenticationError(
          "AUTHORIZATION_FORBIDDEN",
          "No tienes permiso para esta operación en el tenant.",
        );
      const rows = await db
        .prepare(
          "SELECT object_name FROM crm_collection_bindings WHERE tenant_id=? AND " +
            dialectFor(db).jsonValue("config", "$.kind") +
            "='crm' AND " +
            dialectFor(db).jsonValue("config", "$.provider") +
            "='hubspot' AND " +
            dialectFor(db).jsonValue("config", "$.accessScope") +
            "='tenant'",
        )
        .bind(tenantKey)
        .all<{ object_name: string }>();
      sharedNames = new Set(rows.results.map((row) => row.object_name));
      const path = requestedPath;
      const match =
        /^\/api\/(?:objects|records|record-detail|record-activity|record-notes|record-links|views)\/([^/]+)(?:\/|$)/.exec(
          path,
        );
      if (
        !sharedNames.size ||
        (!readOnlyBootstrap &&
          path !== "/api/objects" &&
          (!match || !sharedNames.has(decodeURIComponent(match[1]))))
      )
        throw new AuthenticationError(
          "AUTHORIZATION_FORBIDDEN",
          "Esta colección no está compartida con el tenant.",
        );
    }
    const tenant = await db
      .prepare(
        "SELECT t.id FROM tenants t WHERE t.id=? AND t.kind='commercial' AND t.is_active=1",
      )
      .bind(tenantId)
      .first<{ id: number; agency_id: number | null }>();
    if (!tenant)
      return c.json(
        {
          error: {
            code: "TENANT_NOT_FOUND",
            message: "El tenant no existe o está inactivo.",
          },
        },
        404,
      );
    if (!files)
      return c.json(
        {
          error: {
            code: "CRM_UNAVAILABLE",
            message: "El almacenamiento del CRM no está disponible.",
          },
        },
        503,
      );
    // Members use already-installed shared collections; bootstrapping must not mutate schema.
    if (!manager && readOnlyBootstrap) return c.json({ ok: true });
    let path = requestedPath;
    if (
      c.req.method === "GET" &&
      ["/api/openapi.json", "/api/docs"].includes(path)
    ) {
      if (accessPolicy)
        throw new AuthenticationError(
          "AUTHORIZATION_FORBIDDEN",
          "Collection documentation requires administration access.",
        );
      const document = await dynamicOpenApi(db, {
        tenant: tenantKey,
        apiBasePath: routePrefix,
      });
      c.header("cache-control", "no-store");
      if (path === "/api/openapi.json") return c.json(document);
      return dynamicScalar(c, document, routePrefix);
    }
    if (path.startsWith("/api/published/")) {
      const match =
        /^\/api\/published\/([a-z][a-z0-9_]{0,47})(?:\/([0-9a-f-]{36}))?$/.exec(
          path,
        );
      if (!match)
        return c.json(
          { error: { code: "CRM_NOT_FOUND", message: "Ruta no encontrada." } },
          404,
        );
      const allowed = match[2] ? ["GET", "PATCH", "DELETE"] : ["GET", "POST"];
      if (!allowed.includes(c.req.method))
        return c.json(
          {
            error: {
              code: "CRM_METHOD_NOT_ALLOWED",
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
      "x-savia-policy-revision",
    ]) {
      const value = c.req.header(name);
      if (value) headers.set(name, value);
    }
    const request = streamingRequest(
      "https://crm.internal" + path + url.search,
      {
        method: c.req.method,
        headers,
        body: ["GET", "HEAD"].includes(c.req.method)
          ? undefined
          : c.req.raw.body,
      },
    );
    const gateway = gatewayFactory({
      db,
      files,
      tenant: tenantKey,
      actor,
      accessPolicy,
      crm: dependencies,
      integrationKey,
      extensionConnectionsEncryptionKey,
      seedObjects: genericSeed,
      sqlBridge,
      externalCollections: externalService
        ? {
            fetch: async (request: Request) => {
              const target = new URL(request.url);
              target.pathname = routePrefix + target.pathname;
              const forwarded = new Headers(request.headers);
              for (const name of ["authorization", "cookie"]) {
                const value = c.req.header(name);
                if (value) forwarded.set(name, value);
              }
              return externalService.fetch(
                streamingRequest(target, {
                  method: request.method,
                  headers: forwarded,
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
      saviaRequestService,
    });
    await gateway.prepare();
    const syncMatch = /^\/api\/local-sync\/push\/([^/]+)$/.exec(path);
    const syncMutation =
      syncMatch && c.req.method === "POST"
        ? ((await request
            .clone()
            .json()
            .catch(() => undefined)) as
            { action?: string; id?: string } | undefined)
        : undefined;
    const response = await gateway.fetch(request);
    const bundleMatch = /^\/api\/record-bundles\/([^/]+)$/.exec(path);
    if (bundleMatch && c.req.method === "POST" && response.ok) {
      await publishRecordBundleChanges({
        db,
        tenant: tenantKey,
        room: tenantRoom(tenantId),
        actor: actor.principal.id,
        object: decodeURIComponent(bundleMatch[1]),
        response,
        hub: realtime,
      });
    }

    if (
      response.ok &&
      ["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)
    ) {
      const segments = path.split("/").filter(Boolean);
      if (
        segments[0] === "api" &&
        (((segments[1] === "records" || segments[1] === "views") &&
          segments[2]) ||
          syncMatch)
      ) {
        const collection = decodeURIComponent(syncMatch?.[1] ?? segments[2]);
        const recordId = syncMutation?.id ?? segments[3];
        const mutationType = syncMutation
          ? syncMutation.action === "create"
            ? "created"
            : syncMutation.action === "delete"
              ? "deleted"
              : "updated"
          : c.req.method === "POST"
            ? "created"
            : c.req.method === "DELETE"
              ? "deleted"
              : "updated";
        // Monotonic version for delta sync. Best-effort: a missing table
        // must never break the mutation it versions.
        let collectionVersion: number | undefined;
        try {
          const bumped = await db
            .prepare(
              `INSERT INTO studio_collection_versions(tenant_id, collection, version, updated_at)
               VALUES(?, ?, 1, ?)
               ON CONFLICT(tenant_id, collection) DO UPDATE SET version = version + 1, updated_at = excluded.updated_at
               RETURNING version`,
            )
            .bind(tenantKey, collection, new Date().toISOString())
            .first<{ version: number }>();
          collectionVersion = bumped?.version;
        } catch {
          collectionVersion = undefined;
        }
        publishRealtime(realtime, tenantRoom(tenantId), {
          topic: "records",
          type: mutationType,
          collection,
          ...(recordId ? { id: recordId } : {}),
          ...(collectionVersion !== undefined
            ? { version: collectionVersion }
            : {}),
          actor: actor.principal.id,
        });
      }
    }
    if (sharedNames && path === "/api/objects" && response.ok) {
      const body = (await response.json()) as { data: Array<{ name: string }> };
      return Response.json(
        {
          data: body.data.filter((object) => sharedNames!.has(object.name)),
          menuLayout: null,
        },
        { headers: { "cache-control": "no-store" } },
      );
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
      return Response.json(
        {
          error: {
            code: "CRM_ERROR",
            message:
              typeof body.error === "string"
                ? body.error
                : body.error &&
                    typeof body.error === "object" &&
                    "message" in body.error &&
                    typeof body.error.message === "string"
                  ? body.error.message
                  : "No se pudo completar la operación.",
          },
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
  };

  app.all("/v1/studio/:agencyId/api/*", handleStudioRequest);
  app.all("/v1/studio/:tenantId/api/*", handleStudioRequest);
  // Legacy alias (Fase 1): old agency workspaces keep working.
  app.all("/v1/dynamic-crm/:agencyId/api/*", handleStudioRequest);
  app.all("/v1/dynamic-crm/:tenantId/api/*", handleStudioRequest);
  app.all("/v1/tenants/:tenantId/crm/api/*", handleStudioRequest);
}
