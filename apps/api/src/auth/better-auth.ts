import { PersonalApiKeys } from "./personal-api-keys";
import { authorizePersonalApiKeyRequest } from "./personal-api-key-policy";
import {
  ensureBootstrapAdministrator,
  loadActor,
  upsertPrincipal,
} from "./identity-repository";
import {
  requireOAuthScope,
  type OAuthAuthenticatedIdentity,
  type OAuthResourceAuthenticator,
} from "./oauth-resource";
import {
  AuthenticationError,
  type AppActor,
  type Authenticator,
} from "./types";

export type AuthService = {
  fetch(request: Request): Promise<Response>;
};

export type CreateIdentityUserInput = {
  email: string;
  firstName: string;
  lastName: string;
  platformAdmin: boolean;
  temporaryPassword?: string;
  tenantId?: number;
  emailVerified?: boolean;
};

export type CreatedIdentityUser = {
  subject: string;
  email: string;
  displayName: string;
};

export type ManagedIdentityUser = CreatedIdentityUser & {
  role: "admin" | "user";
  isBanned: boolean;
  twoFactorEnabled: boolean;
  emailVerified?: boolean;
};

export type IdentityUserAdministrator = {
  issuer: string;
  listUsers(request: Request): Promise<ManagedIdentityUser[]>;
  getUser(subject: string, request: Request): Promise<ManagedIdentityUser>;
  createUser(
    input: CreateIdentityUserInput,
    request: Request,
  ): Promise<CreatedIdentityUser>;
  updateUser(
    subject: string,
    input: {
      displayName?: string;
      platformAdmin?: boolean;
      emailVerified?: boolean;
      tenantId?: number | null;
    },
    request: Request,
  ): Promise<ManagedIdentityUser>;
  setAccountActive(
    subject: string,
    isActive: boolean,
    request: Request,
  ): Promise<ManagedIdentityUser>;
  revokeSessions(subject: string, request: Request): Promise<void>;
  sendPasswordReset(subject: string, request: Request): Promise<void>;
  deleteUser(subject: string, request: Request): Promise<void>;
};

export type OAuthClientAuthentication =
  "none" | "client_secret_basic" | "client_secret_post";

export type OAuthClientSummary = {
  applicationType: "native" | "web";
  clientAuthentication: OAuthClientAuthentication;
  clientId: string;
  clientName: string;
  grantTypes: ("authorization_code" | "refresh_token")[];
  redirectUris: string[];
  scopes: string[];
  trusted: boolean;
};

export type OAuthClientCreateInput = {
  applicationType?: "native" | "web";
  clientAuthentication: OAuthClientAuthentication;
  clientName: string;
  grantTypes?: ("authorization_code" | "refresh_token")[];
  redirectUris: string[];
  scopes: string[];
  trusted: boolean;
};

export type OAuthClientUpdateInput = Partial<
  Pick<
    OAuthClientCreateInput,
    | "applicationType"
    | "clientName"
    | "grantTypes"
    | "redirectUris"
    | "scopes"
    | "trusted"
  >
>;

export type OAuthClientCreated = OAuthClientSummary & {
  clientSecret?: string;
};

export type OAuthClientSecretRotated = {
  clientId: string;
  clientSecret: string;
};

export type OAuthClientAdministrator = {
  list(request: Request): Promise<OAuthClientSummary[]>;
  create(
    input: OAuthClientCreateInput,
    request: Request,
  ): Promise<OAuthClientCreated>;
  update(
    clientId: string,
    input: OAuthClientUpdateInput,
    request: Request,
  ): Promise<OAuthClientSummary>;
  disable(clientId: string, request: Request): Promise<void>;
  rotateSecret(
    clientId: string,
    request: Request,
  ): Promise<OAuthClientSecretRotated>;
};

type AuthServiceSession = {
  user: {
    id: string;
    email: string;
    name: string;
    role: string | null;
    twoFactorEnabled: boolean;
  } | null;
};

type AuthServiceUser = {
  user: {
    id: string;
    email: string;
    name: string;
    role: string | null;
    isBanned: boolean;
    twoFactorEnabled: boolean;
    emailVerified?: boolean;
  };
};

type AuthServiceUsers = {
  users: AuthServiceUser["user"][];
};

