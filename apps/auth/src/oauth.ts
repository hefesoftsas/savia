import type { OAuthOptions, Scope } from "@better-auth/oauth-provider";

export const SAVIA_OAUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "savia.api.read",
  "savia.api.write",
  "offline_access",
] as const;

export const SAVIA_ACCESS_TOKEN_ROLE_CLAIM = "https://savia.hefesoft.com/roles";
export const SAVIA_ACCESS_TOKEN_EMAIL_CLAIM =
  "https://savia.hefesoft.com/email";
export const SAVIA_ACCESS_TOKEN_NAME_CLAIM = "https://savia.hefesoft.com/name";
export const SAVIA_ACCESS_TOKEN_MFA_CLAIM =
  "https://savia.hefesoft.com/two-factor-enabled";

const scalarClientName = "Savia Scalar";
const adminClientName = "Savia Admin";
const apiScopes = [
  "savia.api.read",
  "savia.api.write",
  "offline_access",
] as const;
const providerScopes: Scope[] = [...SAVIA_OAUTH_SCOPES];
const scalarClientScopes = SAVIA_OAUTH_SCOPES.filter(
  (scope) => scope !== "offline_access",
);

type OAuthEnvironment = {
  BETTER_AUTH_URL: string;
  SAVIA_API_RESOURCE?: string;
  SAVIA_ADMIN_REDIRECT_URI?: string;
  SAVIA_SCALAR_REDIRECT_URI?: string;
};

type OAuthBootstrapEnvironment = OAuthEnvironment & {
  BETTER_AUTH_BOOTSTRAP_EMAIL?: string;
  BETTER_AUTH_BOOTSTRAP_PASSWORD?: string;
};

type OAuthClientCreator = {
  api: {
    adminCreateOAuthClient(input: {
      body: {
        application_type: "web" | "native";
        client_name: string;
        client_secret_expires_at: number;
        enable_end_session: boolean;
        grant_types: ["authorization_code"];
        redirect_uris: [string];
        require_pkce: true;
        response_types: ["code"];
        scope: string;
        skip_consent: boolean;
        token_endpoint_auth_method: "none";
      };
      headers: Headers;
    }): Promise<{ client_id: string }>;
    adminLinkClientResource(input: {
      headers: Headers;
      params: { client_id: string; identifier: string };
    }): Promise<{ linked: boolean }>;
  };
  handler(request: Request): Promise<Response>;
};

export type OAuthRuntime = {
  adminClientName: typeof adminClientName;
  adminRedirectUri: string;
  apiResource: string;
  issuer: string;
  scalarClientName: typeof scalarClientName;
  scalarRedirectUri: string;
  scopes: readonly string[];
};

export type ScalarOAuthClient = {
  clientId: string;
  redirectUri: string;
  resource: string;
  scopes: string[];
};

export type AdminOAuthClient = {
  clientId: string;
  redirectUri: string;
  resource: string;
  scopes: string[];
};

type OAuthClientAuthentication =
  "none" | "client_secret_basic" | "client_secret_post";

type OAuthClientInput = {
  clientAuthentication: OAuthClientAuthentication;
  clientName: string;
  redirectUris: string[];
  scopes: string[];
  trusted: boolean;
};

type OAuthClientUpdateInput = Partial<
  Pick<OAuthClientInput, "clientName" | "redirectUris" | "scopes" | "trusted">
>;

type OAuthClientSummary = OAuthClientInput & {
  applicationType: "native" | "web";
  clientId: string;
};

type OAuthClientCreated = OAuthClientSummary & { clientSecret?: string };

export type OAuthManagementAuth = {
  api: {
    adminCreateOAuthClient(input: {
      body: Record<string, unknown>;
      headers: Headers;
    }): Promise<Record<string, unknown>>;
    adminUpdateOAuthClient(input: {
      body: Record<string, unknown>;
      headers: Headers;
    }): Promise<Record<string, unknown>>;
    deleteOAuthClient(input: {
      body: Record<string, unknown>;
      headers: Headers;
    }): Promise<unknown>;
    getSession(input: {
      headers: Headers;
    }): Promise<{ user: Record<string, unknown> } | null>;
    rotateClientSecret(input: {
      body: Record<string, unknown>;
      headers: Headers;
    }): Promise<Record<string, unknown>>;
  };
};

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}

