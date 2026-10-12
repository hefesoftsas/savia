import { jwtVerify } from "jose";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { createStudioApp } from "@savia/studio-server";
import { isNativeFlowsCall } from "@savia/studio-shared/native-flows";
import type { ExtensionRegistry } from "@savia/studio-shared/extension-package";
import type { WorkflowBundle } from "@savia/studio-shared/workflow-bundles";
import { canManageSharedCrm } from "../external-crm/hubspot-access";
import { findPrincipal, loadActor } from "../auth/identity-repository";
import { workflowAuthorizer } from "../workflows";

const PATH = "/api/public/savia-flows/native";
const TENANT = /^tenant:(0|[1-9]\d*)$/;

export type NativeHostOptions = {
  db: D1Database;
  secret?: string;
  files?: R2Bucket;
  integrationKey?: string;
  workflowBundles?: readonly WorkflowBundle[];
  extensionRegistry?: ExtensionRegistry;
};

function errorResponse(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

async function bodyDigest(value: string) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(hash)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}

async function activeTenantAccess(
  db: D1Database,
  principalId: string,
  tenant: string,
) {
  const tenantId = Number(tenant.slice("tenant:".length));
  if (!Number.isSafeInteger(tenantId)) return false;
  const principal = await findPrincipal(db, principalId);
  if (!principal?.isActive) return false;
  const scope = await db
    .prepare("SELECT id,kind FROM tenants WHERE id=? AND is_active=1")
    .bind(tenantId)
    .first<{ id: number; kind: string }>();
  if (
    !scope ||
    !(
      scope.kind === "commercial" ||
      (scope.kind === "platform" && tenantId === 0)
    )
  )
    return false;
  const actor = await loadActor(db, principal);
  const member = actor.memberships.some(
    (membership) =>
      membership.isActive &&
      (membership.tenantId ?? membership.agencyId) === tenantId,
  );
  const platformAdmin = actor.globalRoles.includes("platform_admin");
  if (!member && !platformAdmin) return false;
  return canManageSharedCrm(actor, tenant);
}

export function registerSaviaNativeHostRoutes(
  app: OpenAPIHono,
  options: NativeHostOptions,
) {
  app.use(PATH, bodyLimit({ maxSize: 96 * 1024 }));
  app.post(PATH, async (c) => {
    const secret = options.secret;
    if (!secret)
      return errorResponse(
        "NATIVE_HOST_UNAVAILABLE",
        "Native workflow host is unavailable.",
        503,
      );
    const authorization = c.req.header("authorization") ?? "";
    const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(authorization);
    if (!match)
      return errorResponse(
        "UNAUTHORIZED",
        "Native workflow authority is required.",
        401,
      );
    const raw = await c.req.text();
    let call: unknown;
    try {
      call = JSON.parse(raw);
    } catch {
      return errorResponse(
        "INVALID_CALL",
        "Native workflow call must be valid JSON.",
        400,
      );
    }
    if (!isNativeFlowsCall(call))
      return errorResponse(
        "INVALID_CALL",
        "Native workflow call is not allowed.",
        400,
      );

    let claims;
    try {
      claims = await jwtVerify(match[1]!, new TextEncoder().encode(secret), {
        issuer: "savia-flows",
        audience: "savia-flows-native-host",
        algorithms: ["HS256"],
        maxTokenAge: "10s",
      });
    } catch {
      return errorResponse(
        "UNAUTHORIZED",
        "Native workflow authority is invalid or expired.",
        401,
      );
    }
    const payload = claims.payload;
    if (
      typeof payload.sub !== "string" ||
      payload.sub.length < 1 ||
      payload.sub.length > 200 ||
      typeof payload.tenant !== "string" ||
      !TENANT.test(payload.tenant) ||
      !Number.isSafeInteger(Number(payload.tenant.slice(7))) ||
      !Number.isInteger(payload.iat) ||
      !Number.isInteger(payload.exp) ||
      payload.exp! <= payload.iat! ||
      payload.exp! - payload.iat! > 10 ||
      payload.bodyDigest !== (await bodyDigest(raw))
    )
      return errorResponse(
        "UNAUTHORIZED",
        "Native workflow authority does not match this call.",
        401,
      );

    const tenant = payload.tenant;
    if (!(await activeTenantAccess(options.db, payload.sub, tenant)))
      return errorResponse(
        "FORBIDDEN",
        "Current workflow permissions are required.",
        403,
      );

    if (call.path === "/inventory") {
      const counts = await Promise.all(
        [
          ["workflows", "workflows"],
          ["versions", "workflow_versions"],
          ["executions", "workflow_executions"],
          ["tasks", "workflow_tasks"],
          ["endpoints", "workflow_webhook_endpoints"],
        ].map(async ([key, table]) => {
          const row = await options.db
            .prepare(
              `SELECT COUNT(*) AS count FROM ${table} WHERE workspace_id=?`,
            )
            .bind(tenant)
            .first<{ count: number }>();
          return [key, Number(row?.count ?? 0)] as const;
        }),
      );
      return c.json({ data: Object.fromEntries(counts) });
    }

    const authorizeWorkflow = workflowAuthorizer(options.db);
    const studio = createStudioApp(tenant, {
      principalId: payload.sub,
      authorizeWorkflow,
      workflowBundles: options.workflowBundles,
      extensionRegistry: options.extensionRegistry,
    });
    const target = new URL(`/api${call.path}`, c.req.url);
    const headers = new Headers({
      accept: c.req.header("accept") ?? "application/json",
    });
    let body: string | undefined;
    if (call.body !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(call.body);
    }
    const response = await studio.request(
      new Request(target, { method: call.method, headers, body }),
      undefined,
      {
        DB: options.db,
        FILES: options.files,
        POC_LOCAL: "false",
        INTEGRATION_KEY: options.integrationKey,
      },
    );
    const result = new Response(response.body, response);
    if (
      /^\/workflows\/[^/]+\/webhook(?:\/rotate)?$/.test(call.path) ||
      /\/workflow-webhook-destinations\/[^/]+\/secret$/.test(call.path)
    )
      result.headers.set("Cache-Control", "no-store");
    return result;
  });
}
