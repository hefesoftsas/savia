import { chatgptOAuthPlugins } from "./chatgpt-sign-in";
import { getIP } from "@better-auth/core/utils/ip";
import { limitVerificationMail } from "./pending-email-verification";
import {
  emailRegistrationResponse,
  emailRegistrationHooks,
  registrationPasswordAllowed,
} from "./email-registration";
import {
  microsoftEmailVerificationPlugin,
  chatgptEmailVerificationPlugin,
  assertFederatedRegistrationCompleted,
} from "./microsoft-email-verification";
import {
  tenantRegistrationSettingsResponse,
  readTenantRegistrationSettings,
} from "./tenant-registration-settings";
import { exchangeMcpToken } from "./mcp-exchange";
import {
  socialProviders,
  tenantSocialPlugin,
  validateSocialIdentity,
  socialBefore,
  socialHooks,
  socialRegistrationBefore,
  socialAfter,
  tenantSocialResponse,
  type SocialEnvironment,
} from "./social-sign-in";
import { createAuthMiddleware } from "better-auth/api";
import {
  tenantSSOPlugin,
  tenantSSOHooks,
  tenantSSOBefore,
  tenantSSOResponse,
  disabledSSOPaths,
} from "./tenant-sso";
import { oauthRuntime } from "./oauth";
import { betterAuth } from "better-auth";
import { isAPIError } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";
import { admin, bearer, jwt } from "better-auth/plugins";
import { samlAwareTwoFactor, samlMFAResponse } from "./saml-two-factor";
import { oauthProvider } from "@better-auth/oauth-provider";
import {
  cookieDomainForHost,
  isAllowedPublicOrigin,
  isAllowedTenantOrigin,
  normalizeCanonicalHost,
  parseTenantSlugFromHostname,
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
import type { SMTPEmail } from "./smtp";
import {
  accountEmailAvailable,
  accountEmailSettingsResponse,
  sendAccountEmail,
  trustedAccountEmailTenantId,
  type AccountEmailDependencies,
} from "./account-email";
import {
  ackAuthNoticeEvents,
  authNoticeBridgeAuthorized,
  ensureAuthNoticeSchema,
  readAuthNoticeEvents,
} from "./notification-events";
import { ensureLegacyAccountIssuerOptional } from "./legacy-account-issuer";

export type AuthWorkerEnvironment = SocialEnvironment & {
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
  SAVIA_SMTP_SECURITY?: "tls" | "starttls" | "plain";
  SAVIA_SMTP_ALLOW_INSECURE?: string;
  SAVIA_INTERNAL_BRIDGE_KEY?: string;
  SAVIA_SSO_ALLOW_LOCAL_IDP?: string;
  SAVIA_IDENTITY?: { fetch(request: Request): Promise<Response> };
};

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: string | null;
  isBanned: boolean;
  twoFactorEnabled: boolean;
  emailVerified?: boolean;
};

export type TransactionalEmailSender = (email: SMTPEmail) => Promise<void>;

export type AuthDependencies = AccountEmailDependencies & {
  database?: import("better-auth").BetterAuthOptions["database"];
};

const schemaInitializations = new WeakMap<object, Promise<void>>();
const noticeSchemaInitialized = new WeakSet<object>();
type AuthBootstrap = {
  scalarClient: ScalarOAuthClient;
  adminClient: AdminOAuthClient;
};
const bootstrapInitializations = new WeakMap<
  object,
  Map<string, Promise<AuthBootstrap>>
>();

function requiredValue(value: string | undefined, name: string): string {
  if (value) return value;
  throw new Error(`${name} is required`);
}

