import { exchangeMcpToken } from "./mcp-exchange";
import { oauthRuntime } from "./oauth";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { admin, bearer, jwt, twoFactor } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import {
  cookieDomainForHost,
  isAllowedPublicOrigin,
  normalizeCanonicalHost,
} from "@savia/tenant-host/tenant-host";
import { toString as qrCodeSvg } from "qrcode";
import {
  ensureAdminOAuthClient,
  ensureScalarOAuthClient,
  oauthManagementResponse,
  oauthProviderOptions,
  type AdminOAuthClient,
  type OAuthManagementAuth,
  type ScalarOAuthClient,
} from "./oauth";
import { oauthPageResponse, tenantBrandingFromHeader } from "./oauth-pages";
import { deliverSmtpEmail, type SMTPEmail, type SMTPSettings } from "./smtp";
import {
  ackAuthNoticeEvents,
  authNoticeBridgeAuthorized,
  ensureAuthNoticeSchema,
  readAuthNoticeEvents,
} from "./notification-events";

export type AuthWorkerEnvironment = {
  AUTH_DB: D1Database;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_BOOTSTRAP_EMAIL?: string;
  BETTER_AUTH_BOOTSTRAP_PASSWORD?: string;
  BETTER_AUTH_BOOTSTRAP_NAME?: string;
  SAVIA_API_RESOURCE?: string;
  SAVIA_ADMIN_REDIRECT_URI?: string;
  SAVIA_SCALAR_REDIRECT_URI?: string;
  SAVIA_SMTP_HOST?: string;
  SAVIA_SMTP_PORT?: string;
  SAVIA_SMTP_USERNAME?: string;
  SAVIA_SMTP_PASSWORD?: string;
  SAVIA_SMTP_FROM?: string;
  SAVIA_INTERNAL_BRIDGE_KEY?: string;
};

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: string | null;
  isBanned: boolean;
  twoFactorEnabled: boolean;
};

export type TransactionalEmailSender = (email: SMTPEmail) => Promise<void>;

export type AuthDependencies = {
  database?: import("better-auth").BetterAuthOptions["database"];
  sendTransactionalEmail?: TransactionalEmailSender;
};

const schemaInitializations = new WeakMap<object, Promise<void>>();
const noticeSchemaInitialized = new WeakSet<object>();

function requiredValue(value: string | undefined, name: string): string {
  if (value) return value;
  throw new Error(`${name} is required`);
}

function smtpSettings(
  environment: AuthWorkerEnvironment,
): SMTPSettings | undefined {
  const values = {
    host: environment.SAVIA_SMTP_HOST,
    username: environment.SAVIA_SMTP_USERNAME,
    password: environment.SAVIA_SMTP_PASSWORD,
    from: environment.SAVIA_SMTP_FROM,
  };
  if (Object.values(values).every((value) => !value)) return undefined;
  if (Object.values(values).some((value) => !value))
    throw new Error("SAVIA_SMTP configuration is incomplete");
  const port = Number(environment.SAVIA_SMTP_PORT ?? "465");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("SAVIA_SMTP_PORT must be a valid TCP port");
  return {
    host: requiredValue(values.host, "SAVIA_SMTP_HOST"),
    port,
    username: requiredValue(values.username, "SAVIA_SMTP_USERNAME"),
    password: requiredValue(values.password, "SAVIA_SMTP_PASSWORD"),
    from: requiredValue(values.from, "SAVIA_SMTP_FROM"),
  };
}

function adminLoginUrl(environment: AuthWorkerEnvironment): string {
  const url = new URL(
    environment.SAVIA_ADMIN_REDIRECT_URI ??
      "http://127.0.0.1:5173/auth/callback",
  );
  url.pathname = "/";
  url.search = "";
  url.hash = "/login";
  return url.toString();
}

function passwordResetEmail(url: string, email: string): SMTPEmail {
  return {
    to: email,
    subject: "Restablece tu contraseña de Savia",
    text: [
      "Recibimos una solicitud para restablecer tu contraseña de Savia.",
      "",
      "Abre este enlace para definir una nueva contraseña:",
      url,
      "",
      "El enlace caduca en 15 minutos. Si no solicitaste este cambio, ignora este correo.",
    ].join("\n"),
  };
}

