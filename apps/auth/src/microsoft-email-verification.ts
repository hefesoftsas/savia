import {
  federatedEmailVerificationPage,
  tenantBrandingFromHeader,
} from "./oauth-pages";
import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  getIP,
  getOAuthState,
} from "better-auth/api";
import { verifyProviderIdToken } from "better-auth/oauth2";
import { getCurrentAuthEndpointContext } from "@better-auth/core/context";
import {
  createPendingVerification,
  consumePendingVerification,
  newVerificationNonce,
  readPendingVerification,
  sendPendingVerification,
  limitVerificationMail,
  type PendingVerification,
  type VerificationPurpose,
} from "./pending-email-verification";
import {
  readSocialRegistration,
  REGISTRATION_PREFIX,
  type SocialRegistrationAttempt,
} from "./social-registration-context";
import { assertPasswordAllowed, type TenantSSOAdapter } from "./tenant-sso";
import { assertTenantAuthenticationActive } from "./tenant-auth-state";
import {
  accountEmailAvailable,
  type AccountEmailDependencies,
} from "./account-email";
import type { AuthWorkerEnvironment } from "./index";
import { CHATGPT_ISSUER, type ChatGPTEnvironment } from "./chatgpt-sign-in";

export const MICROSOFT_CONSUMER_DIRECTORY =
  "9188040d-6c67-4c5b-b112-36a304b66dad";
const TABLE =
  "CREATE TABLE IF NOT EXISTS microsoft_email_binding (provider_subject TEXT PRIMARY KEY, provider_tenant_id TEXT NOT NULL, tenant_id BIGINT NOT NULL, user_id TEXT NOT NULL, verified_email TEXT NOT NULL, created_at TEXT NOT NULL)";
const RECOVERY_TABLE =
  "CREATE TABLE IF NOT EXISTS microsoft_registration_recovery (user_id TEXT PRIMARY KEY, intent_id TEXT NOT NULL UNIQUE, provider_subject TEXT NOT NULL, tenant_id BIGINT NOT NULL, email TEXT NOT NULL, name TEXT NOT NULL, revision TEXT NOT NULL, created_at TEXT NOT NULL)";
const CHATGPT_TABLE =
  "CREATE TABLE IF NOT EXISTS chatgpt_email_binding (provider_subject TEXT NOT NULL, provider_tenant_id TEXT NOT NULL, tenant_id BIGINT NOT NULL, user_id TEXT NOT NULL, verified_email TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(provider_subject,provider_tenant_id))";
const CHATGPT_RECOVERY_TABLE =
  "CREATE TABLE IF NOT EXISTS chatgpt_registration_recovery (user_id TEXT PRIMARY KEY, intent_id TEXT NOT NULL UNIQUE, provider_subject TEXT NOT NULL, tenant_id BIGINT NOT NULL, email TEXT NOT NULL, name TEXT NOT NULL, revision TEXT NOT NULL, created_at TEXT NOT NULL)";
type Profile = {
  tid?: unknown;
  oid?: unknown;
  email?: unknown;
  name?: unknown;
};
type ChatGPTProfile = {
  id?: unknown;
  iss?: unknown;
  clientId?: unknown;
  email?: unknown;
  emailVerified?: unknown;
  name?: unknown;
};
type LocalUser = {
  name?: string;
  id: string;
  email: string;
  emailVerified: boolean;
  emailTenantId?: number;
  role?: string;
  banned?: boolean;
};
type Policy = {
  active: boolean;
  microsoftEnabled: boolean;
  chatgptEnabled?: boolean;
  allowMicrosoftPersonalAccounts: boolean;
  allowRegistration: boolean;
  revision: string;
};
const denied = () =>
  new Error(
    "This federated account cannot access this tenant. Contact your administrator.",
  );
