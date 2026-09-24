import { dialectFor } from "@savia/db/dialect";
import { historyDatabase } from "@savia/studio-server/record-history-storage";
import {
  scopedRecordLinks,
  scopedRelationDefinitions,
} from "./scoped-record-links";
import { HTTPException } from "hono/http-exception";
import type { AccessPolicy } from "@savia/studio-shared/access-control";
import { accessDatabase } from "@savia/studio-server/access-authorization";
import { createStudioApp } from "@savia/studio-server/index";
import { ExtensionConnectionRepository } from "@savia/studio-server/extension-connections";
import { ExtensionSettingsRepository } from "@savia/studio-server/extension-settings";
import { isExtensionAvailable } from "@savia/studio-server/extensions";
import {
  disabledSolutionObjects,
  type SolutionOptions,
} from "@savia/studio-server/solutions";
import { solutionOptions } from "../solutions/catalog";
import type { StudioObject } from "@savia/studio-shared/metadata";
import type { ExtensionActionExecutor } from "@savia/studio-shared/extension-runtime";
import type { SaviaRequestService } from "@savia/studio-shared/savia-request-quotes";
import type { AppActor } from "../auth/types";
import type { CrmRouteDependencies } from "../routes/crm";
import {
  createHubspotWorkspaceApp,
  handlesHubspotWorkspace,
} from "../external-crm/hubspot-workspace";
import {
  createCollectionRelationsApp,
  handlesCollectionRelationsPath,
} from "./collection-relations";
import {
  createCollectionSourceApp,
  handlesCollectionSourceRequest,
} from "./collection-sources";
import { createRecordBundlesApp } from "./record-bundles";
import type { SqlBridgeClient } from "./sql-bridge";
import { canManageSharedCrm } from "../external-crm/hubspot-access";
import { createNotificationPolicy } from "../notifications";

export type CollectionGatewayContext = {
  db: D1Database;
  files: R2Bucket;
  tenant: string;
  publicApiBasePath?: string;
  actor: AppActor;
  accessPolicy?: AccessPolicy;
  integrationKey?: string;
  extensionConnectionsEncryptionKey?: string;
  crm?: CrmRouteDependencies;
  seedObjects: StudioObject[];
  /** Optional authenticated connector; local collections never require this service. */
  externalCollections?: { fetch(request: Request): Promise<Response> };
  /** Puente SQL para colecciones Postgres externas; sin él responden 503. */
  sqlBridge?: SqlBridgeClient;
  collectionFetch?: typeof fetch;
  actionExecutor?: ExtensionActionExecutor;
  saviaRequestService?: SaviaRequestService;
  beforeInstall?: SolutionOptions["beforeInstall"];
};

export function canManageTenantExtensions(
  actor: AppActor,
  tenant: string,
): boolean {
  if (actor.globalRoles.includes("platform_admin")) return true;
  const tenantId = Number(tenant.replace(/^agency:/, ""));
  if (!Number.isInteger(tenantId)) return false;
  return actor.memberships.some(
    (membership) =>
      membership.isActive &&
      (membership.tenantId ?? membership.agencyId) === tenantId &&
      ["agency_admin", "tenant_admin"].includes(membership.role),
  );
}