function userDocument(value: unknown): AuthenticatedUser {
  const candidate =
    value && typeof value === "object" && "user" in value
      ? (value as { user: unknown }).user
      : value;
  if (!candidate || typeof candidate !== "object")
    throw new Error("Better Auth returned an invalid user");
  const user = candidate as Record<string, unknown>;
  if (
    typeof user.id !== "string" ||
    typeof user.email !== "string" ||
    typeof user.name !== "string"
  ) {
    throw new Error("Better Auth returned an incomplete user");
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: typeof user.image === "string" ? user.image : null,
    role: typeof user.role === "string" ? user.role : null,
    isBanned: user.banned === true,
    twoFactorEnabled: user.twoFactorEnabled === true,
  };
}

export function createBetterAuth(
  environment: AuthWorkerEnvironment,
  dependencies: AuthDependencies = {},
) {
  const sendTransactionalEmail =
    dependencies.sendTransactionalEmail ??
    (() => {
      const settings = smtpSettings(environment);
      return settings
        ? (email: SMTPEmail) => deliverSmtpEmail(settings, email)
        : undefined;
    })();
  return betterAuth({
    basePath: "/api/auth",
    baseURL: requiredValue(environment.BETTER_AUTH_URL, "BETTER_AUTH_URL"),
    trustedOrigins: (request?: Request) => {
      const defaultOrigin = new URL(adminLoginUrl(environment)).origin;
      const canonical = normalizeCanonicalHost(new URL(defaultOrigin).hostname);
      const wildcard = `https://*.${canonical}`;
      const origin = request?.headers?.get("origin");
      if (origin && isAllowedPublicOrigin(origin, canonical)) {
        return [defaultOrigin, wildcard, origin];
      }
      return [defaultOrigin, wildcard];
    },
    database: dependencies.database ?? environment.AUTH_DB,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      resetPasswordTokenExpiresIn: 900,
      revokeSessionsOnPasswordReset: true,
      ...(sendTransactionalEmail
        ? {
            sendResetPassword: async ({ user, url }) =>
              sendTransactionalEmail(passwordResetEmail(url, user.email)),
          }
        : {}),
    },
    plugins: [
      admin(),
      twoFactor({
        issuer: "Savia",
        twoFactorCookieMaxAge: 300,
        accountLockout: {
          maxFailedAttempts: 5,
          durationSeconds: 900,
        },
      }),
      bearer({ requireSignature: true }),
      jwt(),
      oauthProvider(oauthProviderOptions(environment)),
    ],
    secret: requiredValue(environment.BETTER_AUTH_SECRET, "BETTER_AUTH_SECRET"),
    advanced: {
      cookiePrefix: "savia",
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      ...(() => {
        const canonical = normalizeCanonicalHost(
          new URL(adminLoginUrl(environment)).hostname,
        );
        const domain = cookieDomainForHost(canonical, canonical);
        return domain
          ? { crossSubDomainCookies: { enabled: true, domain } }
          : {};
      })(),
    },
  });
}

async function ensureSchema(
  auth: ReturnType<typeof createBetterAuth>,
  database: D1Database,
): Promise<void> {
  const existing = schemaInitializations.get(database);
  if (existing) return existing;
  const initialization = getMigrations(auth.options)
    .then(({ runMigrations }) => runMigrations())
    .then(() => {
      if (!noticeSchemaInitialized.has(database)) {
        noticeSchemaInitialized.add(database);
        return ensureAuthNoticeSchema(database);
      }
    });
  schemaInitializations.set(database, initialization);
  return initialization;
}

/** Initialize native auth schema without creating users, sessions or OAuth clients. */
export async function initializeAuthSchema(
  environment: AuthWorkerEnvironment,
  dependencies: AuthDependencies = {},
): Promise<void> {
  await ensureSchema(
    createBetterAuth(environment, dependencies),
    environment.AUTH_DB,
  );
}

const LOCAL_SEED_USERS = [
  {
    email: "agency-admin-flow-20260902@savia.test",
    name: "Agencia Administración",
    role: "user" as const,
  },
  {
    email: "agency-viewer-flow-20260902@savia.test",
    name: "Agencia Consulta",
    role: "user" as const,
  },
];