async function policy(
  adapter: TenantSSOAdapter,
  tenantId: number,
  provider: "microsoft" | "chatgpt",
  revision?: string,
) {
  const settings = await adapter.findOne<Policy>({
    model: "tenantSocialSettings",
    where: [{ field: "tenantId", value: tenantId }],
  });
  if (
    !settings?.active ||
    (provider === "microsoft"
      ? !settings.microsoftEnabled || !settings.allowMicrosoftPersonalAccounts
      : settings.chatgptEnabled !== true) ||
    (revision !== undefined && revision !== settings.revision)
  )
    throw denied();
  await assertTenantAuthenticationActive(adapter, tenantId);
  await assertPasswordAllowed(adapter, {
    email: "",
    emailVerified: true,
    emailTenantId: tenantId,
    role: "user",
  });
  return settings;
}
/** Every native session path must preserve an unfinished provisioning guard. */
export async function assertMicrosoftRegistrationCompleted(
  env: AuthWorkerEnvironment,
  userId: string,
) {
  await assertFederatedRegistrationCompleted(env, userId);
}
export async function assertFederatedRegistrationCompleted(
  env: AuthWorkerEnvironment,
  userId: string,
) {
  await env.AUTH_DB.exec(RECOVERY_TABLE);
  await env.AUTH_DB.exec(CHATGPT_RECOVERY_TABLE);
  const microsoftPending = await env.AUTH_DB.prepare(
    "SELECT user_id FROM microsoft_registration_recovery WHERE user_id=?",
  )
    .bind(userId)
    .first();
  const chatgptPending = await env.AUTH_DB.prepare(
    "SELECT user_id FROM chatgpt_registration_recovery WHERE user_id=?",
  )
    .bind(userId)
    .first();
  if (microsoftPending || chatgptPending)
    throw new APIError("FORBIDDEN", {
      message:
        "Complete federated email verification and tenant access provisioning before signing in.",
    });
}
export async function beginMicrosoftVerification(
  profile: Profile,
  attempt: SocialRegistrationAttempt,
  browserNonce: string,
  env: AuthWorkerEnvironment,
  adapter: TenantSSOAdapter,
): Promise<PendingVerification> {
  if (
    profile.tid !== MICROSOFT_CONSUMER_DIRECTORY ||
    typeof profile.oid !== "string" ||
    !profile.oid.trim() ||
    typeof profile.email !== "string" ||
    attempt.provider !== "microsoft" ||
    attempt.expiresAt <= Date.now()
  )
    throw denied();
  await policy(adapter, attempt.tenantId, "microsoft", attempt.revision);
  return createPendingVerification(
    {
      purpose: "microsoft_link",
      tenantId: attempt.tenantId,
      email: profile.email,
      revision: attempt.revision,
      returnOrigin: attempt.returnOrigin,
      browserNonce,
      providerSubject: profile.oid,
      providerTenantId: MICROSOFT_CONSUMER_DIRECTORY,
    },
    env,
  );
}
export async function provenMicrosoftIdentity(
  profile: Profile,
  tenantId: number | undefined,
  env: AuthWorkerEnvironment,
  adapter: TenantSSOAdapter,
): Promise<LocalUser | null> {
  if (
    profile.tid !== MICROSOFT_CONSUMER_DIRECTORY ||
    typeof profile.oid !== "string"
  )
    throw denied();
  await env.AUTH_DB.exec(TABLE);
  const binding = await env.AUTH_DB.prepare(
    "SELECT user_id,tenant_id,verified_email FROM microsoft_email_binding WHERE provider_subject=? AND provider_tenant_id=?",
  )
    .bind(profile.oid, MICROSOFT_CONSUMER_DIRECTORY)
    .first<{ user_id: string; tenant_id: number; verified_email: string }>();
  if (!binding) return null;
  if (tenantId !== undefined && binding.tenant_id !== tenantId) throw denied();
  await policy(adapter, binding.tenant_id, "microsoft");
  const user = await adapter.findOne<LocalUser>({
    model: "user",
    where: [{ field: "id", value: binding.user_id }],
  });
  if (
    !user ||
    user.banned ||
    !user.emailVerified ||
    user.emailTenantId !== binding.tenant_id ||
    user.role?.split(",").includes("admin") ||
    user.email !== binding.verified_email
  )
    throw denied();
  return user;
}

