import { SignJWT, jwtVerify } from "jose";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { actorFromContext } from "../auth/middleware";
import type { AppActor, AgencyMembership } from "../auth/types";
import { streamingRequest } from "../lib/streaming-request";

export type SaviaFlowsService = {
  fetch(request: Request): Promise<Response> | Response;
};

export type SaviaFlowsOptions = {
  service?: SaviaFlowsService;
  bridgeSecret?: string;
};

const TENANT_PATTERN = /^tenant:(0|[1-9]\d*)$/;
const FLOW_ROLE = new Set(["agency_admin", "tenant_admin", "owner", "admin"]);
const API_PREFIX = "/v1/savia-flows";
const INTERNAL_ORIGIN = "https://savia-flows.internal";
const HTTP_ISSUER = "savia";
const HTTP_AUDIENCE = "savia-flows";
const WS_AUDIENCE = "savia-flows-websocket";
const WS_TICKET_TTL_SECONDS = 30;
const MAX_BRIDGE_TTL_SECONDS = 60;
const SAFE_ORG_MODULES = new Set([
  "dashboard",
  "databases",
  "datasets",
  "bots",
  "emails",
  "feedback",
  "executions",
  "integrations",
  "queues",
  "schemas",
  "secrets",
  "workflows",
  "objects",
  "playground",
  "usage",
  "savia",
  "api-keys",
]);
const FORBIDDEN_MODULES = new Set([
  "admin",
  "billing",
  "invitations",
  "memberships",
  "oauth",
  "organizations",
  "users",
]);

type OrganizationContext = { id: string; name: string; role: string } | null;
type HostContext = {
  sub: string;
  name: string;
  email: string;
  organization: OrganizationContext;
  platformAdmin: boolean;
};

function jsonError(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status });
}

function parseTenant(source: URL): string | null {
  const values = source.searchParams.getAll("tenant");
  if (values.length > 1) throw new Error("duplicate");
  const tenant = values[0]?.trim();
  if (!tenant) return null;
  if (!TENANT_PATTERN.test(tenant)) throw new Error("invalid");
  return tenant;
}

function tenantNumber(tenant: string): number {
  return Number(tenant.slice("tenant:".length));
}

function membershipFor(
  actor: AppActor,
  tenant: string,
): AgencyMembership | undefined {
  const id = tenantNumber(tenant);
  return actor.memberships.find(
    (membership) =>
      membership.isActive &&
      (membership.tenantId ?? membership.agencyId) === id,
  );
}

function isPlatformAdmin(actor: AppActor): boolean {
  return actor.globalRoles.includes("platform_admin");
}

function canManage(actor: AppActor, tenant: string): boolean {
  return (
    isPlatformAdmin(actor) ||
    FLOW_ROLE.has(membershipFor(actor, tenant)?.role ?? "")
  );
}

function upstreamRole(role: string, platformAdmin: boolean): string {
  if (platformAdmin || FLOW_ROLE.has(role)) return "admin";
  if (role === "owner") return "owner";
  return "member";
}

function contextFor(actor: AppActor, tenant: string | null): HostContext {
  const platformAdmin = isPlatformAdmin(actor);
  const membership = tenant ? membershipFor(actor, tenant) : undefined;
  return {
    sub: actor.principal.id,
    name: actor.principal.displayName,
    email: actor.principal.email,
    organization: tenant
      ? {
          id: tenant,
          name: membership?.tenantName ?? "",
          role: membership?.role ?? (platformAdmin ? "platform_admin" : ""),
        }
      : null,
    platformAdmin,
  };
}

function actorCanUseModule(actor: AppActor): boolean {
  // Savia Flows has not defined a personal API-key scope. A tenant-bound
  // Savia API key must not inherit the broader Savia API scopes by accident.
  return actor.credential?.kind !== "personal-api-key";
}

async function signedContext(
  claims: HostContext,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(HTTP_ISSUER)
    .setAudience(HTTP_AUDIENCE)
    .setSubject(claims.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + MAX_BRIDGE_TTL_SECONDS)
    .sign(new TextEncoder().encode(secret));
}