export function createCollectionGateway(context: CollectionGatewayContext) {
  const {
    db,
    files,
    tenant,
    actor,
    integrationKey,
    extensionConnectionsEncryptionKey,
    seedObjects,
  } = context;
  const isExtensionActive = (tenantId: string, extensionId: string) =>
    isExtensionAvailable(
      db,
      tenantId,
      extensionId,
      solutionOptions.extensionRegistry,
    );
  const connectionRepository = new ExtensionConnectionRepository(db, {
    encryptionKey: extensionConnectionsEncryptionKey,
    isExtensionActive,
  });
  const settingsRepository = new ExtensionSettingsRepository(db, {
    isExtensionActive,
  });
  const local = () =>
    createStudioApp(tenant, {
      principalId: actor.principal.id,
      apiBasePath: context.publicApiBasePath,
      entryGrantSecret: integrationKey,
      policy: createNotificationPolicy(db),
      integrationFetch: context.collectionFetch,
      authorizeWorkflow: async ({ workspace }) =>
        canManageSharedCrm(actor, workspace),
      accessPolicy: context.accessPolicy,
      seedObjects,
      ...solutionOptions,
      beforeInstall: context.beforeInstall,
      connectionRepository,
      settingsRepository,
      actionExecutor: context.actionExecutor,
      saviaRequestService: context.saviaRequestService,
      canManageExtension: ({ tenantId }) =>
        canManageTenantExtensions(actor, tenantId),
    });
  const gateway = {
    async prepare() {},
    async fetch(request: Request): Promise<Response> {
      const path = new URL(request.url).pathname;
      if (/^\/api\/record-bundles\/[^/]+\/?$/.test(path))
        return createRecordBundlesApp({
          db: historyDatabase(
            context.accessPolicy
              ? accessDatabase(db, context.accessPolicy)
              : db,
            tenant,
            { kind: "user", id: actor.principal.id },
          ),
          tenant,
        }).fetch(request);
      if (
        context.accessPolicy &&
        /^\/api\/record-links\/[^/]+\/[^/]+$/.test(path) &&
        request.method === "GET"
      )
        return scopedRecordLinks(
          request,
          accessDatabase(db, context.accessPolicy),
          tenant,
          context.accessPolicy,
        );
      if (
        context.accessPolicy &&
        path === "/api/collection-relations" &&
        request.method === "GET"
      )
        return scopedRelationDefinitions(
          accessDatabase(db, context.accessPolicy),
          tenant,
          context.accessPolicy,
        );
      if (context.accessPolicy) {
        const match =
          /^\/api\/(?:objects|records|views|record-detail|record-links|record-notes|record-activity|collection-options|files|import|export)\/([^/]+)/.exec(
            path,
          );
        if (match) {
          const row = await db
            .prepare(
              "SELECT config FROM studio_objects WHERE tenant_id=? AND name=?",
            )
            .bind(tenant, decodeURIComponent(match[1]))
            .first<{ config: string }>();
          const studio = row ? JSON.parse(row.config).studio : undefined;
          const binding = await db
            .prepare(
              "SELECT 1 FROM crm_collection_bindings WHERE tenant_id=? AND object_name=?",
            )
            .bind(tenant, decodeURIComponent(match[1]))
            .first();
          if (
            binding &&
            request.method === "GET" &&
            /^\/api\/(?:objects|records|views|record-detail|record-links|record-notes|record-activity)\//.test(
              path,
            )
          ) {
            const shared = await db
              .prepare(
                "SELECT 1 FROM crm_collection_bindings WHERE tenant_id=? AND object_name=? AND " +
                  dialectFor(db).jsonValue("config", "$.kind") +
                  "='crm' AND " +
                  dialectFor(db).jsonValue("config", "$.provider") +
                  "='hubspot' AND " +
                  dialectFor(db).jsonValue("config", "$.accessScope") +
                  "='tenant'",
              )
              .bind(tenant, decodeURIComponent(match[1]))
              .first();
            if (
              shared &&
              context.accessPolicy.grants.some(
                (g) =>
                  g.resource === `collection:${decodeURIComponent(match[1])}` &&
                  g.action === "read" &&
                  g.roleId.startsWith("builtin:"),
              )
            )
              return createCollectionGateway({
                ...context,
                accessPolicy: undefined,
              }).fetch(request);
          }
          if (binding || studio?.business || studio?.collection)
            return Response.json(
              { error: "This adapter does not support this access policy." },
              { status: 403 },
            );
        }
        return local().fetch(request, {
          DB: accessDatabase(db, context.accessPolicy),
          FILES: files,
          POC_LOCAL: "false",
          INTEGRATION_KEY: integrationKey,
        });
      }
      if (/^\/api\/record-bundles\/[^/]+\/?$/.test(path))
        return createRecordBundlesApp({
          db: historyDatabase(db, tenant, {
            kind: "user",
            id: actor.principal.id,
          }),
          tenant,
        }).fetch(request);
      if (path === "/api/collection-catalog" && context.externalCollections) {
        try {
          const response = await context.externalCollections.fetch(
            request.clone() as Request,
          );
          if (response.ok) return response;
        } catch {}
      }
      if (path === "/api/collection-bindings" && request.method === "POST") {
        const body: any = await request.clone().json();
        if (body.domain) {
          if (!context.externalCollections)
            return Response.json(
              { error: "Conecta el servicio de esta colección." },
              { status: 503 },
            );
          return context.externalCollections.fetch(request);
        }
      }
      const match =
        /^\/api\/(?:objects|records|views|record-detail|record-links|record-notes|record-activity|collection-options|collection-bindings|files|import|export)\/([^/]+)/.exec(
          path,
        );
      const disabled = await disabledSolutionObjects(db, tenant);
      if (match && disabled.has(decodeURIComponent(match[1])))
        return Response.json(
          { error: "El paquete está desactivado." },
          { status: 404 },
        );
      const row = match
        ? await db
            .prepare(
              "SELECT config FROM studio_objects WHERE tenant_id=? AND name=?",
            )
            .bind(tenant, decodeURIComponent(match[1]))
            .first<{ config: string }>()
        : null;
      const objectConfig = row ? JSON.parse(row.config) : undefined;
      const studio = objectConfig?.studio;
      const optionsPath = /^\/api\/collection-options\/[^/]+\/([^/]+)$/.exec(
        path,
      );
      const externalOptions =
        optionsPath &&
        objectConfig?.fields?.[decodeURIComponent(optionsPath[1])]?.config
          ?.collectionOptions;

      if (
        externalOptions ||
        studio?.collection?.kind === "domain" ||
        studio?.business ||
        path.startsWith("/api/business/")
      ) {
        if (!context.externalCollections)
          return Response.json(
            { error: "El servicio de esta colección no está disponible." },
            { status: 503 },
          );
        return context.externalCollections.fetch(request);
      }
      if (await handlesHubspotWorkspace(context, path))
        return createHubspotWorkspaceApp(context).fetch(request);
      if (handlesCollectionRelationsPath(path)) {
        return createCollectionRelationsApp({
          db,
          tenant,
          readRecord: async (object, id) => {
            const response = await gateway.fetch(
              new Request(
                "https://crm.internal/api/records/" +
                  encodeURIComponent(object) +
                  "/" +
                  encodeURIComponent(id),
              ),
            );
            if (!response.ok)
              throw new HTTPException(404, {
                message: "Registro relacionado no disponible.",
              });
            return (
              (await response.json()) as { data: Record<string, unknown> }
            ).data;
          },
        }).fetch(request);
      }
      if (await handlesCollectionSourceRequest(db, tenant, path))
        return createCollectionSourceApp(
          db,
          files,
          tenant,
          actor.principal.id,
          integrationKey,
          context.collectionFetch,
          undefined,
          context.sqlBridge,
        ).fetch(request);
      if (
        /^\/api\/objects(?:\/[^/]+(?:\/preview)?)?$/.test(path) &&
        ["POST", "PUT"].includes(request.method)
      ) {
        const body: any = await request.clone().json();
        const config = (path.endsWith("/preview") ? body.object : body)?.config
          ?.studio;
        if (
          (config?.business && !studio?.business) ||
          (config?.collection && !studio?.collection) ||
          (config?.capabilities && !studio?.collection)
        )
          return Response.json(
            { error: "Conecta las capacidades desde Fuentes y colecciones." },
            { status: 422 },
          );
        if (config?.capabilities) {
          delete config.capabilities;
          const headers = new Headers(request.headers);
          headers.delete("content-length");
          request = new Request(request.url, {
            method: request.method,
            headers,
            body: JSON.stringify(body),
          });
        }
      }
      return local().fetch(request, {
        DB: db,
        FILES: files,
        POC_LOCAL: "false",
        INTEGRATION_KEY: integrationKey,
      });
    },
  };
  return gateway;
}
