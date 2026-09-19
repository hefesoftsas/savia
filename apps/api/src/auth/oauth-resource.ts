import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import type { ResourceServerMetadata } from "@better-auth/oauth-provider";
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import { AuthenticationError } from "./types";

export const SAVIA_READ_SCOPE = "savia.api.read";
export const SAVIA_WRITE_SCOPE = "savia.api.write";

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

/**
 * Verifies JWTs with the authentication worker through a Cloudflare service
 * binding. Calling the public JWKS route from a Worker can re-enter the edge
 * gateway and fail, while this path stays inside the Worker network.
 */
export function serviceBoundOAuthAccessTokenVerifier(
  service: OAuthJwksService,
): OAuthAccessTokenVerifier {
  return async (request, configuration) => {
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
    const { payload } = await jwtVerify(
      bearerAccessToken(request),
      createLocalJWKSet(jwks),
      {
        audience: configuration.resource,
        issuer: configuration.issuer,
      },
    );
    return payload as Record<string, unknown>;
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
  const scope = requiredOAuthScope(request);
  if (identity.scopes.has(scope)) return;
  throw new AuthenticationError(
    "INSUFFICIENT_SCOPE",
    `The access token does not grant ${scope}`,
  );
}

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
      scopes_supported: [SAVIA_READ_SCOPE, SAVIA_WRITE_SCOPE],
    },
    { externalScopes: [SAVIA_READ_SCOPE, SAVIA_WRITE_SCOPE] },
  );
}