function adminLoginUrl(
  environment: AuthWorkerEnvironment,
  requestUrl?: string,
): string {
  let url = new URL(
    environment.SAVIA_ADMIN_REDIRECT_URI ??
      "http://127.0.0.1:5173/auth/callback",
  );
  // Direct SSO/social login has no OAuth transaction to restore the tenant.
  // Keep its validated public host when starting a fresh Admin authorization.
  if (requestUrl) {
    const requested = new URL(requestUrl);
    if (isAllowedTenantOrigin(requested.origin, url.hostname))
      url = new URL(requested.origin);
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "/login";
  return url.toString();
}

function authAccountEmailUrl(
  environment: AuthWorkerEnvironment,
  path: string,
): string {
  const target = new URL(environment.BETTER_AUTH_URL);
  target.pathname = path;
  target.search = "";
  target.hash = "";
  return target.toString();
}

function adminAccountEmailUrl(
  environment: AuthWorkerEnvironment,
  path: string,
): string {
  const target = new URL(
    environment.SAVIA_ADMIN_REDIRECT_URI ?? environment.BETTER_AUTH_URL,
  );
  target.pathname = path;
  target.search = "";
  target.hash = "";
  return target.toString();
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

function verificationEmail(url: string, email: string): SMTPEmail {
  return {
    to: email,
    subject: "Verifica tu correo de Savia",
    text: [
      "Tu cuenta de Savia está lista. Verifica tu dirección de correo para ingresar:",
      "",
      url,
      "",
      "Si no solicitaste esta cuenta, ignora este correo.",
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
    emailVerified: user.emailVerified === true,
  };
}

export function createBetterAuth(
  environment: AuthWorkerEnvironment,
  dependencies: AuthDependencies = {},
) {
  const deliverAccountEmail = (email: SMTPEmail, tenantId?: number) =>
    sendAccountEmail(environment, dependencies, email, tenantId);
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
    disabledPaths: disabledSSOPaths,
    socialProviders: socialProviders(environment),
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            await tenantSSOHooks.user?.create?.before?.(user, ctx);
            return await socialHooks.user?.create?.before?.(user, ctx);
          },
          after: socialHooks.user?.create?.after,
        },
      },
      account: {
        create: {
          before: async (account, ctx) => {
            await tenantSSOHooks.account?.create?.before?.(account, ctx);
            await socialHooks.account?.create?.before?.(account, ctx);
          },
        },
      },
      session: {
        create: {
          before: async (session, ctx) => {
            await assertFederatedRegistrationCompleted(
              environment,
              session.userId,
            );
            await emailRegistrationHooks(environment).session?.create?.before?.(
              session,
              ctx,
            );
            await tenantSSOHooks.session?.create?.before?.(session, ctx);
            await socialHooks.session?.create?.before?.(session, ctx);
          },
          after: async (session, ctx) => {
            await tenantSSOHooks.session?.create?.after?.(session, ctx);
            await socialHooks.session?.create?.after?.(session, ctx);
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        await tenantSSOBefore(ctx);
        await socialBefore(ctx);
        await socialRegistrationBefore(ctx, environment);
      }),
      after: socialAfter,
    },
    account: {
      encryptOAuthTokens: true,
      accountLinking: { enabled: true, requireLocalEmailVerified: true },
    },
    user: {
      validateUserInfo: (input, ctx) =>
        validateSocialIdentity(input, ctx, environment),
      additionalFields: {
        emailTenantId: {
          type: "number",
          required: false,
          input: false,
        },
      },
    },
    emailVerification: {
      expiresIn: 900,
      sendVerificationEmail: async ({ user, url }) => {
        await deliverAccountEmail(
          verificationEmail(url, user.email),
          typeof (user as typeof user & { emailTenantId?: number })
            .emailTenantId === "number"
            ? (user as typeof user & { emailTenantId?: number }).emailTenantId
            : undefined,
        );
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: 900,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) =>
        deliverAccountEmail(
          passwordResetEmail(url, user.email),
          typeof (user as typeof user & { emailTenantId?: number })
            .emailTenantId === "number"
            ? (user as typeof user & { emailTenantId?: number }).emailTenantId
            : undefined,
        ),
    },
    plugins: [
      ...chatgptOAuthPlugins(environment),
      chatgptEmailVerificationPlugin(environment, dependencies),
      microsoftEmailVerificationPlugin(environment, dependencies),
      tenantSSOPlugin(),
      tenantSocialPlugin(),
      admin(),
      samlAwareTwoFactor(),
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
  const initialization = (async () => {
    await ensureLegacyAccountIssuerOptional(database);
    const { runMigrations } = await getMigrations(auth.options);
    await runMigrations();
    if (!noticeSchemaInitialized.has(database)) {
      await ensureAuthNoticeSchema(database);
      noticeSchemaInitialized.add(database);
    }
  })();
  schemaInitializations.set(database, initialization);
  try {
    await initialization;
  } catch (error) {
    if (schemaInitializations.get(database) === initialization)
      schemaInitializations.delete(database);
    throw error;
  }
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
  if (existing) {
    if (account.role === "admin") {
      await environment.AUTH_DB.prepare(
        'UPDATE "user" SET "emailVerified" = true WHERE id = ?',
      )
        .bind(existing.id)
        .run();
    }
    return;
  }
  try {
    await auth.api.createUser({
      body: {
        email: account.email,
        name: account.name,
        password: account.password,
        role: account.role,
        data: { emailVerified: true },
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
}

function bootstrapEnvironmentKey(environment: AuthWorkerEnvironment): string {
  return JSON.stringify([
    environment.BETTER_AUTH_URL,
    environment.BETTER_AUTH_SECRET,
    environment.BETTER_AUTH_BOOTSTRAP_EMAIL,
    environment.BETTER_AUTH_BOOTSTRAP_PASSWORD,
    environment.BETTER_AUTH_BOOTSTRAP_NAME,
    environment.SAVIA_API_RESOURCE,
    environment.SAVIA_ADMIN_REDIRECT_URI,
    environment.SAVIA_SCALAR_REDIRECT_URI,
  ]);
}

function ensureAuthBootstrap(
  auth: ReturnType<typeof createBetterAuth>,
  environment: AuthWorkerEnvironment,
): Promise<AuthBootstrap> {
  const database = environment.AUTH_DB;
  const key = bootstrapEnvironmentKey(environment);
  let configurations = bootstrapInitializations.get(database);
  if (!configurations) {
    configurations = new Map();
    bootstrapInitializations.set(database, configurations);
  }
  const existing = configurations.get(key);
  if (existing) return existing;

  const initialization = (async () => {
    await ensureBootstrapAdministrator(auth, environment);
    const scalarClient = await ensureScalarOAuthClient(
      auth,
      database,
      environment,
    );
    const adminClient = await ensureAdminOAuthClient(
      auth,
      database,
      environment,
    );
    return { scalarClient, adminClient };
  })();
  configurations.set(key, initialization);
  void initialization.catch(() => {
    if (configurations?.get(key) === initialization) {
      configurations.delete(key);
      if (configurations.size === 0) bootstrapInitializations.delete(database);
    }
  });
  return initialization;
}

async function internalSession(
  auth: ReturnType<typeof createBetterAuth>,
  request: Request,
): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  return Response.json({ user: session ? userDocument(session.user) : null });
}

async function scalarOAuthClient(client: ScalarOAuthClient): Promise<Response> {
  return Response.json(client);
}

async function adminOAuthClient(client: AdminOAuthClient): Promise<Response> {
  return Response.json(client);
}

async function createUser(
  auth: ReturnType<typeof createBetterAuth>,
  environment: AuthWorkerEnvironment,
  request: Request,
): Promise<Response> {
  const input = (await request.json()) as {
    email?: unknown;
    name?: unknown;
    password?: unknown;
    role?: unknown;
    emailVerified?: unknown;
    tenantId?: unknown;
  };
  if (
    typeof input.email !== "string" ||
    typeof input.name !== "string" ||
    typeof input.password !== "string" ||
    (input.role !== undefined &&
      input.role !== "admin" &&
      input.role !== "user") ||
    (input.emailVerified !== undefined &&
      typeof input.emailVerified !== "boolean") ||
    (input.tenantId !== undefined &&
      (!Number.isSafeInteger(input.tenantId) || (input.tenantId as number) < 1))
  ) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid user input" } },
      { status: 400 },
    );
  }
  const created = await auth.api
    .createUser({
      body: {
        email: input.email,
        name: input.name,
        password: input.password,
        role: input.role ?? "user",
        data: {
          emailVerified: input.emailVerified === true,
          ...(typeof input.tenantId === "number"
            ? { emailTenantId: input.tenantId }
            : {}),
        },
      },
    })
    .catch((error: unknown) => {
      if (
        isAPIError(error) &&
        error.body?.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"
      )
        return null;
      throw error;
    });
  if (!created) {
    return Response.json(
      {
        error: {
          code: "IDENTITY_EMAIL_CONFLICT",
          message:
            "An account with this email already exists. Use an existing user or a different email.",
        },
      },
      { status: 409 },
    );
  }
  if (input.emailVerified !== true) {
    try {
      await auth.api.sendVerificationEmail({
        body: {
          email: input.email,
          callbackURL: authAccountEmailUrl(
            environment,
            "/api/auth/email-verified",
          ),
        },
      });
    } catch (error) {
      const adapter = (await auth.$context).internalAdapter;
      await adapter.deleteUserSessions(userDocument(created).id);
      await adapter.deleteAccounts(userDocument(created).id);
      await adapter.deleteUser(userDocument(created).id);
      throw error;
    }
  }
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
  const context = await auth.$context;
  const users = await context.internalAdapter.listUsers(
    Number.isInteger(limit) && limit > 0 ? limit : 100,
    Number.isInteger(offset) && offset >= 0 ? offset : 0,
    { field: "name", direction: "asc" },
    searchValue
      ? [{ field: "email", value: searchValue, operator: "contains" }]
      : undefined,
  );
  return Response.json({
    users: users.map(userDocument),
    total: await context.internalAdapter.countTotalUsers(),
  });
}

async function getUser(
  auth: ReturnType<typeof createBetterAuth>,
  _request: Request,
  userId: string,
): Promise<Response> {
  const user = await (await auth.$context).internalAdapter.findUserById(userId);
  if (!user) return Response.json({ error: "User not found" }, { status: 404 });
  return Response.json({ user: userDocument(user) });
}

async function updateUser(
  auth: ReturnType<typeof createBetterAuth>,
  request: Request,
  userId: string,
): Promise<Response> {
  const input = (await request.json()) as {
    name?: unknown;
    role?: unknown;
    emailVerified?: unknown;
    tenantId?: unknown;
  };
  if (
    (input.name !== undefined && typeof input.name !== "string") ||
    (input.role !== undefined &&
      input.role !== "admin" &&
      input.role !== "user") ||
    (input.emailVerified !== undefined &&
      typeof input.emailVerified !== "boolean") ||
    (input.tenantId !== undefined &&
      input.tenantId !== null &&
      (!Number.isSafeInteger(input.tenantId) ||
        (input.tenantId as number) < 1)) ||
    (input.name === undefined &&
      input.role === undefined &&
      input.emailVerified === undefined &&
      input.tenantId === undefined)
  ) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid user update" } },
      { status: 400 },
    );
  }
  const context = await auth.$context;
  const changes: Record<string, unknown> = {};
  if (typeof input.name === "string") changes.name = input.name;
  if (input.role === "admin" || input.role === "user")
    changes.role = input.role;
  if (typeof input.emailVerified === "boolean")
    changes.emailVerified = input.emailVerified;
  if (typeof input.tenantId === "number" || input.tenantId === null)
    changes.emailTenantId = input.tenantId;
  const previousUser = await context.adapter.findOne<{
    emailTenantId?: number | null;
  }>({ model: "user", where: [{ field: "id", value: userId }] });
  const user = await context.internalAdapter.updateUser(userId, changes);
  if (
    input.emailVerified === false ||
    (input.tenantId !== undefined &&
      previousUser?.emailTenantId !== input.tenantId)
  ) {
    await context.internalAdapter.deleteUserSessions(userId);
  }
  return Response.json({ user: userDocument(user) });
}