function managedUser(user: AuthServiceUser["user"]): ManagedIdentityUser {
  if (user.role !== "admin" && user.role !== "user") {
    throw new AuthenticationError(
      "AUTHENTICATION_UNAVAILABLE",
      "Authentication service returned an invalid user role",
    );
  }
  return {
    subject: user.id,
    email: user.email,
    displayName: user.name,
    role: user.role,
    isBanned: user.isBanned,
    twoFactorEnabled: user.twoFactorEnabled,
    ...(typeof user.emailVerified === "boolean"
      ? { emailVerified: user.emailVerified }
      : {}),
  };
}

function generatedPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `${btoa(String.fromCharCode(...bytes))}Aa1!`;
}

const ISSUER = "savia:better-auth";

function forwardedHeaders(request: Request): Headers {
  const headers = new Headers();
  for (const name of ["authorization", "cookie"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

async function serviceJson<T>(
  service: AuthService,
  path: string,
  init: RequestInit = {},
  knownConflict?: { code: string; message: string },
): Promise<{ response: Response; body: T }> {
  const response = await service.fetch(
    new Request(`https://savia-auth.internal${path}`, init),
  );
  if (!response.ok) {
    if (knownConflict && response.status === 409) {
      const body = (await response.json().catch(() => undefined)) as
        { error?: { code?: unknown } } | undefined;
      if (body?.error?.code === knownConflict.code) {
        throw new AuthenticationError(
          "IDENTITY_EMAIL_CONFLICT",
          knownConflict.message,
        );
      }
    }
    throw new AuthenticationError(
      "AUTHENTICATION_UNAVAILABLE",
      "Authentication service is unavailable",
    );
  }
  return { response, body: (await response.json()) as T };
}

function userRoleIncludesAdministrator(role: string | null): boolean {
  return (
    role
      ?.split(",")
      .map((entry) => entry.trim())
      .includes("admin") ?? false
  );
}

function hasAdministratorRole(roles: readonly string[]): boolean {
  return roles.includes("admin");
}

function bearerJwt(request: Request): boolean {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  const parts = authorization.slice("Bearer ".length).trim().split(".");
  return parts.length === 3 && parts.every(Boolean);
}

async function actorForIdentity(
  d1: D1Database,
  identity: OAuthAuthenticatedIdentity,
): Promise<AppActor> {
  if (hasAdministratorRole(identity.roles) && !identity.twoFactorEnabled) {
    throw new AuthenticationError(
      "MFA_ENROLLMENT_REQUIRED",
      "Platform administrators must enroll TOTP multi-factor authentication",
    );
  }
  const principal = await upsertPrincipal(d1, {
    issuer: ISSUER,
    subject: identity.subject,
    email: identity.email,
    displayName: identity.displayName,
  });
  let actor = await loadActor(d1, principal);
  if (
    hasAdministratorRole(identity.roles) &&
    (!actor.globalRoles.includes("platform_admin") ||
      !actor.memberships.some(
        (entry) =>
          entry.tenantId === 0 &&
          entry.role === "tenant_admin" &&
          entry.isActive,
      ))
  ) {
    await ensureBootstrapAdministrator(d1, principal.id);
    actor = await loadActor(d1, principal);
  }
  if (!actor.principal.isActive) {
    throw new AuthenticationError(
      "AUTHORIZATION_FORBIDDEN",
      "This user is inactive",
    );
  }
  return actor;
}

export function betterAuthAuthenticator(
  service?: AuthService,
  oauthResource?: OAuthResourceAuthenticator,
  personalKeys?: PersonalApiKeys,
): Authenticator {
  if (!service && !oauthResource && !personalKeys)
    return rejectingAuthenticator;
  return {
    async recordSuccessfulUse(actor) {
      if (actor.credential?.kind === "personal-api-key")
        await personalKeys?.touch(actor.credential.keyId);
    },
    async authenticate(request: Request, d1: D1Database): Promise<AppActor> {
      const authorization = request.headers.get("authorization");
      const personalSecret = authorization?.match(
        /^Bearer (savia_pat_\S+)$/i,
      )?.[1];
      if (personalSecret) {
        if (!personalKeys)
          throw new AuthenticationError(
            "AUTHENTICATION_REQUIRED",
            "A valid Savia credential is required",
          );
        const { actor, key } = await personalKeys.authenticate(personalSecret);
        authorizePersonalApiKeyRequest(request, key.scopes, key.tenantId);
        return {
          ...actor,
          credential: {
            kind: "personal-api-key",
            keyId: key.id,
            tenantId: key.tenantId,
            scopes: key.scopes,
          },
        };
      }
      if (bearerJwt(request)) {
        if (!oauthResource) {
          throw new AuthenticationError(
            "AUTHENTICATION_UNAVAILABLE",
            "OAuth authentication is not configured",
          );
        }
        const identity = await oauthResource.authenticate(request);
        requireOAuthScope(identity, request);
        const actor = await actorForIdentity(d1, identity);
        return {
          ...actor,
          credential: { kind: "oauth", scopes: [...identity.scopes] },
        };
      }
      if (authorization)
        throw new AuthenticationError(
          "AUTHENTICATION_REQUIRED",
          "A valid OAuth access token or Savia API key is required",
        );
      if (!service && !oauthResource)
        return rejectingAuthenticator.authenticate(request, d1);
      if (!service) {
        throw new AuthenticationError(
          "AUTHENTICATION_UNAVAILABLE",
          "Authentication service is unavailable",
        );
      }
      let session: AuthServiceSession;
      try {
        ({ body: session } = await serviceJson<AuthServiceSession>(
          service,
          "/_internal/session",
          { headers: forwardedHeaders(request) },
        ));
      } catch (exception) {
        if (exception instanceof AuthenticationError) throw exception;
        throw new AuthenticationError(
          "AUTHENTICATION_UNAVAILABLE",
          "Authentication service is unavailable",
        );
      }
      if (!session.user) {
        throw new AuthenticationError(
          "AUTHENTICATION_REQUIRED",
          "An active session is required",
        );
      }
      return actorForIdentity(d1, {
        subject: session.user.id,
        email: session.user.email,
        displayName: session.user.name,
        roles: userRoleIncludesAdministrator(session.user.role)
          ? ["admin"]
          : [],
        twoFactorEnabled: session.user.twoFactorEnabled,
        scopes: new Set(),
      });
    },
  };
}

export const rejectingAuthenticator: Authenticator = {
  async authenticate(): Promise<AppActor> {
    throw new AuthenticationError(
      "AUTHENTICATION_UNAVAILABLE",
      "Authentication is not configured",
    );
  },
};

export function betterAuthUserAdministrator(
  service?: AuthService,
  internalBridgeKey?: string,
): IdentityUserAdministrator | undefined {
  if (!service || !internalBridgeKey) return undefined;
  const internalHeaders = (json = false) => {
    const headers = new Headers({ "x-savia-bridge-key": internalBridgeKey });
    if (json) headers.set("content-type", "application/json");
    return headers;
  };
  return {
    issuer: ISSUER,
    async listUsers(request): Promise<ManagedIdentityUser[]> {
      const { body } = await serviceJson<AuthServiceUsers>(
        service,
        "/_internal/users",
        { headers: internalHeaders() },
      );
      return body.users.map(managedUser);
    },
    async getUser(subject, request): Promise<ManagedIdentityUser> {
      const { body } = await serviceJson<AuthServiceUser>(
        service,
        `/_internal/users/${encodeURIComponent(subject)}`,
        { headers: internalHeaders() },
      );
      return managedUser(body.user);
    },
    async createUser(input, request): Promise<CreatedIdentityUser> {
      const { body } = await serviceJson<AuthServiceUser>(
        service,
        "/_internal/users",
        {
          method: "POST",
          headers: internalHeaders(true),
          body: JSON.stringify({
            email: input.email,
            name: `${input.firstName} ${input.lastName}`.trim(),
            password: input.temporaryPassword ?? generatedPassword(),
            role: input.platformAdmin ? "admin" : "user",
            emailVerified: input.emailVerified ?? false,
            ...(input.tenantId === undefined
              ? {}
              : { tenantId: input.tenantId }),
          }),
        },
        {
          code: "IDENTITY_EMAIL_CONFLICT",
          message:
            "An account with this email already exists. Use an existing user or a different email.",
        },
      );
      return managedUser(body.user);
    },
    async updateUser(subject, input, request): Promise<ManagedIdentityUser> {
      const { body } = await serviceJson<AuthServiceUser>(
        service,
        `/_internal/users/${encodeURIComponent(subject)}`,
        {
          method: "PATCH",
          headers: internalHeaders(true),
          body: JSON.stringify({
            ...(input.displayName === undefined
              ? {}
              : { name: input.displayName }),
            ...(input.platformAdmin === undefined
              ? {}
              : { role: input.platformAdmin ? "admin" : "user" }),
            ...(input.emailVerified === undefined
              ? {}
              : { emailVerified: input.emailVerified }),
            ...(input.tenantId === undefined
              ? {}
              : { tenantId: input.tenantId }),
          }),
        },
      );
      return managedUser(body.user);
    },
    async setAccountActive(
      subject,
      isActive,
      request,
    ): Promise<ManagedIdentityUser> {
      const response = await service.fetch(
        new Request(
          `https://savia-auth.internal/_internal/users/${encodeURIComponent(subject)}/ban`,
          {
            method: isActive ? "DELETE" : "POST",
            headers: internalHeaders(),
          },
        ),
      );
      if (!response.ok) {
        throw new AuthenticationError(
          "AUTHENTICATION_UNAVAILABLE",
          "Authentication service is unavailable",
        );
      }
      const body = (await response.json()) as AuthServiceUser;
      return managedUser(body.user);
    },
    async revokeSessions(subject, request): Promise<void> {
      const response = await service.fetch(
        new Request(
          `https://savia-auth.internal/_internal/users/${encodeURIComponent(subject)}/sessions`,
          { method: "POST", headers: internalHeaders() },
        ),
      );
      if (!response.ok) {
        throw new AuthenticationError(
          "AUTHENTICATION_UNAVAILABLE",
          "Authentication service is unavailable",
        );
      }
    },
    async sendPasswordReset(subject, request): Promise<void> {
      const response = await service.fetch(
        new Request(
          `https://savia-auth.internal/_internal/users/${encodeURIComponent(subject)}/password-reset`,
          { method: "POST", headers: internalHeaders() },
        ),
      );
      if (!response.ok) {
        throw new AuthenticationError(
          "AUTHENTICATION_UNAVAILABLE",
          "Authentication service is unavailable",
        );
      }
    },
    async deleteUser(subject, request): Promise<void> {
      const response = await service.fetch(
        new Request(
          `https://savia-auth.internal/_internal/users/${encodeURIComponent(subject)}`,
          { method: "DELETE", headers: internalHeaders() },
        ),
      );
      if (!response.ok && response.status !== 404) {
        throw new AuthenticationError(
          "AUTHENTICATION_UNAVAILABLE",
          "Authentication service is unavailable",
        );
      }
    },
  };
}

export function betterAuthOAuthClientAdministrator(
  service?: AuthService,
): OAuthClientAdministrator | undefined {
  if (!service) return undefined;
  return {
    async list(request) {
      const { body } = await serviceJson<{ data: OAuthClientSummary[] }>(
        service,
        "/_internal/oauth/clients",
        { headers: forwardedHeaders(request) },
      );
      return body.data;
    },
    async create(input, request) {
      const { body } = await serviceJson<{ data: OAuthClientCreated }>(
        service,
        "/_internal/oauth/clients",
        {
          method: "POST",
          headers: {
            ...Object.fromEntries(forwardedHeaders(request)),
            "content-type": "application/json",
          },
          body: JSON.stringify(input),
        },
      );
      return body.data;
    },
    async update(clientId, input, request) {
      const { body } = await serviceJson<{ data: OAuthClientSummary }>(
        service,
        `/_internal/oauth/clients/${encodeURIComponent(clientId)}`,
        {
          method: "PATCH",
          headers: {
            ...Object.fromEntries(forwardedHeaders(request)),
            "content-type": "application/json",
          },
          body: JSON.stringify(input),
        },
      );
      return body.data;
    },
    async disable(clientId, request) {
      const response = await service.fetch(
        new Request(
          `https://savia-auth.internal/_internal/oauth/clients/${encodeURIComponent(clientId)}`,
          { method: "DELETE", headers: forwardedHeaders(request) },
        ),
      );
      if (!response.ok) {
        throw new AuthenticationError(
          "AUTHENTICATION_UNAVAILABLE",
          "Authentication service is unavailable",
        );
      }
    },
    async rotateSecret(clientId, request) {
      const { body } = await serviceJson<{ data: OAuthClientSecretRotated }>(
        service,
        `/_internal/oauth/clients/${encodeURIComponent(clientId)}/rotate-secret`,
        { method: "POST", headers: forwardedHeaders(request) },
      );
      return body.data;
    },
  };
}