export async function beginChatgptVerification(
  profile: ChatGPTProfile,
  attempt: SocialRegistrationAttempt,
  browserNonce: string,
  env: AuthWorkerEnvironment & ChatGPTEnvironment,
  adapter: TenantSSOAdapter,
): Promise<PendingVerification> {
  const clientId = env.SAVIA_CHATGPT_CLIENT_ID?.trim();
  if (
    profile.iss !== CHATGPT_ISSUER ||
    typeof profile.id !== "string" ||
    !/^[a-f0-9]{64}$/.test(profile.id) ||
    typeof profile.clientId !== "string" ||
    !clientId ||
    profile.clientId !== clientId ||
    typeof profile.email !== "string" ||
    !/^\S+@\S+\.\S+$/.test(profile.email.trim()) ||
    profile.email.length > 254 ||
    /[\r\n<>]/.test(profile.email) ||
    attempt.provider !== "chatgpt" ||
    attempt.expiresAt <= Date.now()
  )
    throw denied();
  await policy(adapter, attempt.tenantId, "chatgpt", attempt.revision);
  const email = profile.email.trim().toLowerCase();
  const displayName =
    typeof profile.name === "string" && profile.name.trim()
      ? profile.name.trim().slice(0, 200)
      : email.split("@")[0];
  return createPendingVerification(
    {
      purpose: "chatgpt_link",
      tenantId: attempt.tenantId,
      email,
      revision: attempt.revision,
      returnOrigin: attempt.returnOrigin,
      browserNonce,
      providerSubject: profile.id,
      providerTenantId: clientId,
      displayName,
    },
    env,
  );
}