async function banUser(
  auth: ReturnType<typeof createBetterAuth>,
  _request: Request,
  userId: string,
): Promise<Response> {
  const context = await auth.$context;
  const user = await context.internalAdapter.updateUser(userId, {
    banned: true,
    banReason: "Disabled by Savia identity administrator",
    banExpires: null,
    updatedAt: new Date(),
  });
  await context.internalAdapter.deleteUserSessions(userId);
  return Response.json({ user: userDocument(user) });
}

async function unbanUser(
  auth: ReturnType<typeof createBetterAuth>,
  _request: Request,
  userId: string,
): Promise<Response> {
  const user = await (
    await auth.$context
  ).internalAdapter.updateUser(userId, {
    banned: false,
    banReason: null,
    banExpires: null,
    updatedAt: new Date(),
  });
  return Response.json({ user: userDocument(user) });
}

async function revokeUserSessions(
  auth: ReturnType<typeof createBetterAuth>,
  _request: Request,
  userId: string,
): Promise<Response> {
  await (await auth.$context).internalAdapter.deleteUserSessions(userId);
  return new Response(null, { status: 204 });
}

async function sendPasswordReset(
  auth: ReturnType<typeof createBetterAuth>,
  environment: AuthWorkerEnvironment,
  _request: Request,
  userId: string,
): Promise<Response> {
  const user = await (await auth.$context).internalAdapter.findUserById(userId);
  if (!user) return Response.json({ error: "User not found" }, { status: 404 });
  const account = userDocument(user);
  const redirectTo = new URL(
    "/auth/reset-password",
    environment.SAVIA_ADMIN_REDIRECT_URI ?? environment.BETTER_AUTH_URL,
  ).toString();
  try {
    const response = await auth.api.requestPasswordReset({
      body: { email: account.email, redirectTo },
      asResponse: true,
    });
    if (!response.ok) return response;
    return new Response(null, { status: 204 });
  } catch (error) {
    if (isAPIError(error))
      return Response.json(error.body, { status: error.statusCode });
    throw error;
  }
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
  _request: Request,
  userId: string,
): Promise<Response> {
  const adapter = (await auth.$context).internalAdapter;
  await adapter.deleteUserSessions(userId);
  await adapter.deleteAccounts(userId);
  await adapter.deleteUser(userId);
  return new Response(null, { status: 204 });
}