function normalizedUrl(value: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(name + " must be a valid absolute URL");
  }
  if (url.username || url.password || url.hash) {
    throw new Error(name + " must not contain credentials or a fragment");
  }
  if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
    throw new Error(name + " must use HTTPS outside local loopback");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(name + " must use HTTP(S)");
  }
  return url;
}

function scalarApplicationType(redirectUri: string): "web" | "native" {
  return normalizedUrl(redirectUri, "SAVIA_SCALAR_REDIRECT_URI").protocol ===
    "http:"
    ? "native"
    : "web";
}

function canonicalUrl(url: URL): string {
  return url.pathname === "/" && !url.search
    ? url.origin
    : url.toString().replace(/\/$/, "");
}

function isSaviaScope(scope: string): boolean {
  return (SAVIA_OAUTH_SCOPES as readonly string[]).includes(scope);
}

function parseArray(value: unknown): string[] {
  if (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string")
  ) {
    return value;
  }
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) &&
      parsed.every((entry) => typeof entry === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function managementInput(
  value: unknown,
  partial = false,
): OAuthClientInput | OAuthClientUpdateInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid OAuth client input");
  }
  const input = value as Record<string, unknown>;
  if ("clientSecret" in input)
    throw new Error("Client secrets cannot be supplied");
  const supplied = (name: string) => input[name] !== undefined;
  if (!partial || supplied("clientName")) {
    if (typeof input.clientName !== "string" || !input.clientName.trim()) {
      throw new Error("clientName is required");
    }
  }
  if (!partial || supplied("redirectUris")) {
    if (!Array.isArray(input.redirectUris) || input.redirectUris.length === 0) {
      throw new Error("At least one redirect URI is required");
    }
    for (const redirectUri of input.redirectUris) {
      if (typeof redirectUri !== "string")
        throw new Error("Invalid redirect URI");
      const url = normalizedUrl(redirectUri, "redirect URI");
      if (url.hostname.includes("*"))
        throw new Error("Wildcard redirect URIs are not allowed");
    }
  }
  if (!partial || supplied("scopes")) {
    if (
      !Array.isArray(input.scopes) ||
      input.scopes.length === 0 ||
      input.scopes.some(
        (scope) => typeof scope !== "string" || !isSaviaScope(scope),
      )
    ) {
      throw new Error("OAuth scopes must be Savia scopes");
    }
  }
  if (!partial || supplied("trusted")) {
    if (typeof input.trusted !== "boolean")
      throw new Error("trusted must be boolean");
  }
  if (partial) {
    if (!Object.keys(input).length)
      throw new Error("At least one field is required");
    return {
      ...(supplied("clientName")
        ? { clientName: input.clientName as string }
        : {}),
      ...(supplied("redirectUris")
        ? { redirectUris: input.redirectUris as string[] }
        : {}),
      ...(supplied("scopes") ? { scopes: input.scopes as string[] } : {}),
      ...(supplied("trusted") ? { trusted: input.trusted as boolean } : {}),
    };
  }
  if (
    input.clientAuthentication !== "none" &&
    input.clientAuthentication !== "client_secret_basic" &&
    input.clientAuthentication !== "client_secret_post"
  ) {
    throw new Error("An explicit client authentication method is required");
  }
  return {
    clientAuthentication: input.clientAuthentication,
    clientName: input.clientName as string,
    redirectUris: input.redirectUris as string[],
    scopes: input.scopes as string[],
    trusted: input.trusted as boolean,
  };
}

function applicationType(redirectUris: string[]): "native" | "web" {
  const types = new Set(redirectUris.map(scalarApplicationType));
  if (types.size !== 1)
    throw new Error("Redirect URIs must use one application type");
  return [...types][0];
}