export async function provenChatgptIdentity(
  profile: ChatGPTProfile,
  tenantId: number | undefined,
  env: AuthWorkerEnvironment & ChatGPTEnvironment,
  adapter: TenantSSOAdapter,
): Promise<LocalUser | null> {
  const clientId = env.SAVIA_CHATGPT_CLIENT_ID?.trim();
  if (
    profile.iss !== CHATGPT_ISSUER ||
    typeof profile.id !== "string" ||
    !/^[a-f0-9]{64}$/.test(profile.id) ||
    typeof profile.clientId !== "string" ||
    !clientId ||
    profile.clientId !== clientId
  )
    throw denied();
  await env.AUTH_DB.exec(CHATGPT_TABLE);
  const binding = await env.AUTH_DB.prepare(
    "SELECT user_id,tenant_id,verified_email FROM chatgpt_email_binding WHERE provider_subject=? AND provider_tenant_id=?",
  )
    .bind(profile.id, clientId)
    .first<{ user_id: string; tenant_id: number; verified_email: string }>();
  if (!binding) return null;
  if (tenantId !== undefined && binding.tenant_id !== tenantId) throw denied();
  await policy(adapter, binding.tenant_id, "chatgpt");
  const user = await adapter.findOne<LocalUser>({
    model: "user",
    where: [{ field: "id", value: binding.user_id }],
  });
  if (
    !user ||
    user.banned ||
    !user.emailVerified ||
    user.emailTenantId !== binding.tenant_id ||
    user.role?.split(",").includes("admin") ||
    user.email !== binding.verified_email
  )
    throw denied();
  return user;
}
/** Runs before Better Auth's automatic email matching and account linking. */
export function microsoftEmailVerificationPlugin(
  env: AuthWorkerEnvironment,
  deps: AccountEmailDependencies,
): BetterAuthPlugin {
  return {
    id: "savia-microsoft-email-verification",
    endpoints: microsoftVerificationEndpoints(env, deps),
    init(context) {
      return {
        context: {
          socialProviders: context.socialProviders.map((provider) => {
            if (provider.id !== "microsoft") return provider;
            const original = provider;
            return {
              ...provider,
              requiresIdTokenNonce: true,
              async createAuthorizationURL(data) {
                const url = await original.createAuthorizationURL(data);
                if (!data.idTokenNonce) throw denied();
                url.searchParams.set("nonce", data.idTokenNonce);
                return url;
              },
              async getUserInfo(tokens) {
                if (
                  !tokens.idToken ||
                  !tokens.expectedIdTokenNonce ||
                  !(await verifyProviderIdToken(
                    original,
                    tokens.idToken,
                    tokens.expectedIdTokenNonce,
                  ))
                )
                  throw denied();
                const result = await original.getUserInfo(tokens);
                if (!result) return null;
                const profile = result.data as Profile;
                if (profile.tid !== MICROSOFT_CONSUMER_DIRECTORY) return result;
                const ctx = getCurrentAuthEndpointContext();
                const state = await getOAuthState();
                const attempt = state?.serverContext?.socialAttemptId
                  ? await readSocialRegistration(
                      ctx.context.adapter,
                      state,
                      "microsoft",
                    )
                  : null;
                const linked = await provenMicrosoftIdentity(
                  profile,
                  attempt?.tenantId,
                  env,
                  ctx.context.adapter,
                );
                if (linked)
                  return {
                    ...result,
                    user: {
                      ...result.user,
                      email: linked.email,
                      emailVerified: true,
                    },
                  };
                if (result.user.emailVerified === true) return result;
                if (
                  !attempt ||
                  !(await accountEmailAvailable(
                    env,
                    deps,
                    attempt.tenantId,
                  ).catch(() => false))
                )
                  throw denied();
                const nonce = newVerificationNonce();
                const pending = await beginMicrosoftVerification(
                  profile,
                  attempt,
                  nonce,
                  env,
                  ctx.context.adapter,
                );
                const cookie = ctx.context.createAuthCookie(
                  "microsoft_email_verification",
                  { maxAge: 1200 },
                );
                if (!ctx.setSignedCookie || !ctx.redirect) throw denied();
                await ctx.setSignedCookie(
                  cookie.name,
                  nonce,
                  ctx.context.secret,
                  cookie.attributes,
                );
                await env.AUTH_DB.prepare(
                  'DELETE FROM "verification" WHERE identifier=?',
                )
                  .bind(REGISTRATION_PREFIX + attempt.attemptId)
                  .run();
                const destination = new URL(
                  "/api/auth/microsoft-email-verification",
                  attempt.returnOrigin,
                );
                destination.searchParams.set("id", pending.id);
                throw ctx.redirect(destination.href);
              },
            };
          }),
        },
      };
    },
  };
}

