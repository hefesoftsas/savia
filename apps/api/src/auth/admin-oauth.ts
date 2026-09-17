import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  cookieDomainForHost,
  DEFAULT_CANONICAL_HOST,
  isAllowedPublicOrigin,
} from "@savia/tenant-host/tenant-host";
import type { AuthService } from "./better-auth";

type AdminOAuthClient = {
  clientId: string;
  redirectUri: string;
  resource: string;
  scopes: string[];
};

type OAuthTokenResponse = {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
  token_type?: unknown;
};

type OAuthTransaction = {
  clientId: string;
  codeVerifier: string;
  redirectUri: string;
};

const transactionLifetimeMilliseconds = 5 * 60 * 1000;
const refreshCookieName = "savia.admin_refresh_token";
const refreshCookiePath = "/api/auth/admin";
const refreshTokenLifetimeSeconds = 30 * 24 * 60 * 60;
const betterAuthSessionCookieNames = [
  "savia.session_token",
  "savia.session_data",
  "savia.dont_remember",
  "savia_two_factor",
] as const;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomValue(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

async function codeChallenge(codeVerifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier),
  );
  return base64url(new Uint8Array(digest));
}

function error(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status });
}

function cacheHeaders(headers: HeadersInit = {}): Headers {
  const result = new Headers(headers);
  result.set("cache-control", "no-store");
  return result;
}

function refreshCookie(
  token: string,
  requestUrl: string,
  cookieDomain?: string,
): string {
  const attributes = [
    `${refreshCookieName}=${encodeURIComponent(token)}`,
    "HttpOnly",
    `Max-Age=${refreshTokenLifetimeSeconds}`,
    `Path=${refreshCookiePath}`,
    "SameSite=Lax",
  ];
  if (cookieDomain) attributes.push(`Domain=${cookieDomain}`);
  if (new URL(requestUrl).protocol === "https:") attributes.push("Secure");
  return attributes.join("; ");
}

function clearRefreshCookie(requestUrl: string, cookieDomain?: string): string {
  const attributes = [
    `${refreshCookieName}=`,
    "HttpOnly",
    "Max-Age=0",
    `Path=${refreshCookiePath}`,
    "SameSite=Lax",
  ];
  if (cookieDomain) attributes.push(`Domain=${cookieDomain}`);
  if (new URL(requestUrl).protocol === "https:") attributes.push("Secure");
  return attributes.join("; ");
}

function clearRefreshCookies(
  requestUrl: string,
  cookieDomain?: string,
): string[] {
  const list = [clearRefreshCookie(requestUrl)];
  if (cookieDomain) list.push(clearRefreshCookie(requestUrl, cookieDomain));
  return list;
}

function clearBetterAuthCookie(
  name: string,
  requestUrl: string,
  cookieDomain?: string,
): string {
  const attributes = [
    `${name}=`,
    "HttpOnly",
    "Max-Age=0",
    "Path=/",
    "SameSite=Lax",
  ];
  if (cookieDomain) attributes.push(`Domain=${cookieDomain}`);
  if (new URL(requestUrl).protocol === "https:") attributes.push("Secure");
  return attributes.join("; ");
}

function clearBetterAuthCookies(
  name: string,
  requestUrl: string,
  cookieDomain?: string,
): string[] {
  const list = [clearBetterAuthCookie(name, requestUrl)];
  if (cookieDomain) list.push(clearBetterAuthCookie(name, requestUrl, cookieDomain));
  return list;
}

