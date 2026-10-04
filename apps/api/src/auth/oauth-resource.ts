import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import type { ResourceServerMetadata } from "@better-auth/oauth-provider";
import {
  createLocalJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JSONWebKeySet,
} from "jose";
import { AuthenticationError } from "./types";
import { requiredRecordingScope } from "./recording-scope-policy";

export const SAVIA_READ_SCOPE = "savia.api.read";
export const SAVIA_WRITE_SCOPE = "savia.api.write";
export const RECORDING_READ_SCOPE = "recordings:read";
export const RECORDING_UPLOAD_SCOPE = "recordings:upload";
export const RECORDING_PROCESS_SCOPE = "recordings:process";

const roleClaim = "https://savia.hefesoft.com/roles";
const emailClaim = "https://savia.hefesoft.com/email";
const nameClaim = "https://savia.hefesoft.com/name";
const twoFactorClaim = "https://savia.hefesoft.com/two-factor-enabled";

const oauthResourceClient = oauthProviderResourceClient().getActions();

export type OAuthResourceConfiguration = {
  issuer: string;
  resource: string;
  verifyAccessToken?: OAuthAccessTokenVerifier;
};

export type OAuthAccessTokenVerifier = (
  request: Request,
  configuration: Required<
    Pick<OAuthResourceConfiguration, "issuer" | "resource">
  >,
) => Promise<Record<string, unknown>>;

export type OAuthJwksService = {
  fetch(request: Request): Promise<Response>;
};

export type OAuthAuthenticatedIdentity = {
  displayName: string;
  email: string;
  roles: string[];
  scopes: Set<string>;
  subject: string;
  twoFactorEnabled: boolean;
};

export type OAuthResourceAuthenticator = {
  configuration: Required<
    Pick<OAuthResourceConfiguration, "issuer" | "resource">
  >;
  authenticate(request: Request): Promise<OAuthAuthenticatedIdentity>;
};

function normalizedConfiguration(
  configuration: OAuthResourceConfiguration,
): Required<Pick<OAuthResourceConfiguration, "issuer" | "resource">> {
  const issuer = configuration.issuer.replace(/\/$/, "");
  const resource = configuration.resource.replace(/\/$/, "");
  if (!issuer || !resource)
    throw new Error("OAuth issuer and resource are required");
  return { issuer, resource };
}

async function verifyWithJwks(
  request: Request,
  configuration: Required<
    Pick<OAuthResourceConfiguration, "issuer" | "resource">
  >,
): Promise<Record<string, unknown>> {
  return (await oauthResourceClient.verifyAccessTokenRequest(request, {
    jwksUrl: `${configuration.issuer}/jwks`,
    verifyOptions: {
      audience: configuration.resource,
      issuer: configuration.issuer,
    },
  })) as Record<string, unknown>;
}

function bearerAccessToken(request: Request): string {
  if (request.headers.has("dpop")) {
    throw new Error("DPoP access tokens are not supported by this resource");
  }
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new Error("Missing bearer access token");
  }
  const token = authorization.slice("Bearer ".length).trim();
  if (!token) throw new Error("Missing bearer access token");
  return token;
}

function isJsonWebKeySet(value: unknown): value is JSONWebKeySet {
  return (
    typeof value === "object" &&
    value !== null &&
    "keys" in value &&
    Array.isArray(value.keys)
  );
}

const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
const JWKS_ROTATION_REFRESH_COOLDOWN_MS = 30 * 1000;
const MAX_CACHED_ISSUERS_PER_SERVICE = 8;

type CachedJwks = {
  resolver: ReturnType<typeof createLocalJWKSet>;
  expiresAt: number;
};

type JwksCacheEntry = {
  cached?: CachedJwks;
  refreshPromise?: Promise<CachedJwks>;
  lastRotationRefreshAt?: number;
};

const jwksCacheByService = new WeakMap<
  OAuthJwksService,
  Map<string, JwksCacheEntry>
>();

function jwksCacheEntryFor(
  service: OAuthJwksService,
  issuer: string,
): JwksCacheEntry {
  let entries = jwksCacheByService.get(service);
  if (!entries) {
    entries = new Map();
    jwksCacheByService.set(service, entries);
  }

  const now = Date.now();
  for (const [cachedIssuer, entry] of entries) {
    if (
      cachedIssuer !== issuer &&
      !entry.refreshPromise &&
      entry.cached &&
      entry.cached.expiresAt <= now
    ) {
      entries.delete(cachedIssuer);
    }
  }

  let entry = entries.get(issuer);
  if (!entry) {
    if (entries.size >= MAX_CACHED_ISSUERS_PER_SERVICE) {
      const evictable = [...entries].find(
        ([, candidate]) => !candidate.refreshPromise,
      );
      if (evictable) entries.delete(evictable[0]);
    }
    entry = {};
    entries.set(issuer, entry);
  }
  return entry;
}