function summaryFromRow(row: Record<string, unknown>): OAuthClientSummary {
  const clientAuthentication = row.tokenEndpointAuthMethod;
  if (
    clientAuthentication !== "none" &&
    clientAuthentication !== "client_secret_basic" &&
    clientAuthentication !== "client_secret_post"
  ) {
    throw new Error("Unsupported OAuth client authentication method");
  }
  const applicationType = row.applicationType;
  if (applicationType !== "native" && applicationType !== "web") {
    throw new Error("Unsupported OAuth client application type");
  }
  if (typeof row.clientId !== "string" || typeof row.name !== "string") {
    throw new Error("Invalid OAuth client record");
  }
  return {
    applicationType,
    clientAuthentication,
    clientId: row.clientId,
    clientName: row.name,
    redirectUris: parseArray(row.redirectUris),
    scopes: parseArray(row.scopes),
    trusted: row.skipConsent === true || row.skipConsent === 1,
  };
}

async function requireOAuthAdministrator(
  auth: OAuthManagementAuth,
  request: Request,
): Promise<void> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session || !roleEntries(session.user).includes("admin")) {
    throw new Error("OAuth client administration requires an administrator");
  }
}

async function findOAuthClient(
  database: D1Database,
  clientId: string,
): Promise<OAuthClientSummary | undefined> {
  const row = await database
    .prepare(
      'SELECT "clientId", name, "redirectUris", scopes, "tokenEndpointAuthMethod", "applicationType", "skipConsent" FROM "oauthClient" WHERE "clientId" = ? LIMIT 1',
    )
    .bind(clientId)
    .first<Record<string, unknown>>();
  return row ? summaryFromRow(row) : undefined;
}

async function requireMutableOAuthClient(
  database: D1Database,
  clientId: string,
): Promise<OAuthClientSummary> {
  const client = await findOAuthClient(database, clientId);
  if (!client) throw new Error("OAuth client not found");
  if (
    client.clientName === scalarClientName ||
    client.clientName === adminClientName
  ) {
    throw new Error("Fixed Savia OAuth clients cannot be changed");
  }
  return client;
}