function safeModulePath(
  path: string,
): { kind: "local" | "proxy"; organization?: string } | null {
  if (path === "/auth/user" || path === "/auth/protected")
    return { kind: "local" };
  if (path === "/organizations") return { kind: "local" };
  if (path === "/templates" || /^\/templates\/[A-Za-z0-9_-]+$/.test(path))
    return { kind: "proxy" };
  if (path === "/types") return { kind: "proxy" };

  const match = /^\/([^/]+)\/([^/]+)(?:\/.*)?$/.exec(path);
  if (!match) return null;
  let organization: string;
  try {
    organization = decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
  const module = match[2]!;
  if (
    !TENANT_PATTERN.test(organization) ||
    FORBIDDEN_MODULES.has(module) ||
    !SAFE_ORG_MODULES.has(module)
  )
    return null;
  return { kind: "proxy", organization };
}

function isExecutionRequest(method: string, path: string): boolean {
  return (
    method === "POST" &&
    /^\/tenant:(?:0|[1-9]\d*)\/workflows\/[^/]+\/execute(?:\/dev)?$/.test(path)
  );
}

function isAllowedMethod(method: string): boolean {
  return ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(method);
}

function requestHeaders(source: Headers, contextToken: string): Headers {
  const headers = new Headers();
  for (const name of [
    "accept",
    "content-type",
    "if-match",
    "if-none-match",
    "range",
    "sec-websocket-key",
    "sec-websocket-protocol",
    "sec-websocket-version",
    "upgrade",
    "origin",
  ]) {
    const value = source.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set("x-savia-flows-context", contextToken);
  return headers;
}

function ticketPath(value: unknown, tenant: string): string | null {
  if (typeof value !== "string" || value.length > 512) return null;
  const match =
    /^\/(tenant:(?:0|[1-9]\d*))\/(ws|generate)\/([A-Za-z0-9_-]{1,128})$/.exec(
      value,
    );
  if (!match || match[1] !== tenant) return null;
  return value;
}

async function signWebSocketTicket(
  claims: HostContext & { jti: string; tenant: string; path: string },
  secret: string,
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(HTTP_ISSUER)
    .setAudience(WS_AUDIENCE)
    .setSubject(claims.sub)
    .setJti(claims.jti)
    .setIssuedAt(now)
    .setExpirationTime(now + WS_TICKET_TTL_SECONDS)
    .sign(new TextEncoder().encode(secret));
}

function websocketUrl(requestUrl: string, ticket: string): string {
  const url = new URL("/api/public/savia-flows/ws", requestUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("ticket", ticket);
  return url.toString();
}

function activeTenantSql() {
  return "SELECT id,name,kind FROM tenants WHERE id=? AND is_active=1 AND (kind='commercial' OR (kind='platform' AND id=0))";
}

export function registerSaviaFlowsRoutes(
  app: OpenAPIHono,
  options: SaviaFlowsOptions = {},
) {
  // A private service call uses a separate JWT audience. No browser session
  // or mirrored role is sufficient for authorizing an editor command.
  app.post("/api/public/savia-flows/authorize-editor", async (c) => {
    const secret = options.bridgeSecret?.trim();
    if (!secret || new TextEncoder().encode(secret).byteLength < 32)
      return jsonError(
        "SAVIA_FLOWS_UNAVAILABLE",
        "Editor authorization is unavailable.",
        503,
      );
    const token = c.req.header("authorization")?.replace(/^Bearer /, "");
    let claims: Awaited<ReturnType<typeof jwtVerify>>["payload"];
    try {
      if (!token) throw new Error("Missing token");
      ({ payload: claims } = await jwtVerify(
        token,
        new TextEncoder().encode(secret),
        {
          issuer: "savia-flows",
          audience: "savia-flows-host",
          algorithms: ["HS256"],
          maxTokenAge: "10s",
        },
      ));
      const now = Math.floor(Date.now() / 1000);
      if (
        typeof claims.sub !== "string" ||
        !claims.sub ||
        typeof claims.tenant !== "string" ||
        !TENANT_PATTERN.test(claims.tenant) ||
        typeof claims.workflowId !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(claims.workflowId) ||
        !Number.isInteger(claims.iat) ||
        !Number.isInteger(claims.exp) ||
        claims.exp! <= now ||
        claims.exp! - claims.iat! > 10
      )
        throw new Error("Invalid editor claims");
    } catch {
      return jsonError(
        "AUTHORIZATION_FORBIDDEN",
        "Invalid editor authorization context.",
        401,
      );
    }
    const db = (c.env as { DB: D1Database }).DB;
    const row = await db
      .prepare(
        "SELECT p.is_active principal_active,t.is_active tenant_active,t.kind tenant_kind,t.id tenant_id,m.role membership_role,g.role global_role FROM identity_principal p JOIN tenants t ON t.id=? LEFT JOIN identity_tenant_membership m ON m.principal_id=p.id AND m.tenant_id=t.id AND m.is_active=1 LEFT JOIN identity_global_role g ON g.principal_id=p.id AND g.role='platform_admin' WHERE p.id=?",
      )
      .bind(tenantNumber(claims.tenant as string), claims.sub)
      .first<{
        principal_active: number;
        tenant_active: number;
        tenant_kind: string;
        tenant_id: number;
        membership_role: string | null;
        global_role: string | null;
      }>();
    const platform = row?.global_role === "platform_admin";
    const authorized = Boolean(
      row?.principal_active &&
      row.tenant_active &&
      (row.tenant_kind === "commercial" ||
        (row.tenant_kind === "platform" && row.tenant_id === 0 && platform)) &&
      (platform || FLOW_ROLE.has(row.membership_role ?? "")),
    );
    c.header("cache-control", "no-store");
    return c.json({ authorized }, authorized ? 200 : 403);
  });

  app.post("/v1/savia-flows/ws-ticket", async (c) => {
    const origin = c.req.header("origin");
    if (origin && new URL(origin).origin !== new URL(c.req.url).origin)
      return jsonError(
        "CSRF_REJECTED",
        "Socket tickets must be requested from the Savia application.",
        403,
      );
    const actor = actorFromContext(c);
    if (!actorCanUseModule(actor))
      return jsonError(
        "AUTHORIZATION_FORBIDDEN",
        "API keys cannot access Savia Flows.",
        403,
      );
    let tenant: string | null;
    try {
      tenant = parseTenant(new URL(c.req.url));
    } catch {
      return jsonError("INVALID_TENANT", "Tenant scope is invalid.", 400);
    }
    if (!tenant)
      return jsonError(
        "TENANT_REQUIRED",
        "Select a tenant before opening Savia Flows.",
        400,
      );
    const actorTenant = membershipFor(actor, tenant);
    if (!isPlatformAdmin(actor) && !actorTenant)
      return jsonError(
        "AUTHORIZATION_FORBIDDEN",
        "Tenant membership is required.",
        403,
      );
    if (!canManage(actor, tenant))
      return jsonError(
        "AUTHORIZATION_FORBIDDEN",
        "Tenant administrator access is required for the editor socket.",
        403,
      );
    const secret = options.bridgeSecret?.trim();
    if (!secret || new TextEncoder().encode(secret).byteLength < 32)
      return jsonError(
        "SAVIA_FLOWS_UNAVAILABLE",
        "Savia Flows bridge is not configured.",
        503,
      );
    const body = await c.req
      .json<{ path?: unknown }>()
      .catch((): { path?: unknown } => ({}));
    const { path } = body;
    const allowedPath = ticketPath(path, tenant);
    if (!allowedPath)
      return jsonError(
        "INVALID_WEBSOCKET_PATH",
        "WebSocket path is not allowed for this tenant.",
        400,
      );
    const service = options.service;
    if (!service)
      return jsonError(
        "SAVIA_FLOWS_UNAVAILABLE",
        "Savia Flows is not available.",
        503,
      );

    const db = (c.env as { DB: D1Database }).DB;
    const tenantId = tenantNumber(tenant);
    const tenantRow = await db
      .prepare(activeTenantSql())
      .bind(tenantId)
      .first<{ id: number; kind: string }>();
    if (
      !tenantRow ||
      (tenantRow.kind === "platform" && !isPlatformAdmin(actor))
    )
      return jsonError("TENANT_UNAVAILABLE", "Tenant is not available.", 404);
    const now = Math.floor(Date.now() / 1000);
    const jti = crypto.randomUUID();
    const claims = {
      ...contextFor(actor, tenant),
      jti,
      tenant,
      path: allowedPath,
    };
    const token = await signWebSocketTicket(claims, secret, now);
    await db
      .prepare("DELETE FROM savia_flows_ws_tickets WHERE expires_at<=?")
      .bind(now)
      .run();
    await db
      .prepare(
        "INSERT INTO savia_flows_ws_tickets(jti,principal_id,tenant_id,path,expires_at,created_at) VALUES(?,?,?,?,?,?)",
      )
      .bind(
        jti,
        actor.principal.id,
        tenantId,
        allowedPath,
        now + WS_TICKET_TTL_SECONDS,
        now,
      )
      .run();
    return c.json({ url: websocketUrl(c.req.url, token) }, 201);
  });

  app.get("/api/public/savia-flows/ws", async (c) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket")
      return jsonError(
        "WEBSOCKET_REQUIRED",
        "A WebSocket upgrade is required.",
        426,
      );
    const token = c.req.query("ticket");
    const secret = options.bridgeSecret?.trim();
    const service = options.service;
    if (
      !token ||
      !secret ||
      new TextEncoder().encode(secret).byteLength < 32 ||
      !service
    )
      return jsonError(
        "INVALID_WEBSOCKET_TICKET",
        "WebSocket ticket is unavailable.",
        401,
      );
    let payload: Awaited<ReturnType<typeof jwtVerify>>["payload"];
    try {
      ({ payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
        issuer: HTTP_ISSUER,
        audience: WS_AUDIENCE,
        algorithms: ["HS256"],
      }));
    } catch {
      return jsonError(
        "INVALID_WEBSOCKET_TICKET",
        "WebSocket ticket is invalid or expired.",
        401,
      );
    }
    const jti = payload.jti;
    const sub = payload.sub;
    const tenant = payload.tenant;
    const path = payload.path;
    const issuedAt = payload.iat;
    const expiresAt = payload.exp;
    if (
      typeof jti !== "string" ||
      typeof sub !== "string" ||
      typeof tenant !== "string" ||
      !TENANT_PATTERN.test(tenant) ||
      typeof path !== "string" ||
      ticketPath(path, tenant) !== path ||
      !Number.isInteger(issuedAt) ||
      !Number.isInteger(expiresAt) ||
      expiresAt! <= Math.floor(Date.now() / 1000) ||
      issuedAt! > Math.floor(Date.now() / 1000) ||
      issuedAt! < Math.floor(Date.now() / 1000) - WS_TICKET_TTL_SECONDS ||
      expiresAt! - issuedAt! > WS_TICKET_TTL_SECONDS ||
      payload.organization === null ||
      !payload.organization ||
      typeof payload.organization !== "object" ||
      (payload.organization as { id?: unknown }).id !== tenant ||
      typeof payload.platformAdmin !== "boolean"
    )
      return jsonError(
        "INVALID_WEBSOCKET_TICKET",
        "WebSocket ticket claims are invalid.",
        401,
      );

    const db = (c.env as { DB: D1Database }).DB;
    const now = Math.floor(Date.now() / 1000);
    const receipt = await db
      .prepare(
        "DELETE FROM savia_flows_ws_tickets WHERE jti=? AND principal_id=? AND tenant_id=? AND path=? AND expires_at>? RETURNING jti",
      )
      .bind(jti, sub, tenantNumber(tenant), path, now)
      .first<{ jti: string }>();
    if (!receipt)
      return jsonError(
        "INVALID_WEBSOCKET_TICKET",
        "WebSocket ticket was already used or expired.",
        401,
      );

    const active = await db
      .prepare(
        "SELECT p.is_active principal_active,t.is_active tenant_active,t.kind tenant_kind,t.id tenant_id,m.role membership_role,g.role global_role FROM identity_principal p JOIN tenants t ON t.id=? LEFT JOIN identity_tenant_membership m ON m.principal_id=p.id AND m.tenant_id=t.id AND m.is_active=1 LEFT JOIN identity_global_role g ON g.principal_id=p.id AND g.role='platform_admin' WHERE p.id=?",
      )
      .bind(tenantNumber(tenant), sub)
      .first<{
        principal_active: number;
        tenant_active: number;
        membership_role: string | null;
        global_role: string | null;
        tenant_kind: string;
        tenant_id: number;
      }>();
    const platformAdmin = active?.global_role === "platform_admin";
    if (
      !active ||
      !active.principal_active ||
      !active.tenant_active ||
      (active.tenant_kind !== "commercial" &&
        !(
          active.tenant_kind === "platform" &&
          active.tenant_id === 0 &&
          platformAdmin
        )) ||
      (!platformAdmin && active.membership_role === null) ||
      (!platformAdmin && !FLOW_ROLE.has(active.membership_role ?? ""))
    )
      return jsonError(
        "AUTHORIZATION_FORBIDDEN",
        "Tenant membership or editor permission was revoked.",
        403,
      );

    const role = platformAdmin ? "platform_admin" : active.membership_role!;
    const organization = {
      id: tenant,
      name: String((payload.organization as { name?: unknown }).name ?? ""),
      role,
    };
    const hostContext: HostContext = {
      sub,
      name: String(payload.name ?? ""),
      email: String(payload.email ?? ""),
      organization,
      platformAdmin,
    };
    const bridgeToken = await signedContext(hostContext, secret);
    const target = new URL(path, INTERNAL_ORIGIN);
    const headers = requestHeaders(c.req.raw.headers, bridgeToken);
    const request = new Request(target, {
      method: "GET",
      headers,
    });
    return service.fetch(request);
  });

  app.all("/v1/savia-flows/*", async (c) => {
    const actor = actorFromContext(c);
    if (!actorCanUseModule(actor))
      return jsonError(
        "AUTHORIZATION_FORBIDDEN",
        "API keys cannot access Savia Flows.",
        403,
      );
    if (!isAllowedMethod(c.req.method))
      return jsonError("METHOD_NOT_ALLOWED", "Method is not allowed.", 405);
    const source = new URL(c.req.url);
    const path = source.pathname.slice(API_PREFIX.length) || "/";
    let tenant: string | null;
    try {
      tenant = parseTenant(source);
    } catch {
      return jsonError("INVALID_TENANT", "Tenant scope is invalid.", 400);
    }
    const target = safeModulePath(path);
    if (!target)
      return jsonError("NOT_FOUND", "Savia Flows route not found.", 404);

    let member: AgencyMembership | undefined;
    if (target.organization) {
      if (!tenant || target.organization !== tenant)
        return jsonError(
          "AUTHORIZATION_FORBIDDEN",
          "Organization does not match the selected tenant.",
          403,
        );
      member = membershipFor(actor, tenant);
      if (!isPlatformAdmin(actor) && !member)
        return jsonError(
          "AUTHORIZATION_FORBIDDEN",
          "Tenant membership is required.",
          403,
        );
    } else if (path !== "/organizations") {
      if (!tenant && !isPlatformAdmin(actor))
        return jsonError(
          "AUTHORIZATION_FORBIDDEN",
          "Select an authorized tenant.",
          403,
        );
      if (tenant) {
        member = membershipFor(actor, tenant);
        if (!isPlatformAdmin(actor) && !member)
          return jsonError(
            "AUTHORIZATION_FORBIDDEN",
            "Tenant membership is required.",
            403,
          );
      }
    } else if (tenant) {
      member = membershipFor(actor, tenant);
    }

    if (tenant && !isPlatformAdmin(actor) && !member)
      return jsonError(
        "AUTHORIZATION_FORBIDDEN",
        "Tenant membership is required.",
        403,
      );
    if (target.kind === "local" && path !== "/organizations" && !tenant)
      return jsonError(
        "AUTHORIZATION_FORBIDDEN",
        "Select an authorized tenant.",
        403,
      );

    if (
      target.organization &&
      c.req.method !== "GET" &&
      c.req.method !== "HEAD"
    ) {
      if (!isExecutionRequest(c.req.method, path) && !canManage(actor, tenant!))
        return jsonError(
          "AUTHORIZATION_FORBIDDEN",
          "Tenant administrator access is required.",
          403,
        );
    }
    if (
      target.organization &&
      /^\/tenant:[^/]+\/api-keys(?:\/|$)/.test(path) &&
      !canManage(actor, tenant!)
    )
      return jsonError(
        "AUTHORIZATION_FORBIDDEN",
        "Tenant administrator access is required.",
        403,
      );
    if (
      ["/auth/user", "/auth/protected", "/organizations"].includes(path) &&
      !["GET", "HEAD"].includes(c.req.method)
    )
      return jsonError(
        "METHOD_NOT_ALLOWED",
        "This Savia Flows route is read-only.",
        405,
      );
    if (
      (path === "/templates" ||
        path.startsWith("/templates/") ||
        path === "/types") &&
      !["GET", "HEAD"].includes(c.req.method)
    )
      return jsonError(
        "METHOD_NOT_ALLOWED",
        "This Savia Flows route is read-only.",
        405,
      );

    if (path === "/auth/protected") return c.json({ ok: true });
    if (path === "/auth/user") {
      const context = contextFor(actor, tenant);
      if (!context.organization)
        return jsonError(
          "TENANT_REQUIRED",
          "Select a tenant before opening Savia Flows.",
          400,
        );
      if (tenant && !context.organization.name && isPlatformAdmin(actor)) {
        const row = await (c.env as { DB: D1Database }).DB.prepare(
          activeTenantSql(),
        )
          .bind(tenantNumber(tenant))
          .first<{ name: string }>();
        if (row) context.organization.name = row.name;
      }
      return c.json({
        user: {
          sub: context.sub,
          name: context.name,
          email: context.email,
          role: upstreamRole(context.organization.role, context.platformAdmin),
          developerMode: false,
          organization: {
            ...context.organization,
            role: upstreamRole(
              context.organization.role,
              context.platformAdmin,
            ),
          },
          provider: "savia",
          platformAdmin: context.platformAdmin,
        },
      });
    }
    if (path === "/organizations") {
      const organizations = actor.memberships
        .filter((candidate) => candidate.isActive)
        .map((candidate) => {
          const id = `tenant:${candidate.tenantId ?? candidate.agencyId}`;
          return {
            id,
            name: candidate.tenantName ?? "",
            role: upstreamRole(candidate.role, isPlatformAdmin(actor)),
          };
        });
      if (
        tenant &&
        isPlatformAdmin(actor) &&
        !organizations.some((organization) => organization.id === tenant)
      ) {
        const row = await (c.env as { DB: D1Database }).DB.prepare(
          activeTenantSql(),
        )
          .bind(tenantNumber(tenant))
          .first<{ name: string }>();
        if (row)
          organizations.push({ id: tenant, name: row.name, role: "admin" });
      }
      return c.json({ organizations });
    }

    const secret = options.bridgeSecret?.trim();
    if (!secret || new TextEncoder().encode(secret).byteLength < 32)
      return jsonError(
        "SAVIA_FLOWS_UNAVAILABLE",
        "Savia Flows bridge is not configured.",
        503,
      );
    if (!options.service)
      return jsonError(
        "SAVIA_FLOWS_UNAVAILABLE",
        "Savia Flows is not available.",
        503,
      );
    const contextToken = await signedContext(contextFor(actor, tenant), secret);
    const headers = requestHeaders(c.req.raw.headers, contextToken);
    const targetUrl = new URL(path, INTERNAL_ORIGIN);
    targetUrl.search = source.search;
    const body = ["GET", "HEAD"].includes(c.req.method)
      ? undefined
      : c.req.raw.body;
    const response = await options.service.fetch(
      streamingRequest(targetUrl, {
        method: c.req.method,
        headers,
        body,
        redirect: "manual",
      }),
    );
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("set-cookie");
    responseHeaders.set("cache-control", "no-store");
    if (response.webSocket) return response;
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  });
}
