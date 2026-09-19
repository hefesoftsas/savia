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
    input: { displayName?: string; platformAdmin?: boolean },
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
  redirectUris: string[];
  scopes: string[];
  trusted: boolean;
};

export type OAuthClientCreateInput = {
  clientAuthentication: OAuthClientAuthentication;
  clientName: string;
  redirectUris: string[];
  scopes: string[];
  trusted: boolean;
};

export type OAuthClientUpdateInput = Partial<
  Pick<
    OAuthClientCreateInput,
    "clientName" | "redirectUris" | "scopes" | "trusted"
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

function sessionHeaders(request: Request): Headers {
  const headers = new Headers();
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  return headers;
}

async function serviceJson<T>(
  service: AuthService,
  path: string,
  init: RequestInit = {},
): Promise<{ response: Response; body: T }> {
  const response = await service.fetch(
    new Request(`https://savia-auth.internal${path}`, init),
  );
  if (!response.ok) {
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
  if (hasAdministratorRole(identity.roles)) {
    await ensureBootstrapAdministrator(d1, principal.id);
  }
  const actor = await loadActor(d1, principal);
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
): Authenticator {
  if (!service && !oauthResource) return rejectingAuthenticator;
  return {
    async authenticate(request: Request, d1: D1Database): Promise<AppActor> {
      if (bearerJwt(request)) {
        if (!oauthResource) {
          throw new AuthenticationError(
            "AUTHENTICATION_UNAVAILABLE",
            "OAuth authentication is not configured",
          );
        }
        const identity = await oauthResource.authenticate(request);
        requireOAuthScope(identity, request);
        return actorForIdentity(d1, identity);
      }
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
): IdentityUserAdministrator | undefined {
  if (!service) return undefined;
  return {
    issuer: ISSUER,
    async listUsers(request): Promise<ManagedIdentityUser[]> {
      const { body } = await serviceJson<AuthServiceUsers>(
        service,
        "/_internal/users",
        { headers: sessionHeaders(request) },
      );
      return body.users.map(managedUser);
    },
    async getUser(subject, request): Promise<ManagedIdentityUser> {
      const { body } = await serviceJson<AuthServiceUser>(
        service,
        `/_internal/users/${encodeURIComponent(subject)}`,
        { headers: sessionHeaders(request) },
      );
      return managedUser(body.user);
    },
    async createUser(input, request): Promise<CreatedIdentityUser> {
      const { body } = await serviceJson<AuthServiceUser>(
        service,
        "/_internal/users",
        {
          method: "POST",
          headers: {
            ...Object.fromEntries(sessionHeaders(request)),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            email: input.email,
            name: `${input.firstName} ${input.lastName}`.trim(),
            password: input.temporaryPassword ?? generatedPassword(),
            role: input.platformAdmin ? "admin" : "user",
          }),
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
          headers: {
            ...Object.fromEntries(sessionHeaders(request)),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            ...(input.displayName === undefined
              ? {}
              : { name: input.displayName }),
            ...(input.platformAdmin === undefined
              ? {}
              : { role: input.platformAdmin ? "admin" : "user" }),
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
            headers: sessionHeaders(request),
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
          { method: "POST", headers: sessionHeaders(request) },
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
          { method: "POST", headers: sessionHeaders(request) },
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
          { method: "DELETE", headers: sessionHeaders(request) },
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