export async function oauthManagementResponse(
  auth: OAuthManagementAuth,
  database: D1Database,
  request: Request,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/_internal/oauth/clients")) return undefined;
  if (url.hostname !== "savia-auth.internal") {
    return Response.json(
      { error: { code: "NOT_FOUND", message: "Not found" } },
      { status: 404 },
    );
  }
  try {
    await requireOAuthAdministrator(auth, request);
    if (
      request.method === "GET" &&
      url.pathname === "/_internal/oauth/clients"
    ) {
      const rows = await database
        .prepare(
          'SELECT "clientId", name, "redirectUris", scopes, "tokenEndpointAuthMethod", "applicationType", "skipConsent" FROM "oauthClient" ORDER BY name',
        )
        .all<Record<string, unknown>>();
      return Response.json({ data: rows.results.map(summaryFromRow) });
    }
    if (
      request.method === "POST" &&
      url.pathname === "/_internal/oauth/clients"
    ) {
      const input = managementInput(await request.json()) as OAuthClientInput;
      const type = applicationType(input.redirectUris);
      const created = await auth.api.adminCreateOAuthClient({
        headers: request.headers,
        body: {
          application_type: type,
          client_name: input.clientName,
          client_secret_expires_at: 0,
          enable_end_session: true,
          grant_types: ["authorization_code"],
          redirect_uris: input.redirectUris,
          require_pkce: true,
          response_types: ["code"],
          scope: input.scopes.join(" "),
          skip_consent: input.trusted,
          token_endpoint_auth_method: input.clientAuthentication,
        },
      });
      const clientId = created.client_id;
      if (typeof clientId !== "string")
        throw new Error("OAuth client id was not returned");
      const data: OAuthClientCreated = {
        applicationType: type,
        ...input,
        clientId,
        ...(input.clientAuthentication === "none" ||
        typeof created.client_secret !== "string"
          ? {}
          : { clientSecret: created.client_secret }),
      };
      return Response.json({ data }, { status: 201 });
    }
    const match = url.pathname.match(
      /^\/_internal\/oauth\/clients\/([^/]+)(\/rotate-secret)?$/,
    );
    if (!match) return undefined;
    const clientId = decodeURIComponent(match[1]);
    const client = await requireMutableOAuthClient(database, clientId);
    if (request.method === "PATCH" && !match[2]) {
      const update = managementInput(
        await request.json(),
        true,
      ) as OAuthClientUpdateInput;
      const combined: OAuthClientInput = { ...client, ...update };
      const type = applicationType(combined.redirectUris);
      const updated = await auth.api.adminUpdateOAuthClient({
        headers: request.headers,
        body: {
          client_id: clientId,
          update: {
            application_type: type,
            client_name: combined.clientName,
            redirect_uris: combined.redirectUris,
            scope: combined.scopes.join(" "),
            skip_consent: combined.trusted,
          },
        },
      });
      void updated;
      return Response.json({
        data: { ...combined, applicationType: type, clientId },
      });
    }
    if (request.method === "DELETE" && !match[2]) {
      await auth.api.deleteOAuthClient({
        headers: request.headers,
        body: { client_id: clientId },
      });
      return new Response(null, { status: 204 });
    }
    if (request.method === "POST" && match[2]) {
      if (client.clientAuthentication === "none")
        throw new Error("Public clients do not have secrets");
      const rotated = await auth.api.rotateClientSecret({
        headers: request.headers,
        body: { client_id: clientId },
      });
      if (typeof rotated.client_secret !== "string")
        throw new Error("OAuth client secret was not returned");
      return Response.json({
        data: { clientId, clientSecret: rotated.client_secret },
      });
    }
    return undefined;
  } catch (error) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Invalid OAuth client input",
        },
      },
      { status: 400 },
    );
  }
}