async function ensureLocalSeedUser(
  auth: ReturnType<typeof createBetterAuth>,
  environment: AuthWorkerEnvironment,
  account: {
    email: string;
    name: string;
    password: string;
    role: "admin" | "user";
  },
): Promise<void> {
  const existing = await environment.AUTH_DB.prepare(
    'SELECT id FROM "user" WHERE email = ? LIMIT 1',
  )
    .bind(account.email)
    .first<{ id: string }>();
  if (existing) return;
  try {
    await auth.api.createUser({
      body: {
        email: account.email,
        name: account.name,
        password: account.password,
        role: account.role,
      },
    });
  } catch (exception) {
    const concurrent = await environment.AUTH_DB.prepare(
      'SELECT id FROM "user" WHERE email = ? LIMIT 1',
    )
      .bind(account.email)
      .first<{ id: string }>();
    if (!concurrent) throw exception;
  }
}

async function ensureBootstrapAdministrator(
  auth: ReturnType<typeof createBetterAuth>,
  environment: AuthWorkerEnvironment,
): Promise<void> {
  const email = environment.BETTER_AUTH_BOOTSTRAP_EMAIL;
  const password = environment.BETTER_AUTH_BOOTSTRAP_PASSWORD;
  if (!email || !password) return;
  await ensureLocalSeedUser(auth, environment, {
    email,
    name: environment.BETTER_AUTH_BOOTSTRAP_NAME ?? "Savia Administrator",
    password,
    role: "admin",
  });
  for (const account of LOCAL_SEED_USERS) {
    await ensureLocalSeedUser(auth, environment, { ...account, password });
  }
}

async function internalSession(
  auth: ReturnType<typeof createBetterAuth>,
  request: Request,
): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  return Response.json({ user: session ? userDocument(session.user) : null });
}

async function scalarOAuthClient(
  auth: ReturnType<typeof createBetterAuth>,
  environment: AuthWorkerEnvironment,
): Promise<Response> {
  const client: ScalarOAuthClient = await ensureScalarOAuthClient(
    auth,
    environment.AUTH_DB,
    environment,
  );
  return Response.json(client);
}

async function adminOAuthClient(
  auth: ReturnType<typeof createBetterAuth>,
  environment: AuthWorkerEnvironment,
): Promise<Response> {
  const client: AdminOAuthClient = await ensureAdminOAuthClient(
    auth,
    environment.AUTH_DB,
    environment,
  );
  return Response.json(client);
}

async function createUser(
  auth: ReturnType<typeof createBetterAuth>,
  request: Request,
): Promise<Response> {
  const input = (await request.json()) as {
    email?: unknown;
    name?: unknown;
    password?: unknown;
    role?: unknown;
  };
  if (
    typeof input.email !== "string" ||
    typeof input.name !== "string" ||
    typeof input.password !== "string" ||
    (input.role !== undefined &&
      input.role !== "admin" &&
      input.role !== "user")
  ) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid user input" } },
      { status: 400 },
    );
  }
  const created = await auth.api.createUser({
    body: {
      email: input.email,
      name: input.name,
      password: input.password,
      role: input.role ?? "user",
    },
    headers: request.headers,
  });
  return Response.json({ user: userDocument(created) }, { status: 201 });
}

async function listUsers(
  auth: ReturnType<typeof createBetterAuth>,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const searchValue = url.searchParams.get("q")?.trim() || undefined;
  const limit = Number(url.searchParams.get("limit") ?? "100");
  const offset = Number(url.searchParams.get("offset") ?? "0");
  const users = await auth.api.listUsers({
    query: {
      ...(searchValue
        ? {
            searchValue,
            searchField: "email" as const,
            searchOperator: "contains" as const,
          }
        : {}),
      limit: Number.isInteger(limit) && limit > 0 ? limit : 100,
      offset: Number.isInteger(offset) && offset >= 0 ? offset : 0,
      sortBy: "name",
      sortDirection: "asc",
    },
    headers: request.headers,
  });
  return Response.json({
    users: users.users.map(userDocument),
    total: users.total,
  });
}