function refreshJwks(
  service: OAuthJwksService,
  entry: JwksCacheEntry,
): Promise<CachedJwks> {
  if (entry.refreshPromise) return entry.refreshPromise;

  const refresh = (async () => {
    try {
      const response = await service.fetch(
        new Request("https://savia-auth.internal/api/auth/jwks", {
          headers: { accept: "application/json" },
        }),
      );
      if (!response.ok) {
        throw new Error("Jwks failed: authentication service response");
      }
      const jwks = await response.json().catch(() => undefined);
      if (!isJsonWebKeySet(jwks)) {
        throw new Error("Jwks failed: invalid authentication service response");
      }
      let resolver: ReturnType<typeof createLocalJWKSet>;
      try {
        resolver = createLocalJWKSet(jwks);
      } catch {
        throw new Error("Jwks failed: invalid authentication service response");
      }
      const cached = { resolver, expiresAt: Date.now() + JWKS_CACHE_TTL_MS };
      entry.cached = cached;
      return cached;
    } catch (error) {
      entry.cached = undefined;
      throw error;
    }
  })();
  entry.refreshPromise = refresh;
  void refresh.then(
    () => {
      if (entry.refreshPromise === refresh) entry.refreshPromise = undefined;
    },
    () => {
      if (entry.refreshPromise === refresh) entry.refreshPromise = undefined;
    },
  );
  return refresh;
}

async function currentJwks(
  service: OAuthJwksService,
  issuer: string,
): Promise<{ entry: JwksCacheEntry; jwks: CachedJwks }> {
  const entry = jwksCacheEntryFor(service, issuer);
  const now = Date.now();
  if (entry.cached && entry.cached.expiresAt > now)
    return { entry, jwks: entry.cached };
  return { entry, jwks: await refreshJwks(service, entry) };
}

async function refreshAfterUnknownKey(
  service: OAuthJwksService,
  entry: JwksCacheEntry,
  failedResolver: ReturnType<typeof createLocalJWKSet>,
): Promise<CachedJwks> {
  if (entry.refreshPromise) return entry.refreshPromise;
  if (entry.cached?.resolver !== failedResolver) {
    if (entry.cached) return entry.cached;
    return refreshJwks(service, entry);
  }

  const now = Date.now();
  if (
    entry.lastRotationRefreshAt !== undefined &&
    now - entry.lastRotationRefreshAt < JWKS_ROTATION_REFRESH_COOLDOWN_MS
  ) {
    return entry.cached;
  }
  entry.lastRotationRefreshAt = now;
  return refreshJwks(service, entry);
}

/**
 * Verifies JWTs with the authentication worker through a Cloudflare service
 * binding. Calling the public JWKS route from a Worker can re-enter the edge
 * gateway and fail, while this path stays inside the Worker network.
 */
export function serviceBoundOAuthAccessTokenVerifier(
  service: OAuthJwksService,
): OAuthAccessTokenVerifier {
  return async (request, configuration) => {
    const token = bearerAccessToken(request);
    const cacheIssuer = configuration.issuer.replace(/\/$/, "");
    const { entry, jwks } = await currentJwks(service, cacheIssuer);
    try {
      const { payload } = await jwtVerify(token, jwks.resolver, {
        audience: configuration.resource,
        issuer: configuration.issuer,
      });
      return payload as Record<string, unknown>;
    } catch (exception) {
      if (!(exception instanceof joseErrors.JWKSNoMatchingKey)) throw exception;
      const refreshed = await refreshAfterUnknownKey(
        service,
        entry,
        jwks.resolver,
      );
      if (refreshed.resolver === jwks.resolver) throw exception;
      const { payload } = await jwtVerify(token, refreshed.resolver, {
        audience: configuration.resource,
        issuer: configuration.issuer,
      });
      return payload as Record<string, unknown>;
    }
  };
}

function requiredString(claims: Record<string, unknown>, name: string): string {
  const value = claims[name];
  if (typeof value !== "string" || !value)
    throw new Error(`Invalid ${name} claim`);
  return value;
}

function stringArrayClaim(
  claims: Record<string, unknown>,
  name: string,
): string[] {
  const value = claims[name];
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(`Invalid ${name} claim`);
  }
  return value;
}