/** Adds mandatory Savia email proof around the registered ChatGPT OIDC provider. */
export function chatgptEmailVerificationPlugin(
  env: AuthWorkerEnvironment & ChatGPTEnvironment,
  deps: AccountEmailDependencies,
): BetterAuthPlugin {
  return {
    id: "savia-chatgpt-email-verification",
    endpoints: federatedVerificationEndpoints("chatgpt", env, deps),
    init(context) {
      const socialProviders: typeof context.socialProviders = [];
      for (const provider of context.socialProviders) {
        if (provider.id !== "chatgpt") {
          socialProviders.push(provider);
          continue;
        }
        if (
          provider.issuer !== CHATGPT_ISSUER ||
          !provider.idToken ||
          !("issuer" in provider.idToken) ||
          provider.idToken.issuer !== CHATGPT_ISSUER
        )
          continue;
        const original = provider;
        const wrapped = {
          ...provider,
          requiresIdTokenNonce: true,
          async createAuthorizationURL(
            data: Parameters<typeof original.createAuthorizationURL>[0],
          ) {
            if (!data.idTokenNonce) throw denied();
            const url = await original.createAuthorizationURL(data);
            url.searchParams.set("nonce", data.idTokenNonce);
            return url;
          },
          async getUserInfo(
            tokens: Parameters<typeof original.getUserInfo>[0],
          ) {
            if (
              !tokens.idToken ||
              !tokens.expectedIdTokenNonce ||
              !(await verifyProviderIdToken(
                original,
                tokens.idToken,
                tokens.expectedIdTokenNonce,
              ))
            )
              throw denied();
            const result = await original.getUserInfo(tokens);
            if (!result) return null;
            const profile = result.data as ChatGPTProfile;
            if (
              profile.iss !== CHATGPT_ISSUER ||
              typeof profile.clientId !== "string" ||
              profile.clientId !== env.SAVIA_CHATGPT_CLIENT_ID?.trim()
            )
              throw denied();
            const ctx = getCurrentAuthEndpointContext();
            const state = await getOAuthState();
            const attempt = state?.serverContext?.socialAttemptId
              ? await readSocialRegistration(
                  ctx.context.adapter,
                  state,
                  "chatgpt",
                )
              : null;
            const linked = await provenChatgptIdentity(
              profile,
              attempt?.tenantId,
              env,
              ctx.context.adapter,
            );
            if (linked)
              return {
                ...result,
                user: {
                  ...result.user,
                  email: linked.email,
                  emailVerified: true,
                },
              };
            if (
              !attempt ||
              !(await accountEmailAvailable(env, deps, attempt.tenantId).catch(
                () => false,
              ))
            )
              throw denied();
            const nonce = newVerificationNonce();
            const pending = await beginChatgptVerification(
              profile,
              attempt,
              nonce,
              env,
              ctx.context.adapter,
            );
            const cookie = ctx.context.createAuthCookie(
              "chatgpt_email_verification",
              { maxAge: 1200 },
            );
            if (!ctx.setSignedCookie || !ctx.redirect) throw denied();
            await ctx.setSignedCookie(
              cookie.name,
              nonce,
              ctx.context.secret,
              cookie.attributes,
            );
            await env.AUTH_DB.prepare(
              'DELETE FROM "verification" WHERE identifier=?',
            )
              .bind(REGISTRATION_PREFIX + attempt.attemptId)
              .run();
            const destination = new URL(
              "/api/auth/chatgpt-email-verification",
              attempt.returnOrigin,
            );
            destination.searchParams.set("id", pending.id);
            throw ctx.redirect(destination.href);
          },
        };
        socialProviders.push(
          wrapped as (typeof context.socialProviders)[number],
        );
      }
      return { context: { socialProviders } };
    },
  };
}

export async function completeMicrosoftVerification(
  pending: PendingVerification,
  env: AuthWorkerEnvironment,
  adapter: TenantSSOAdapter,
): Promise<void> {
  return completeFederatedVerification(pending, env, adapter, "microsoft");
}

export async function completeChatgptVerification(
  pending: PendingVerification,
  env: AuthWorkerEnvironment,
  adapter: TenantSSOAdapter,
): Promise<void> {
  return completeFederatedVerification(pending, env, adapter, "chatgpt");
}