export function createAuthHandler(
  environment: AuthWorkerEnvironment,
  dependencies: AuthDependencies = {},
) {
  let instance: ReturnType<typeof createBetterAuth> | undefined;
  async function publicAccountEmailRequest(
    auth: ReturnType<typeof createBetterAuth>,
    request: Request,
    executionContext?: ExecutionContext,
  ): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    const verification = pathname.endsWith("/send-verification-email");
    const fallbackMessage = verification
      ? "If this email requires verification, check your email for the verification link"
      : "If this email exists in our system, check your email for the reset link";
    const body = (await request
      .clone()
      .json()
      .catch(() => ({}))) as Record<string, unknown>;
    const messageBody = {
      ...body,
      ...(verification
        ? {
            callbackURL: authAccountEmailUrl(
              environment,
              "/api/auth/email-verified",
            ),
          }
        : {
            redirectTo: adminAccountEmailUrl(
              environment,
              "/auth/reset-password",
            ),
          }),
    };
    const forwarded = new Request(request, {
      body: JSON.stringify(messageBody),
      headers: new Headers(request.headers),
    });
    const completion = (async () => {
      if (verification && typeof body.email === "string") {
        const context = await auth.$context;
        const user = await context.adapter.findOne<{ emailTenantId?: number }>({
          model: "user",
          where: [{ field: "email", value: body.email.trim().toLowerCase() }],
        });
        await limitVerificationMail(environment, {
          tenantId: user?.emailTenantId ?? 0,
          email: body.email,
          ip: getIP(request, context.options) ?? "unknown",
        });
      }
      return auth.handler(forwarded);
    })()
      .then((response) => {
        if (response.status === 429) {
          console.warn("Savia account email request was rate limited");
        }
      })
      .catch(() => {
        console.error("Savia account email delivery failed");
      });
    if (executionContext) executionContext.waitUntil(completion);
    else void completion;
    return Response.json({ status: true, message: fallbackMessage });
  }
  return {
    async fetch(request: Request, executionContext?: ExecutionContext) {
      // Native startup verifies the database under its deployment lock first.
      const auth = (instance ??= createBetterAuth(environment, dependencies));
      await ensureSchema(auth, environment.AUTH_DB);
      const bootstrap = await ensureAuthBootstrap(auth, environment);
      const pathname = new URL(request.url).pathname;
      if (
        request.method === "POST" &&
        pathname === "/_internal/oauth/mcp-exchange"
      )
        return exchangeMcpToken(request, oauthRuntime(environment), auth);
      const registrationSettings = await tenantRegistrationSettingsResponse(
        request,
        environment,
        dependencies,
        (await auth.$context).adapter,
      );
      if (registrationSettings) return registrationSettings;
      const emailRegistration = await emailRegistrationResponse(
        request,
        environment,
        dependencies,
        auth,
      );
      if (emailRegistration) return emailRegistration;
      const tenantSSO = await tenantSSOResponse(
        request,
        environment,
        (await auth.$context).adapter,
      );
      if (tenantSSO) return tenantSSO;
      const social = await tenantSocialResponse(
        request,
        environment,
        (await auth.$context).adapter,
        dependencies,
      );
      if (social) return social;
      const loginUiRequest =
        request.method === "GET" &&
        ["/api/auth/login", "/api/auth/forgot-password"].includes(pathname);
      const oauthPage = oauthPageResponse(request, {
        restartUrl: adminLoginUrl(environment, request.url),
        allowEmailRegistration:
          loginUiRequest &&
          pathname === "/api/auth/login" &&
          request.headers.get("x-savia-registration-ready") === "true" &&
          !!parseTenantSlugFromHostname(new URL(request.url).hostname) &&
          (await (async () => {
            const tenantId = trustedAccountEmailTenantId(request, environment);
            if (!tenantId) return false;
            const settings = await readTenantRegistrationSettings(
              environment,
              tenantId,
            ).catch(() => null);
            return (
              !!settings?.allowEmailRegistration &&
              (await registrationPasswordAllowed(
                (await auth.$context).adapter,
                tenantId,
              ))
            );
          })()),
        branding: tenantBrandingFromHeader(
          request.headers.get("x-savia-tenant-branding"),
        ),
        ...(loginUiRequest
          ? {
              emailAvailable: await accountEmailAvailable(
                environment,
                dependencies,
                trustedAccountEmailTenantId(request, environment),
              ).catch(() => false),
            }
          : {}),
      });
      if (oauthPage) return oauthPage;
      const accountEmailSettings = await accountEmailSettingsResponse(
        request,
        environment,
        dependencies,
      );
      if (accountEmailSettings) return accountEmailSettings;
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
        return scalarOAuthClient(bootstrap.scalarClient);
      }
      if (
        request.method === "GET" &&
        pathname === "/_internal/oauth/admin-client"
      ) {
        return adminOAuthClient(bootstrap.adminClient);
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
      if (
        request.method === "POST" &&
        (pathname === "/api/auth/request-password-reset" ||
          pathname === "/api/auth/send-verification-email")
      ) {
        return publicAccountEmailRequest(auth, request, executionContext);
      }
      if (pathname.startsWith("/api/auth/")) {
        return samlMFAResponse(request, await auth.handler(request));
      }
      if (request.method === "GET" && pathname === "/_internal/session")
        return internalSession(auth, request);
      if (
        request.method === "GET" &&
        pathname === "/_internal/notification-events/read"
      ) {
        if (
          !authNoticeBridgeAuthorized(
            environment.SAVIA_INTERNAL_BRIDGE_KEY,
            request,
          )
        )
          return Response.json(
            { error: "Forbidden bridge access." },
            { status: 403 },
          );
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
        if (
          !authNoticeBridgeAuthorized(
            environment.SAVIA_INTERNAL_BRIDGE_KEY,
            request,
          )
        )
          return Response.json(
            { error: "Forbidden bridge access." },
            { status: 403 },
          );
        const body = (await request.json().catch(() => ({}))) as {
          ids?: string[];
        };
        return Response.json({
          acknowledged: await ackAuthNoticeEvents(
            environment.AUTH_DB,
            Array.isArray(body.ids) ? body.ids : [],
          ),
        });
      }
      if (
        pathname === "/_internal/users" ||
        /^\/_internal\/users\/[^/]+(?:\/(?:ban|sessions|password-reset))?$/.test(
          pathname,
        )
      ) {
        if (
          !authNoticeBridgeAuthorized(
            environment.SAVIA_INTERNAL_BRIDGE_KEY,
            request,
          )
        )
          return Response.json(
            { error: "Forbidden bridge access." },
            { status: 403 },
          );
      }
      if (request.method === "GET" && pathname === "/_internal/users")
        return listUsers(auth, request);
      if (request.method === "POST" && pathname === "/_internal/users")
        return createUser(auth, environment, request);
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
  fetch(
    request: Request,
    environment: AuthWorkerEnvironment,
    executionContext: ExecutionContext,
  ) {
    return createAuthHandler(environment).fetch(request, executionContext);
  },
} satisfies ExportedHandler<AuthWorkerEnvironment>;
