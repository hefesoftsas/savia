import type { OpenAPIHono } from "@hono/zod-openapi";
import { actorFromContext } from "../auth/middleware";
import type { RealtimeHubClient } from "./hub-client";
import { publishRealtime } from "./hub-client";
import { PLATFORM_ROOM, principalRoom, tenantRoom } from "./protocol";

type Hint = {
  room: "platform" | "tenant" | "principal";
  topic:
    | "settings"
    | "studio"
    | "workflows"
    | "integrations"
    | "notifications"
    | "personal-integrations"
    | "account";
  collection?: string;
  tenantId?: number;
  principalId?: string;
  alsoTenantZero?: boolean;
  alsoAudit?: boolean;
};

function mutationType(method: string): "created" | "updated" | "deleted" {
  return method === "POST"
    ? "created"
    : method === "DELETE"
      ? "deleted"
      : "updated";
}

function tenantPathId(path: string): number | undefined {
  const match =
    /^\/v1\/tenants\/(\d+)\/branding(?:\/|$)/.exec(path) ??
    /^\/v1\/assistant\/configuration\/tenants\/(\d+)$/.exec(path);
  if (!match) return undefined;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

function studioRequest(
  path: string,
): { tenantId: number; apiPath: string } | undefined {
  const match =
    /^\/v1\/studio\/(\d+)\/api\/(.*)$/.exec(path) ??
    /^\/v1\/dynamic-crm\/(\d+)\/api\/(.*)$/.exec(path) ??
    /^\/v1\/tenants\/(\d+)\/crm\/api\/(.*)$/.exec(path);
  if (!match) return undefined;
  const tenantId = Number(match[1]);
  return Number.isSafeInteger(tenantId)
    ? { tenantId, apiPath: `/${match[2]}` }
    : undefined;
}

function classify(
  method: string,
  path: string,
  search = "",
  explicitTenantId?: number,
): Hint | undefined {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return undefined;
  if (path === "/v1/assistant/configuration/global")
    return {
      room: "tenant",
      tenantId: 0,
      topic: "settings",
      collection: "configuration",
    };
  const tenantId = tenantPathId(path);
  if (tenantId !== undefined)
    return {
      room: "tenant",
      tenantId,
      topic: "settings",
      collection: path.includes("/branding") ? "branding" : "configuration",
    };
  if (path.startsWith("/v1/personal-integrations/")) {
    if (/\/(?:connect-session|reconnect-session)(?:\/|$)/.test(path))
      return undefined;
    const collection = path.includes("/actions/")
      ? "runs"
      : path.includes("/events")
        ? "events"
        : "connections";
    return { room: "principal", topic: "personal-integrations", collection };
  }
  if (
    path.startsWith("/v1/user-preferences/") ||
    path.startsWith("/v1/account/avatar")
  )
    return { room: "principal", topic: "account", collection: "preferences" };
  if (path === "/v1/assistant/active-tenant")
    return { room: "principal", topic: "account", collection: "preferences" };
  const identityMatch = /^\/v1\/identity\/users\/([^/]+)(?:\/.*)?$/.exec(path);
  if (identityMatch)
    return {
      room: "principal",
      principalId: decodeURIComponent(identityMatch[1]),
      topic: "account",
      collection: "security",
    };

  if (/^\/v1\/savia-request\/(?:api|v1)\//.test(path)) {
    const tenant = new URLSearchParams(search).get("tenant") ?? "";
    const match = /^tenant:(0|[1-9]\d*)$/.exec(tenant);
    if (match)
      return {
        room: "tenant",
        tenantId: Number(match[1]),
        topic: "integrations",
        collection: "savia-request",
      };
  }
  if (
    /^\/v1\/crm\/connections(?:\/|$)/.test(path) &&
    !/(?:connect-session|reconnect-session)(?:\/|$)/.test(path) &&
    explicitTenantId
  )
    return {
      room: "tenant",
      tenantId: explicitTenantId,
      topic: "integrations",
      collection: "integrations",
      alsoTenantZero: true,
    };
  if (/^\/v1\/crm\/sync-rules(?:\/|$)/.test(path) && explicitTenantId)
    return {
      room: "tenant",
      tenantId: explicitTenantId,
      topic: "integrations",
      collection: "integrations",
      alsoTenantZero: true,
    };
  if (/^\/v1\/crm\/sync-jobs(?:\/|$)/.test(path) && explicitTenantId)
    return {
      room: "tenant",
      tenantId: explicitTenantId,
      topic: "integrations",
      collection: "runs",
      alsoTenantZero: true,
    };

  if (path.startsWith("/api/notifications/")) {
    if (path === "/api/notifications/settings")
      return { room: "tenant", topic: "settings", collection: "configuration" };
    if (path.startsWith("/api/notifications/admin/")) return undefined;
    if (path.startsWith("/api/notifications/follow"))
      return { room: "principal", topic: "notifications", collection: "follows" };
    return { room: "principal", topic: "notifications", collection: "inbox" };
  }

  const studio = studioRequest(path);
  if (!studio) return undefined;
  const { apiPath } = studio;
  const workflowCollection = apiPath.startsWith("/workflow-inbox")
    ? "inbox"
    : apiPath.startsWith("/workflow-executions")
      ? "executions"
      : apiPath.startsWith("/workflows") ||
          apiPath.startsWith("/workflow-bundles")
        ? "definitions"
        : undefined;
  if (workflowCollection)
    return {
      room: "tenant",
      tenantId: studio.tenantId,
      topic: "workflows",
      collection: workflowCollection,
    };
  if (/^\/extensions\/[^/]+\/settings(?:\/|$)/.test(apiPath))
    return {
      room: "tenant",
      tenantId: studio.tenantId,
      topic: "settings",
      collection: "configuration",
    };
  if (/^\/extensions\/[^/]+\/connections(?:\/|$)/.test(apiPath))
    return {
      room: "tenant",
      tenantId: studio.tenantId,
      topic: "integrations",
      collection: "integrations",
    };
  if (/^\/extensions\/[^/]+\/actions\/runs(?:\/|$)/.test(apiPath))
    return {
      room: "tenant",
      tenantId: studio.tenantId,
      topic: "integrations",
      collection: "runs",
    };
  if (/^\/extensions\/[^/]+\/actions\/[^/]+$/.test(apiPath))
    return {
      room: "tenant",
      tenantId: studio.tenantId,
      topic: "integrations",
      collection: "runs",
    };
  if (
    /^\/extensions\/[^/]+\/(?:install)?$/.test(apiPath) ||
    /^\/extensions\/[^/]+$/.test(apiPath)
  )
    return {
      room: "tenant",
      tenantId: studio.tenantId,
      topic: "studio",
      collection: "objects",
      alsoAudit: true,
    };
  if (/^\/plugin-store\/(?:upload|[^/]+)$/.test(apiPath))
    return {
      room: "tenant",
      tenantId: studio.tenantId,
      topic: "studio",
      collection: "objects",
      alsoAudit: true,
    };
  if (/^\/(objects|fields|relations|sources|views)(?:\/|$)/.test(apiPath)) {
    const collection = apiPath.split("/")[1];
    return {
      room: "tenant",
      tenantId: studio.tenantId,
      topic: "studio",
      collection,
      alsoAudit: true,
    };
  }
  if (/^\/audit(?:\/|$)/.test(apiPath))
    return {
      room: "tenant",
      tenantId: studio.tenantId,
      topic: "studio",
      collection: "audit",
    };
  if (/^\/(integrations|connections|crm)(?:\/|$)/.test(apiPath)) {
    return {
      room: "tenant",
      tenantId: studio.tenantId,
      topic: "integrations",
      collection:
        apiPath.includes("runs") || apiPath.includes("sync")
          ? "runs"
          : "integrations",
    };
  }
  return undefined;
}

/** Emit narrow invalidation hints after a matched route has durably succeeded. */
export function registerRealtimeMutationHints(
  app: OpenAPIHono,
  hub?: RealtimeHubClient,
  db?: D1Database,
): void {
  app.use("*", async (context, next) => {
    const url = new URL(context.req.url);
    let explicitTenantId: number | undefined = Number(
      url.searchParams.get("agencyId") ?? url.searchParams.get("tenantId"),
    );
    if (!Number.isSafeInteger(explicitTenantId) || explicitTenantId <= 0)
      explicitTenantId = undefined;
    if (
      db &&
      /^\/v1\/crm\/(?:connections|sync-rules)(?:\/|$)/.test(url.pathname) &&
      !explicitTenantId &&
      context.req.method !== "DELETE"
    ) {
      const body = (await context.req.raw
        .clone()
        .json()
        .catch(() => undefined)) as
        { agencyId?: unknown; tenantId?: unknown } | undefined;
      const candidate = Number(body?.agencyId ?? body?.tenantId);
      if (Number.isSafeInteger(candidate) && candidate > 0)
        explicitTenantId = candidate;
    }
    if (
      db &&
      /^\/v1\/crm\/(?:sync-rules|sync-jobs)\/([^/]+)/.test(url.pathname)
    ) {
      const match = /^\/v1\/crm\/(sync-rules|sync-jobs)\/([^/]+)/.exec(
        url.pathname,
      );
      if (match && !explicitTenantId) {
        try {
          const row =
            match[1] === "sync-rules"
              ? await db
                  .prepare("SELECT tenant_id FROM crm_sync_rules WHERE id=?")
                  .bind(match[2])
                  .first<{ tenant_id: number }>()
              : await db
                  .prepare(
                    "SELECT r.tenant_id FROM crm_sync_jobs j JOIN crm_sync_rules r ON r.id=j.rule_id WHERE j.id=?",
                  )
                  .bind(match[2])
                  .first<{ tenant_id: number }>();
          if (row) explicitTenantId = row.tenant_id;
        } catch {
          // Optional integration schema: mutations remain available without realtime.
        }
      }
    }
    let hint = classify(
      context.req.method,
      url.pathname,
      url.search,
      explicitTenantId,
    );
    if (
      !hint &&
      db &&
      /^\/api\/assistant\/employees(?:\/|$)/.test(url.pathname) &&
      ["POST", "PATCH", "DELETE"].includes(context.req.method)
    ) {
      try {
        const principalId = actorFromContext(context).principal.id;
        const active = await db
          .prepare(
            "SELECT tenant_id FROM assistant_active_tenants WHERE principal_id=?",
          )
          .bind(principalId)
          .first<{ tenant_id: number }>();
        hint = {
          room: "tenant",
          tenantId: active?.tenant_id ?? 0,
          topic: "settings",
          collection: "configuration",
        };
      } catch {
        // Optional legacy assistant schema: mutation routes retain their own behavior.
      }
    }
    if (!hint) return next();
    await next();
    if (context.res.status < 200 || context.res.status >= 300) return;
    try {
      const actor = actorFromContext(context);
      let room: string;
      if (hint.room === "platform") room = PLATFORM_ROOM;
      else if (hint.room === "principal")
        room = principalRoom(hint.principalId ?? actor.principal.id);
      else {
        let id = hint.tenantId;
        if (id === undefined) {
          const tenant = (
            context as unknown as { get(name: string): unknown }
          ).get("tenant");
          const match =
            typeof tenant === "string" ? /^tenant:(\d+)$/.exec(tenant) : null;
          if (match) id = Number(match[1]);
        }
        if (id === undefined || !Number.isSafeInteger(id)) return;
        room = tenantRoom(id);
      }
      publishRealtime(hub, room, {
        topic: hint.topic,
        type: mutationType(context.req.method),
        ...(hint.collection ? { collection: hint.collection } : {}),
        actor: actor.principal.id,
      });
      if (hint.alsoAudit)
        publishRealtime(hub, room, {
          topic: "studio",
          type: mutationType(context.req.method),
          collection: "audit",
          actor: actor.principal.id,
        });
      if (hint.alsoTenantZero && hint.tenantId !== 0)
        publishRealtime(hub, tenantRoom(0), {
          topic: hint.topic,
          type: mutationType(context.req.method),
          ...(hint.collection ? { collection: hint.collection } : {}),
          actor: actor.principal.id,
        });
    } catch {
      // A realtime hint is best-effort and cannot change a successful mutation.
    }
  });
}

export const classifyRealtimeMutation = classify;