function booleanClaim(claims: Record<string, unknown>, name: string): boolean {
  const value = claims[name];
  if (typeof value !== "boolean") throw new Error(`Invalid ${name} claim`);
  return value;
}

function parseIdentity(
  claims: Record<string, unknown>,
): OAuthAuthenticatedIdentity {
  return {
    subject: requiredString(claims, "sub"),
    email: requiredString(claims, emailClaim),
    displayName: requiredString(claims, nameClaim),
    roles: stringArrayClaim(claims, roleClaim),
    twoFactorEnabled: booleanClaim(claims, twoFactorClaim),
    scopes: new Set(requiredString(claims, "scope").split(" ").filter(Boolean)),
  };
}

function authenticationRequired(): AuthenticationError {
  return new AuthenticationError(
    "AUTHENTICATION_REQUIRED",
    "A valid OAuth access token is required",
  );
}

function verificationErrorCategory(exception: unknown): string {
  if (!(exception instanceof Error)) return typeof exception;
  if (/^jwks failed:/i.test(exception.message)) return "jwks_fetch_failed";
  if (exception.message === "No jwks found") return "jwks_unavailable";
  return exception.name || "Error";
}

export function requiredOAuthScope(request: Request): string {
  const path = new URL(request.url).pathname;
  if (
    (request.method === "POST" &&
      path === "/v1/personal-integrations/ticket-summary") ||
    path === "/api/assistant/chat" ||
    /^\/api\/assistant\/mcp\/employees\/[^/]+\/invoke$/.test(path)
  ) {
    return SAVIA_READ_SCOPE;
  }
  return request.method === "GET" || request.method === "HEAD"
    ? SAVIA_READ_SCOPE
    : SAVIA_WRITE_SCOPE;
}

export function requireOAuthScope(
  identity: OAuthAuthenticatedIdentity,
  request: Request,
): void {
  const recordingScope = requiredRecordingScope(request);
  if (recordingScope) {
    const path = new URL(request.url).pathname;
    // Workspace discovery is intentionally available only to native, narrowly
    // scoped clients. Broad API scopes retain their existing route behavior
    // everywhere else, including the pre-existing Companion recording routes.
    if (path === "/v1/companion/session") {
      if (identity.scopes.has(RECORDING_READ_SCOPE)) return;
      throw new AuthenticationError(
        "INSUFFICIENT_SCOPE",
        `The access token does not grant ${RECORDING_READ_SCOPE}`,
      );
    }
    if (
      identity.scopes.has(recordingScope) ||
      identity.scopes.has(requiredOAuthScope(request))
    ) {
      return;
    }
    throw new AuthenticationError(
      "INSUFFICIENT_SCOPE",
      `The access token does not grant ${recordingScope}`,
    );
  }
  const scope = requiredOAuthScope(request);
  if (identity.scopes.has(scope)) return;
  throw new AuthenticationError(
    "INSUFFICIENT_SCOPE",
    `The access token does not grant ${scope}`,
  );
}

export { requiredRecordingScope } from "./recording-scope-policy";

export function createOAuthResourceAuthenticator(
  input: OAuthResourceConfiguration,
): OAuthResourceAuthenticator {
  const configuration = normalizedConfiguration(input);
  const verifyAccessToken = input.verifyAccessToken ?? verifyWithJwks;
  return {
    configuration,
    async authenticate(request: Request): Promise<OAuthAuthenticatedIdentity> {
      try {
        return parseIdentity(await verifyAccessToken(request, configuration));
      } catch (exception) {
        console.error(
          `Savia OAuth access token validation failed: ${verificationErrorCategory(exception)}`,
        );
        throw authenticationRequired();
      }
    },
  };
}

export async function protectedResourceMetadata(
  configuration: Required<
    Pick<OAuthResourceConfiguration, "issuer" | "resource">
  >,
): Promise<ResourceServerMetadata> {
  return oauthResourceClient.getProtectedResourceMetadata(
    {
      authorization_servers: [configuration.issuer],
      resource: configuration.resource,
      scopes_supported: [
        SAVIA_READ_SCOPE,
        SAVIA_WRITE_SCOPE,
        RECORDING_READ_SCOPE,
        RECORDING_UPLOAD_SCOPE,
        RECORDING_PROCESS_SCOPE,
      ],
    },
    {
      externalScopes: [
        SAVIA_READ_SCOPE,
        SAVIA_WRITE_SCOPE,
        RECORDING_READ_SCOPE,
        RECORDING_UPLOAD_SCOPE,
        RECORDING_PROCESS_SCOPE,
      ],
    },
  );
}