async function getUser(
  auth: ReturnType<typeof createBetterAuth>,
  request: Request,
  userId: string,
): Promise<Response> {
  const user = await auth.api.getUser({
    query: { id: userId },
    headers: request.headers,
  });
  return Response.json({ user: userDocument(user) });
}

async function updateUser(
  auth: ReturnType<typeof createBetterAuth>,
  request: Request,
  userId: string,
): Promise<Response> {
  const input = (await request.json()) as { name?: unknown; role?: unknown };
  if (
    (input.name !== undefined && typeof input.name !== "string") ||
    (input.role !== undefined &&
      input.role !== "admin" &&
      input.role !== "user") ||
    (input.name === undefined && input.role === undefined)
  ) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid user update" } },
      { status: 400 },
    );
  }
  if (typeof input.name === "string") {
    await auth.api.adminUpdateUser({
      body: { userId, data: { name: input.name } },
      headers: request.headers,
    });
  }
  if (input.role === "admin" || input.role === "user") {
    await auth.api.setRole({
      body: { userId, role: input.role },
      headers: request.headers,
    });
  }
  return getUser(auth, request, userId);
}

async function banUser(
  auth: ReturnType<typeof createBetterAuth>,
  request: Request,
  userId: string,
): Promise<Response> {
  await auth.api.banUser({
    body: { userId, banReason: "Disabled by Savia platform administrator" },
    headers: request.headers,
  });
  return getUser(auth, request, userId);
}

async function unbanUser(
  auth: ReturnType<typeof createBetterAuth>,
  request: Request,
  userId: string,
): Promise<Response> {
  await auth.api.unbanUser({ body: { userId }, headers: request.headers });
  return getUser(auth, request, userId);
}

async function revokeUserSessions(
  auth: ReturnType<typeof createBetterAuth>,
  request: Request,
  userId: string,
): Promise<Response> {
  await auth.api.revokeUserSessions({
    body: { userId },
    headers: request.headers,
  });
  return new Response(null, { status: 204 });
}

async function sendPasswordReset(
  auth: ReturnType<typeof createBetterAuth>,
  environment: AuthWorkerEnvironment,
  request: Request,
  userId: string,
): Promise<Response> {
  const user = await auth.api.getUser({
    query: { id: userId },
    headers: request.headers,
  });
  const account = userDocument(user);
  const redirectTo = new URL(
    "/auth/reset-password",
    environment.SAVIA_ADMIN_REDIRECT_URI ?? environment.BETTER_AUTH_URL,
  ).toString();
  await auth.api.requestPasswordReset({
    body: { email: account.email, redirectTo },
    headers: request.headers,
  });
  return new Response(null, { status: 204 });
}

async function totpEnrollment(
  auth: ReturnType<typeof createBetterAuth>,
  request: Request,
): Promise<Response> {
  const response = await auth.handler(request);
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("application/json")
  ) {
    return response;
  }

  const payload = (await response.json()) as Record<string, unknown>;
  if (typeof payload.totpURI !== "string") return Response.json(payload);

  const svg = await qrCodeSvg(payload.totpURI, {
    errorCorrectionLevel: "M",
    margin: 1,
    type: "svg",
    width: 256,
  });
  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json");
  return new Response(
    JSON.stringify({
      ...payload,
      totpQrDataUrl: `data:image/svg+xml;base64,${btoa(svg)}`,
    }),
    {
      headers,
      status: response.status,
      statusText: response.statusText,
    },
  );
}

async function removeUser(
  auth: ReturnType<typeof createBetterAuth>,
  request: Request,
  userId: string,
): Promise<Response> {
  await auth.api.removeUser({
    body: { userId },
    headers: request.headers,
  });
  return new Response(null, { status: 204 });
}