function appendSetCookies(source: Headers, target: Headers): void {
  const getSetCookie = (
    source as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie;
  const cookies = getSetCookie?.call(source);
  if (cookies?.length) {
    for (const cookie of cookies) target.append("set-cookie", cookie);
    return;
  }
  const cookie = source.get("set-cookie");
  if (cookie) target.append("set-cookie", cookie);
}

function refreshTokenFromRequest(request: Request): string | undefined {
  const cookies = request.headers.get("cookie")?.split(";") ?? [];
  const entry = cookies
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${refreshCookieName}=`));
  if (!entry) return undefined;
  try {
    const token = decodeURIComponent(entry.slice(refreshCookieName.length + 1));
    return token || undefined;
  } catch {
    return undefined;
  }
}

function corsHeaders(
  origin: string | null,
  client: AdminOAuthClient,
  canonicalHost: string = DEFAULT_CANONICAL_HOST,
): Headers {
  const headers = cacheHeaders();
  if (
    origin &&
    (origin === new URL(client.redirectUri).origin ||
      isAllowedPublicOrigin(origin, canonicalHost))
  ) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-credentials", "true");
    headers.set("access-control-allow-headers", "content-type");
    headers.set("access-control-allow-methods", "POST, OPTIONS");
    headers.set("vary", "Origin");
  }
  return headers;
}

function validClient(value: unknown): value is AdminOAuthClient {
  if (!value || typeof value !== "object") return false;
  const client = value as Partial<AdminOAuthClient>;
  return (
    typeof client.clientId === "string" &&
    typeof client.redirectUri === "string" &&
    typeof client.resource === "string" &&
    Array.isArray(client.scopes) &&
    client.scopes.every((scope) => typeof scope === "string")
  );
}

async function adminClient(
  service: AuthService | undefined,
): Promise<AdminOAuthClient | undefined> {
  if (!service) return undefined;
  const response = await service.fetch(
    new Request("https://savia-auth.internal/_internal/oauth/admin-client"),
  );
  if (!response.ok) return undefined;
  const payload = (await response.json()) as unknown;
  return validClient(payload) ? payload : undefined;
}

async function createTransaction(
  d1: D1Database,
  client: AdminOAuthClient,
): Promise<{ codeChallenge: string; state: string }> {
  const state = randomValue();
  const codeVerifier = randomValue(64);
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + transactionLifetimeMilliseconds,
  ).toISOString();
  await d1.batch([
    d1
      .prepare("DELETE FROM admin_oauth_transactions WHERE expires_at <= ?")
      .bind(now.toISOString()),
    d1
      .prepare(
        `INSERT INTO admin_oauth_transactions
          (state, client_id, redirect_uri, code_verifier, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        state,
        client.clientId,
        client.redirectUri,
        codeVerifier,
        expiresAt,
        now.toISOString(),
      ),
  ]);
  return { state, codeChallenge: await codeChallenge(codeVerifier) };
}

async function consumeTransaction(
  d1: D1Database,
  state: string,
): Promise<OAuthTransaction | undefined> {
  const row = await d1
    .prepare(
      `DELETE FROM admin_oauth_transactions
       WHERE state = ? AND expires_at > ?
       RETURNING client_id, redirect_uri, code_verifier`,
    )
    .bind(state, new Date().toISOString())
    .first<{
      client_id: string;
      code_verifier: string;
      redirect_uri: string;
    }>();
  return row
    ? {
        clientId: row.client_id,
        codeVerifier: row.code_verifier,
        redirectUri: row.redirect_uri,
      }
    : undefined;
}

function callbackInput(
  value: unknown,
): { code: string; state: string } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { code?: unknown; state?: unknown };
  return typeof candidate.code === "string" &&
    candidate.code.length > 0 &&
    typeof candidate.state === "string" &&
    candidate.state.length > 0
    ? { code: candidate.code, state: candidate.state }
    : undefined;
}

function tokenResponse(value: unknown): OAuthTokenResponse | undefined {
  if (!value || typeof value !== "object") return undefined;
  const token = value as OAuthTokenResponse;
  if (
    typeof token.access_token !== "string" ||
    token.access_token.length === 0 ||
    token.token_type !== "Bearer"
  ) {
    return undefined;
  }
  return token;
}

function refreshToken(token: OAuthTokenResponse): string | undefined {
  return typeof token.refresh_token === "string" &&
    token.refresh_token.length > 0
    ? token.refresh_token
    : undefined;
}

function oauthErrorCode(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const error = (payload as { error?: unknown }).error;
  return typeof error === "string" && /^[a-z_]+$/.test(error)
    ? error
    : undefined;
}

function publicTokenResponse(token: OAuthTokenResponse) {
  return {
    access_token: token.access_token,
    token_type: token.token_type,
    ...(typeof token.expires_in === "number"
      ? { expires_in: token.expires_in }
      : {}),
    ...(typeof token.scope === "string" ? { scope: token.scope } : {}),
  };
}

function providerRedirect(
  value: unknown,
  client: AdminOAuthClient,
  publicUrl: string,
): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const payload = value as { redirect?: unknown; url?: unknown };
  if (payload.redirect !== true || typeof payload.url !== "string")
    return undefined;

  const destination = new URL(payload.url, publicUrl);
  const publicOrigin = new URL(publicUrl).origin;
  const callback = new URL(client.redirectUri);
  const authPage =
    destination.origin === publicOrigin &&
    destination.pathname.startsWith("/api/auth/");
  const callbackPage =
    destination.origin === callback.origin &&
    destination.pathname === callback.pathname;
  return authPage || callbackPage ? destination.toString() : undefined;
}