async function completeFederatedVerification(
  pending: PendingVerification,
  env: AuthWorkerEnvironment,
  adapter: TenantSSOAdapter,
  provider: "microsoft" | "chatgpt",
): Promise<void> {
  const microsoft = provider === "microsoft";
  const bindingTable = microsoft
    ? "microsoft_email_binding"
    : "chatgpt_email_binding";
  const recoveryTable = microsoft
    ? "microsoft_registration_recovery"
    : "chatgpt_registration_recovery";
  const expectedPurpose = microsoft ? "microsoft_link" : "chatgpt_link";
  const expectedTenant = microsoft
    ? MICROSOFT_CONSUMER_DIRECTORY
    : env.SAVIA_CHATGPT_CLIENT_ID?.trim();
  if (!microsoft && !expectedTenant) throw denied();
  const proof = await env.AUTH_DB.prepare(
    "SELECT consumed_at FROM pending_email_verification WHERE id=?",
  )
    .bind(pending.id)
    .first<{ consumed_at: number | null }>();
  if (
    !proof?.consumed_at ||
    pending.purpose !== expectedPurpose ||
    pending.providerTenantId !== expectedTenant ||
    !pending.providerSubject
  )
    throw denied();
  const settings = await policy(
    adapter,
    pending.tenantId,
    provider,
    pending.revision,
  );
  await env.AUTH_DB.exec(microsoft ? TABLE : CHATGPT_TABLE);
  const bound = await env.AUTH_DB.prepare(
    `SELECT user_id FROM ${bindingTable} WHERE provider_subject=?${microsoft ? "" : " AND provider_tenant_id=?"}`,
  )
    .bind(
      ...(microsoft
        ? [pending.providerSubject]
        : [pending.providerSubject, expectedTenant]),
    )
    .first<{ user_id: string }>();
  let user = await adapter.findOne<LocalUser>({
    model: "user",
    where: [{ field: "email", value: pending.email }],
  });
  if (bound && bound.user_id !== user?.id) throw denied();
  if (
    user &&
    (user.banned ||
      user.emailTenantId !== pending.tenantId ||
      user.role?.split(",").includes("admin"))
  )
    throw denied();
  if (!env.SAVIA_IDENTITY || !env.SAVIA_INTERNAL_BRIDGE_KEY) throw denied();
  const headers = {
    "content-type": "application/json",
    "x-savia-bridge-key": env.SAVIA_INTERNAL_BRIDGE_KEY,
  };
  await env.AUTH_DB.exec(microsoft ? RECOVERY_TABLE : CHATGPT_RECOVERY_TABLE);
  await env.AUTH_DB.prepare(
    `DELETE FROM ${recoveryTable} WHERE user_id IN (SELECT r.user_id FROM ${recoveryTable} r WHERE r.created_at<? AND NOT EXISTS(SELECT 1 FROM "user" u WHERE u.id=r.user_id) LIMIT 100)`,
  )
    .bind(new Date(Date.now() - 20 * 60 * 1000).toISOString())
    .run();
  let recoveredAttempt: string | undefined;
  if (user && !bound) {
    const recovery = await env.AUTH_DB.prepare(
      `SELECT * FROM ${recoveryTable} WHERE user_id=?`,
    )
      .bind(user.id)
      .first<{
        intent_id: string;
        provider_subject: string;
        tenant_id: number;
        email: string;
        revision: string;
      }>();
    if (recovery) {
      if (
        !settings.allowRegistration ||
        user.role !== "user" ||
        !user.emailVerified ||
        recovery.provider_subject !== pending.providerSubject ||
        recovery.tenant_id !== pending.tenantId ||
        recovery.email !== pending.email
      )
        throw denied();
      recoveredAttempt =
        recovery.revision === pending.revision
          ? recovery.intent_id
          : pending.id;
    }
  }
  const proposedName = microsoft
    ? pending.email.split("@")[0]
    : (pending.displayName ?? pending.email.split("@")[0]);
  const ownedId = `${microsoft ? "ms" : "chatgpt"}-${pending.id}`;
  let created = false;
  if (!user) {
    if (!settings.allowRegistration) throw denied();
    await env.AUTH_DB.prepare(
      `INSERT INTO ${recoveryTable}(user_id,intent_id,provider_subject,tenant_id,email,name,revision,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO NOTHING`,
    )
      .bind(
        ownedId,
        pending.id,
        pending.providerSubject,
        pending.tenantId,
        pending.email,
        proposedName,
        pending.revision,
        new Date().toISOString(),
      )
      .run();
    user = await adapter.create<Record<string, unknown>, LocalUser>({
      model: "user",
      forceAllowId: true,
      data: {
        id: ownedId,
        email: pending.email,
        emailVerified: true,
        emailTenantId: pending.tenantId,
        role: "user",
        name: proposedName,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    created = true;
  }
  if (!user) throw denied();
  const owned = created || user.id === ownedId || !!recoveredAttempt;
  let response = await env.SAVIA_IDENTITY.fetch(
    new Request(
      `https://savia-identity.internal/_internal/social-registration${owned ? "" : "/eligible"}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          attemptId: recoveredAttempt ?? pending.id,
          tenantId: pending.tenantId,
          subject: user.id,
          email: pending.email,
          displayName: user.name ?? proposedName,
          provider,
          revision: pending.revision,
        }),
      },
    ),
  );
  if (!response.ok && recoveredAttempt) {
    response = await env.SAVIA_IDENTITY.fetch(
      new Request(
        "https://savia-identity.internal/_internal/social-registration/eligible",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            attemptId: pending.id,
            tenantId: pending.tenantId,
            subject: user.id,
            email: pending.email,
            displayName: user.name ?? proposedName,
            provider,
            revision: pending.revision,
          }),
        },
      ),
    );
  }
  if (!response.ok) throw denied();
  const latest = await adapter.findOne<LocalUser>({
    model: "user",
    where: [{ field: "id", value: user.id }],
  });
  if (
    !latest ||
    latest.email !== pending.email ||
    latest.emailTenantId !== pending.tenantId ||
    latest.banned ||
    latest.role?.split(",").includes("admin")
  )
    throw denied();
  if (!latest.emailVerified) {
    const changed = await env.AUTH_DB.prepare(
      `UPDATE "user" SET "emailVerified"=TRUE WHERE id=? AND email=? AND "emailTenantId"=? AND role='user' AND (banned=FALSE OR banned IS NULL) RETURNING id`,
    )
      .bind(user.id, pending.email, pending.tenantId)
      .first();
    if (!changed) throw denied();
  }
  await env.AUTH_DB.prepare(
    `INSERT INTO ${bindingTable}(provider_subject,provider_tenant_id,tenant_id,user_id,verified_email,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
  )
    .bind(
      pending.providerSubject,
      pending.providerTenantId,
      pending.tenantId,
      user.id,
      pending.email,
      new Date().toISOString(),
    )
    .run();
  const saved = await env.AUTH_DB.prepare(
    `SELECT user_id,tenant_id,verified_email FROM ${bindingTable} WHERE provider_subject=?${microsoft ? "" : " AND provider_tenant_id=?"}`,
  )
    .bind(
      ...(microsoft
        ? [pending.providerSubject]
        : [pending.providerSubject, expectedTenant]),
    )
    .first<{ user_id: string; tenant_id: number; verified_email: string }>();
  if (
    saved?.user_id !== user.id ||
    saved.tenant_id !== pending.tenantId ||
    saved.verified_email !== pending.email
  )
    throw denied();
  await env.AUTH_DB.prepare(`DELETE FROM ${recoveryTable} WHERE user_id=?`)
    .bind(user.id)
    .run();
}

function microsoftVerificationEndpoints(
  env: AuthWorkerEnvironment,
  deps: AccountEmailDependencies,
) {
  return federatedVerificationEndpoints("microsoft", env, deps);
}

function federatedVerificationEndpoints(
  provider: "microsoft" | "chatgpt",
  env: AuthWorkerEnvironment & ChatGPTEnvironment,
  deps: AccountEmailDependencies,
) {
  const base = `/${provider}-email-verification`;
  const purpose: VerificationPurpose =
    provider === "microsoft" ? "microsoft_link" : "chatgpt_link";
  const cookieName = `${provider}_email_verification`;
  const pageFor = (
    verification: { id: string; email: string; notice?: string },
    branding?: ReturnType<typeof tenantBrandingFromHeader>,
  ) => federatedVerificationPage(provider, verification, branding);
  const route = (path: string, method: "GET" | "POST") =>
    createAuthEndpoint(path, { method, requireHeaders: true }, async (ctx) => {
      const request = ctx.request;
      if (!request)
        throw new APIError("BAD_REQUEST", { message: "Request required" });
      const url = new URL(request.url),
        origin = url.origin;
      if (method === "POST" && request.headers.get("origin") !== origin)
        throw new APIError("FORBIDDEN", { message: "Invalid request origin" });
      const body =
        method === "POST" ? ((ctx.body ?? {}) as Record<string, unknown>) : {};
      const id = method === "POST" ? body.id : url.searchParams.get("id");
      if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
        throw new APIError("BAD_REQUEST", {
          message: "Invalid verification intent",
        });
      const cookie = ctx.context.createAuthCookie(cookieName, { maxAge: 1200 });
      const browserNonce = await ctx.getSignedCookie(
        cookie.name,
        ctx.context.secret,
      );
      if (!browserNonce)
        return pageFor({
          id,
          email: "",
          notice:
            "Abre el enlace en el navegador donde comenzaste. Si no lo tienes, inicia sesión otra vez.",
        });
      const expected = { browserNonce, origin, purpose };
      let pending: PendingVerification;
      try {
        pending = await readPendingVerification(id, env, expected);
        await policy(
          ctx.context.adapter,
          pending.tenantId,
          provider,
          pending.revision,
        );
      } catch {
        return pageFor({
          id,
          email: "",
          notice:
            "Este intento venció o ya no está autorizado. Inicia sesión otra vez.",
        });
      }
      let notice: string | undefined;
      if (path.endsWith("/send")) {
        try {
          if (
            typeof body.email !== "string" ||
            !/^\S+@\S+\.\S+$/.test(body.email) ||
            body.email.length > 254 ||
            /[\r\n<>]/.test(body.email)
          )
            throw denied();
          const email = body.email.trim().toLowerCase();
          if (email !== pending.email) {
            pending = { ...pending, email };
            const changed = await env.AUTH_DB.prepare(
              "UPDATE pending_email_verification SET value=?,token_hash=NULL,token_expires_at=NULL WHERE id=? AND consumed_at IS NULL RETURNING id",
            )
              .bind(JSON.stringify(pending), id)
              .first();
            if (!changed) throw denied();
          }
          await limitVerificationMail(env, {
            tenantId: pending.tenantId,
            email: pending.email,
            ip: getIP(request, ctx.context.options) ?? "unknown",
          });
          await sendPendingVerification(
            { id, browserNonce, origin },
            env,
            deps,
          );
          notice =
            "Revisa tu correo. Si puedes acceder a este equipo, recibirás un enlace de verificación.";
        } catch {
          notice =
            "No se pudo enviar el enlace. Espera un minuto y vuelve a intentarlo, o consulta con tu administrador.";
        }
      } else if (path.endsWith("/verify")) {
        try {
          const verified = await consumePendingVerification(
            {
              id,
              token: url.searchParams.get("token") ?? "",
              ...expected,
              tenantId: pending.tenantId,
            },
            env,
          );
          if (provider === "microsoft")
            await completeMicrosoftVerification(
              verified,
              env,
              ctx.context.adapter,
            );
          else
            await completeChatgptVerification(
              verified,
              env,
              ctx.context.adapter,
            );
          await ctx.setSignedCookie(cookie.name, "", ctx.context.secret, {
            ...cookie.attributes,
            maxAge: 0,
          });
          throw ctx.redirect(
            new URL("/api/auth/login", pending.returnOrigin).href,
          );
        } catch (error) {
          if (error instanceof APIError && error.status === "FOUND")
            throw error;
          notice =
            "No se pudo completar la verificación. Vuelve a iniciar sesión en este navegador o consulta con tu administrador.";
        }
      }
      return pageFor(
        { id, email: pending.email, notice },
        tenantBrandingFromHeader(
          request.headers.get("x-savia-tenant-branding"),
        ),
      );
    });
  return {
    [`${provider}EmailVerification`]: route(base, "GET"),
    [`${provider}EmailVerificationSend`]: route(`${base}/send`, "POST"),
    [`${provider}EmailVerificationVerify`]: route(`${base}/verify`, "GET"),
  };
}

function federatedVerificationPage(
  provider: "microsoft" | "chatgpt",
  verification: { id: string; email: string; notice?: string },
  branding?: ReturnType<typeof tenantBrandingFromHeader>,
): Response {
  return federatedEmailVerificationPage(provider, verification, branding);
}