export function createAuthHandler(
  environment: AuthWorkerEnvironment,
  dependencies: AuthDependencies = {},
) {
  let instance: ReturnType<typeof createBetterAuth> | undefined;
  return {
    async fetch(request: Request) {
      // Native startup verifies the database under its deployment lock first.
      const auth = (instance ??= createBetterAuth(environment, dependencies));
      await ensureSchema(auth, environment.AUTH_DB);
      await ensureBootstrapAdministrator(auth, environment);
      await ensureScalarOAuthClient(auth, environment.AUTH_DB, environment);
      await ensureAdminOAuthClient(auth, environment.AUTH_DB, environment);
      const pathname = new URL(request.url).pathname;
      if (
        request.method === "POST" &&
        pathname === "/_internal/oauth/mcp-exchange"
      )
        return exchangeMcpToken(request, oauthRuntime(environment), auth);
      const oauthPage = oauthPageResponse(request, {
        restartUrl: adminLoginUrl(environment),
        branding: tenantBrandingFromHeader(
          request.headers.get("x-savia-tenant-branding"),
        ),
      });
      if (oauthPage) return oauthPage;
      if (
        pathname === "/.well-known/openid-configuration" ||
        pathname === "/.well-known/oauth-authorization-server/api/auth"
      ) {
        return auth.handler(request);
      }
      if (
        request.method === "GET" &&
        pathname === "/_internal/oauth/scalar-client"
      ) {
        return scalarOAuthClient(auth, environment);
      }
      if (
        request.method === "GET" &&
        pathname === "/_internal/oauth/admin-client"
      ) {
        return adminOAuthClient(auth, environment);
      }
      const oauthManagement = await oauthManagementResponse(
        auth as unknown as OAuthManagementAuth,
        environment.AUTH_DB,
        request,
      );
      if (oauthManagement) return oauthManagement;
      if (
        request.method === "POST" &&
        pathname === "/api/auth/two-factor/enable"
      ) {
        return totpEnrollment(auth, request);
      }
      if (pathname.startsWith("/api/auth/")) return auth.handler(request);
      if (request.method === "GET" && pathname === "/_internal/session")
        return internalSession(auth, request);
      if (
        request.method === "GET" &&
        pathname === "/_internal/notification-events/read"
      ) {
        if (!authNoticeBridgeAuthorized(environment.SAVIA_INTERNAL_BRIDGE_KEY, request))
          return Response.json({ error: "Forbidden bridge access." }, { status: 403 });
        const url = new URL(request.url);
        return Response.json({
          events: await readAuthNoticeEvents(
            environment.AUTH_DB,
            url.searchParams.get("after"),
            Number(url.searchParams.get("limit") ?? 100),
          ),
        });
      }
      if (
        request.method === "POST" &&
        pathname === "/_internal/notification-events/ack"
      ) {
        if (!authNoticeBridgeAuthorized(environment.SAVIA_INTERNAL_BRIDGE_KEY, request))
          return Response.json({ error: "Forbidden bridge access." }, { status: 403 });
        const body = (await request.json().catch(() => ({}))) as { ids?: string[] };
        return Response.json({
          acknowledged: await ackAuthNoticeEvents(
            environment.AUTH_DB,
            Array.isArray(body.ids) ? body.ids : [],
          ),
        });
      }
      if (request.method === "GET" && pathname === "/_internal/users")
        return listUsers(auth, request);
      if (request.method === "POST" && pathname === "/_internal/users")
        return createUser(auth, request);
      const userAction = pathname.match(
        /^\/_internal\/users\/([^/]+)\/(ban|sessions|password-reset)$/,
      );
      if (userAction) {
        const userId = decodeURIComponent(userAction[1]);
        const action = userAction[2];
        if (request.method === "POST" && action === "ban")
          return banUser(auth, request, userId);
        if (request.method === "DELETE" && action === "ban")
          return unbanUser(auth, request, userId);
        if (request.method === "POST" && action === "sessions")
          return revokeUserSessions(auth, request, userId);
        if (request.method === "POST" && action === "password-reset")
          return sendPasswordReset(auth, environment, request, userId);
      }
      const user = pathname.match(/^\/_internal\/users\/([^/]+)$/);
      if (user) {
        const userId = decodeURIComponent(user[1]);
        if (request.method === "GET") return getUser(auth, request, userId);
        if (request.method === "PATCH")
          return updateUser(auth, request, userId);
        if (request.method === "DELETE")
          return removeUser(auth, request, userId);
      }
      return Response.json(
        { error: { code: "NOT_FOUND", message: "Not found" } },
        { status: 404 },
      );
    },
  };
}
export default {
  fetch(request: Request, environment: AuthWorkerEnvironment) {
    return createAuthHandler(environment).fetch(request);
  },
} satisfies ExportedHandler<AuthWorkerEnvironment>;