async function authorizationRedirect(
  service: AuthService,
  client: AdminOAuthClient,
  authorization: URL,
  request: Request,
): Promise<string | undefined> {
  const providerRequest = new URL(
    "/api/auth/oauth2/authorize",
    "https://savia-auth.internal",
  );
  providerRequest.search = authorization.search;
  const headers = new Headers({ accept: "application/json" });
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  const response = await service.fetch(
    new Request(providerRequest, { headers }),
  );
  if (!response.ok) return undefined;
  return providerRedirect(
    await response.json().catch(() => undefined),
    client,
    request.url,
  );
}

export function registerAdminOAuthRoutes(
  app: OpenAPIHono,
  d1: D1Database,
  service?: AuthService,
  canonicalHost: string = DEFAULT_CANONICAL_HOST,
): void {
  const cors = (origin: string | null, client: AdminOAuthClient) =>
    corsHeaders(origin, client, canonicalHost);
  const cookieDomain = (url: string) =>
    cookieDomainForHost(new URL(url).hostname, canonicalHost);

  app.get("/api/auth/admin/authorize", async (context) => {
    if (!service)
      return error(
        "AUTHENTICATION_UNAVAILABLE",
        "Authentication service is unavailable",
        503,
      );
    const client = await adminClient(service);
    if (!client)
      return error(
        "AUTHENTICATION_UNAVAILABLE",
        "Authentication service is unavailable",
        503,
      );
    const transaction = await createTransaction(d1, client);
    const authorization = new URL(
      "/api/auth/oauth2/authorize",
      context.req.url,
    );
    authorization.search = new URLSearchParams({
      client_id: client.clientId,
      code_challenge: transaction.codeChallenge,
      code_challenge_method: "S256",
      redirect_uri: client.redirectUri,
      resource: client.resource,
      response_type: "code",
      scope: client.scopes.join(" "),
      state: transaction.state,
    }).toString();
    const destination = await authorizationRedirect(
      service,
      client,
      authorization,
      context.req.raw,
    );
    if (!destination)
      return error(
        "AUTHENTICATION_UNAVAILABLE",
        "Authentication service is unavailable",
        503,
      );
    return new Response(null, {
      status: 302,
      headers: cacheHeaders({ location: destination }),
    });
  });

  app.options("/api/auth/admin/callback", async (context) => {
    const client = await adminClient(service);
    if (!client)
      return error(
        "AUTHENTICATION_UNAVAILABLE",
        "Authentication service is unavailable",
        503,
      );
    return new Response(null, {
      status: 204,
      headers: cors(context.req.header("origin") ?? null, client),
    });
  });

  app.options("/api/auth/admin/refresh", async (context) => {
    const client = await adminClient(service);
    if (!client)
      return error(
        "AUTHENTICATION_UNAVAILABLE",
        "Authentication service is unavailable",
        503,
      );
    return new Response(null, {
      status: 204,
      headers: cors(context.req.header("origin") ?? null, client),
    });
  });

  app.options("/api/auth/admin/logout", async (context) => {
    const client = await adminClient(service);
    if (!client)
      return error(
        "AUTHENTICATION_UNAVAILABLE",
        "Authentication service is unavailable",
        503,
      );
    return new Response(null, {
      status: 204,
      headers: cors(context.req.header("origin") ?? null, client),
    });
  });

  app.post("/api/auth/admin/callback", async (context) => {
    const client = await adminClient(service);
    if (!client)
      return error(
        "AUTHENTICATION_UNAVAILABLE",
        "Authentication service is unavailable",
        503,
      );
    const headers = cors(context.req.header("origin") ?? null, client);
    const input = callbackInput(
      await context.req.json().catch(() => undefined),
    );
    if (!input)
      return Response.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "A callback code and state are required",
          },
        },
        { status: 400, headers },
      );
    const transaction = await consumeTransaction(d1, input.state);
    if (
      !transaction ||
      transaction.clientId !== client.clientId ||
      transaction.redirectUri !== client.redirectUri
    ) {
      return Response.json(
        {
          error: {
            code: "INVALID_OAUTH_STATE",
            message: "The login transaction is invalid or expired",
          },
        },
        { status: 400, headers },
      );
    }
    const tokenEndpoint = new URL(
      "/api/auth/oauth2/token",
      "https://savia-auth.internal",
    );
    const response = await service!.fetch(
      new Request(tokenEndpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: transaction.clientId,
          code: input.code,
          code_verifier: transaction.codeVerifier,
          grant_type: "authorization_code",
          redirect_uri: transaction.redirectUri,
          resource: client.resource,
        }).toString(),
      }),
    );
    const payload = await response.json().catch(() => undefined);
    const token = response.ok ? tokenResponse(payload) : undefined;
    const nextRefreshToken = token ? refreshToken(token) : undefined;
    if (!token || !nextRefreshToken) {
      const providerError = oauthErrorCode(payload);
      console.error("Savia admin OAuth token exchange failed", {
        providerError: providerError ?? "unknown",
        status: response.status,
      });
      return Response.json(
        {
          error: {
            code: "OAUTH_TOKEN_EXCHANGE_FAILED",
            message: providerError
              ? `Better Auth rejected the authorization code (${providerError})`
              : "Better Auth rejected the authorization code",
          },
        },
        { status: 401, headers },
      );
    }
    headers.append(
      "set-cookie",
      refreshCookie(
        nextRefreshToken,
        context.req.url,
        cookieDomain(context.req.url),
      ),
    );
    return Response.json(publicTokenResponse(token), { headers });
  });

  app.post("/api/auth/admin/refresh", async (context) => {
    const client = await adminClient(service);
    if (!client)
      return error(
        "AUTHENTICATION_UNAVAILABLE",
        "Authentication service is unavailable",
        503,
      );
    const headers = cors(context.req.header("origin") ?? null, client);
    const currentRefreshToken = refreshTokenFromRequest(context.req.raw);
    if (!currentRefreshToken) {
      for (const cookie of clearRefreshCookies(
        context.req.url,
        cookieDomain(context.req.url),
      )) {
        headers.append("set-cookie", cookie);
      }
      return Response.json(
        {
          error: {
            code: "AUTHENTICATION_REQUIRED",
            message: "An administrator session is required",
          },
        },
        { status: 401, headers },
      );
    }
    const response = await service!.fetch(
      new Request("https://savia-auth.internal/api/auth/oauth2/token", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: client.clientId,
          grant_type: "refresh_token",
          refresh_token: currentRefreshToken,
          resource: client.resource,
        }).toString(),
      }),
    );
    const token = response.ok
      ? tokenResponse(await response.json().catch(() => undefined))
      : undefined;
    const nextRefreshToken = token ? refreshToken(token) : undefined;
    if (!token || !nextRefreshToken) {
      for (const cookie of clearRefreshCookies(
        context.req.url,
        cookieDomain(context.req.url),
      )) {
        headers.append("set-cookie", cookie);
      }
      return Response.json(
        {
          error: {
            code: "AUTHENTICATION_REQUIRED",
            message: "The administrator session has expired",
          },
        },
        { status: 401, headers },
      );
    }
    headers.append(
      "set-cookie",
      refreshCookie(
        nextRefreshToken,
        context.req.url,
        cookieDomain(context.req.url),
      ),
    );
    return Response.json(publicTokenResponse(token), { headers });
  });

  app.post("/api/auth/admin/logout", async (context) => {
    const client = await adminClient(service);
    if (!client)
      return error(
        "AUTHENTICATION_UNAVAILABLE",
        "Authentication service is unavailable",
        503,
      );
    const headers = cors(context.req.header("origin") ?? null, client);
    for (const cookie of clearRefreshCookies(
      context.req.url,
      cookieDomain(context.req.url),
    )) {
      headers.append("set-cookie", cookie);
    }
    for (const name of betterAuthSessionCookieNames) {
      for (const cookie of clearBetterAuthCookies(
        name,
        context.req.url,
        cookieDomain(context.req.url),
      )) {
        headers.append("set-cookie", cookie);
      }
    }
    const authHeaders = new Headers({
      accept: "application/json",
      "content-type": "application/json",
      origin: context.req.header("origin") ?? new URL(context.req.url).origin,
    });
    const cookie = context.req.header("cookie");
    if (cookie) authHeaders.set("cookie", cookie);
    const signOut = await service!.fetch(
      new Request("https://savia-auth.internal/api/auth/sign-out", {
        method: "POST",
        headers: authHeaders,
        body: "{}",
      }),
    );
    if (!signOut.ok) {
      console.error(
        "Savia Better Auth sign-out failed",
        signOut.status,
        await signOut.text().catch(() => ""),
      );
    }
    appendSetCookies(signOut.headers, headers);
    return new Response(null, { status: 204, headers });
  });
}