function roleEntries(user: Record<string, unknown>): string[] {
  const role = user.role;
  return typeof role === "string"
    ? role
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

export function oauthRuntime(environment: OAuthEnvironment): OAuthRuntime {
  const authBase = normalizedUrl(
    environment.BETTER_AUTH_URL,
    "BETTER_AUTH_URL",
  );
  const apiResource = canonicalUrl(
    normalizedUrl(
      environment.SAVIA_API_RESOURCE ?? authBase.origin,
      "SAVIA_API_RESOURCE",
    ),
  );
  const scalarRedirect = normalizedUrl(
    environment.SAVIA_SCALAR_REDIRECT_URI ??
      new URL("/docs", authBase.origin).toString(),
    "SAVIA_SCALAR_REDIRECT_URI",
  );
  if (scalarRedirect.origin !== authBase.origin) {
    throw new Error(
      "SAVIA_SCALAR_REDIRECT_URI must use the public Savia origin",
    );
  }
  const adminRedirect = normalizedUrl(
    environment.SAVIA_ADMIN_REDIRECT_URI ??
      "http://127.0.0.1:5173/auth/callback",
    "SAVIA_ADMIN_REDIRECT_URI",
  );
  return {
    adminClientName,
    adminRedirectUri: canonicalUrl(adminRedirect),
    issuer: new URL("/api/auth", authBase.origin).toString().replace(/\/$/, ""),
    apiResource,
    scalarClientName,
    scalarRedirectUri: canonicalUrl(scalarRedirect),
    scopes: SAVIA_OAUTH_SCOPES,
  };
}

export function oauthProviderOptions(
  environment: OAuthEnvironment,
): OAuthOptions<Scope[]> {
  const runtime = oauthRuntime(environment);
  return {
    loginPage: "/api/auth/login",
    consentPage: "/api/auth/consent",
    grantTypes: ["authorization_code", "refresh_token"],
    scopes: providerScopes,
    resources: [
      {
        identifier: runtime.apiResource,
        name: "Savia Domain API",
        allowedScopes: [...apiScopes],
        accessTokenTtl: 300,
      },
    ],
    resourceSeedMode: "merge",
    clientRegistrationDefaultResources: [runtime.apiResource],
    accessTokenExpiresIn: 300,
    clientPrivileges: ({ user }) =>
      roleEntries(user as Record<string, unknown>).includes("admin"),
    postLogin: {
      page: "/api/auth/mfa-enroll",
      consentReferenceId: () => undefined,
      shouldRedirect: ({ user }) => {
        const details = user as Record<string, unknown>;
        return (
          roleEntries(details).includes("admin") &&
          details.twoFactorEnabled !== true
        );
      },
    },
    customAccessTokenClaims: ({ user }) => {
      if (!user) return {};
      const details = user as Record<string, unknown>;
      return {
        [SAVIA_ACCESS_TOKEN_ROLE_CLAIM]: roleEntries(details),
        [SAVIA_ACCESS_TOKEN_EMAIL_CLAIM]:
          typeof details.email === "string" ? details.email : undefined,
        [SAVIA_ACCESS_TOKEN_NAME_CLAIM]:
          typeof details.name === "string" ? details.name : undefined,
        [SAVIA_ACCESS_TOKEN_MFA_CLAIM]: details.twoFactorEnabled === true,
      };
    },
  };
}

export async function ensureScalarOAuthClient(
  auth: OAuthClientCreator,
  database: D1Database,
  environment: OAuthBootstrapEnvironment,
): Promise<ScalarOAuthClient> {
  const runtime = oauthRuntime(environment);
  const existing = await database
    .prepare(
      'SELECT "clientId" AS client_id, "redirectUris" AS redirect_uris FROM "oauthClient" WHERE name = ? LIMIT 1',
    )
    .bind(runtime.scalarClientName)
    .first<{ client_id: string; redirect_uris: unknown }>();
  const clientId =
    existing?.client_id ??
    (await createScalarOAuthClient(auth, environment, runtime));
  if (existing) {
    await ensureFixedClientRedirectUri(
      database,
      existing.client_id,
      existing.redirect_uris,
      runtime.scalarRedirectUri,
    );
  }
  await ensureFixedClientResource(database, runtime, clientId);
  return {
    clientId,
    redirectUri: runtime.scalarRedirectUri,
    resource: runtime.apiResource,
    scopes: [...scalarClientScopes],
  };
}

export async function ensureAdminOAuthClient(
  auth: OAuthClientCreator,
  database: D1Database,
  environment: OAuthBootstrapEnvironment,
): Promise<AdminOAuthClient> {
  const runtime = oauthRuntime(environment);
  const existing = await database
    .prepare(
      'SELECT "clientId" AS client_id, scopes, "redirectUris" AS redirect_uris FROM "oauthClient" WHERE name = ? LIMIT 1',
    )
    .bind(runtime.adminClientName)
    .first<{
      client_id: string;
      redirect_uris: unknown;
      scopes: unknown;
    }>();
  const clientId =
    existing?.client_id ??
    (await createAdminOAuthClient(auth, environment, runtime));
  if (existing && !parseArray(existing.scopes).includes("offline_access")) {
    await database
      .prepare('UPDATE "oauthClient" SET scopes = ? WHERE "clientId" = ?')
      .bind(JSON.stringify([...runtime.scopes]), clientId)
      .run();
  }
  if (existing) {
    await ensureFixedClientRedirectUri(
      database,
      existing.client_id,
      existing.redirect_uris,
      runtime.adminRedirectUri,
    );
  }
  await ensureFixedClientResource(database, runtime, clientId);
  return {
    clientId,
    redirectUri: runtime.adminRedirectUri,
    resource: runtime.apiResource,
    scopes: [...runtime.scopes],
  };
}

async function bootstrapAdministratorHeaders(
  auth: OAuthClientCreator,
  environment: OAuthBootstrapEnvironment,
): Promise<Headers> {
  const email = environment.BETTER_AUTH_BOOTSTRAP_EMAIL;
  const password = environment.BETTER_AUTH_BOOTSTRAP_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "BETTER_AUTH_BOOTSTRAP_EMAIL and BETTER_AUTH_BOOTSTRAP_PASSWORD are required to configure fixed Savia OAuth clients",
    );
  }
  const signIn = await auth.handler(
    new Request(
      new URL("/api/auth/sign-in/email", environment.BETTER_AUTH_URL),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: new URL(environment.BETTER_AUTH_URL).origin,
        },
        body: JSON.stringify({ email, password }),
      },
    ),
  );
  const cookie = signIn.headers.get("set-cookie")?.split(";", 1)[0];
  if (!signIn.ok || !cookie) {
    throw new Error("Unable to establish the bootstrap administrator session");
  }
  return new Headers({ cookie });
}

async function ensureFixedClientResource(
  database: D1Database,
  runtime: OAuthRuntime,
  clientId: string,
): Promise<void> {
  const existing = await database
    .prepare(
      'SELECT 1 FROM "oauthClientResource" WHERE "clientId" = ? AND "resourceId" = ? LIMIT 1',
    )
    .bind(clientId, runtime.apiResource)
    .first();
  if (existing) return;
  await database
    .prepare(
      'INSERT OR IGNORE INTO "oauthClientResource" (id, "clientId", "resourceId", "createdAt") VALUES (?, ?, ?, ?)',
    )
    .bind(
      crypto.randomUUID(),
      clientId,
      runtime.apiResource,
      new Date().toISOString(),
    )
    .run();
}

async function ensureFixedClientRedirectUri(
  database: D1Database,
  clientId: string,
  currentRedirectUris: unknown,
  redirectUri: string,
): Promise<void> {
  const current = parseArray(currentRedirectUris);
  if (current.length === 1 && current[0] === redirectUri) return;
  await database
    .prepare('UPDATE "oauthClient" SET "redirectUris" = ? WHERE "clientId" = ?')
    .bind(JSON.stringify([redirectUri]), clientId)
    .run();
}

async function createScalarOAuthClient(
  auth: OAuthClientCreator,
  environment: OAuthBootstrapEnvironment,
  runtime: OAuthRuntime,
): Promise<string> {
  const created = await auth.api.adminCreateOAuthClient({
    headers: await bootstrapAdministratorHeaders(auth, environment),
    body: {
      application_type: scalarApplicationType(runtime.scalarRedirectUri),
      client_name: runtime.scalarClientName,
      client_secret_expires_at: 0,
      enable_end_session: true,
      grant_types: ["authorization_code"],
      redirect_uris: [runtime.scalarRedirectUri],
      require_pkce: true,
      response_types: ["code"],
      scope: [...scalarClientScopes].join(" "),
      skip_consent: true,
      token_endpoint_auth_method: "none",
    },
  });
  if (typeof created.client_id !== "string") {
    throw new Error("Better Auth did not return the Savia Scalar client id");
  }
  return created.client_id;
}

async function createAdminOAuthClient(
  auth: OAuthClientCreator,
  environment: OAuthBootstrapEnvironment,
  runtime: OAuthRuntime,
): Promise<string> {
  const created = await auth.api.adminCreateOAuthClient({
    headers: await bootstrapAdministratorHeaders(auth, environment),
    body: {
      application_type: scalarApplicationType(runtime.adminRedirectUri),
      client_name: runtime.adminClientName,
      client_secret_expires_at: 0,
      enable_end_session: true,
      grant_types: ["authorization_code"],
      redirect_uris: [runtime.adminRedirectUri],
      require_pkce: true,
      response_types: ["code"],
      scope: [...runtime.scopes].join(" "),
      skip_consent: true,
      token_endpoint_auth_method: "none",
    },
  });
  if (typeof created.client_id !== "string") {
    throw new Error("Better Auth did not return the Savia Admin client id");
  }
  return created.client_id;
}
