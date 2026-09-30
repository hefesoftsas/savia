import {
  microsoftVerificationPage,
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

export const MICROSOFT_CONSUMER_DIRECTORY =
  "9188040d-6c67-4c5b-b112-36a304b66dad";
const TABLE =
  "CREATE TABLE IF NOT EXISTS microsoft_email_binding (provider_subject TEXT PRIMARY KEY, provider_tenant_id TEXT NOT NULL, tenant_id BIGINT NOT NULL, user_id TEXT NOT NULL, verified_email TEXT NOT NULL, created_at TEXT NOT NULL)";
type Profile = {
  tid?: unknown;
  oid?: unknown;
  email?: unknown;
  name?: unknown;
};
type LocalUser = {
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
  allowMicrosoftPersonalAccounts: boolean;
  allowRegistration: boolean;
  revision: string;
};
const denied = () =>
  new Error(
    "This Microsoft account cannot access this tenant. Contact your administrator.",
  );
async function policy(
  adapter: TenantSSOAdapter,
  tenantId: number,
  revision?: string,
) {
  const settings = await adapter.findOne<Policy>({
    model: "tenantSocialSettings",
    where: [{ field: "tenantId", value: tenantId }],
  });
  if (
    !settings?.active ||
    !settings.microsoftEnabled ||
    !settings.allowMicrosoftPersonalAccounts ||
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
  await policy(adapter, attempt.tenantId, attempt.revision);
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
  await policy(adapter, binding.tenant_id);
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

export async function completeMicrosoftVerification(
  pending: PendingVerification,
  env: AuthWorkerEnvironment,
  adapter: TenantSSOAdapter,
): Promise<void> {
  const proof = await env.AUTH_DB.prepare(
    "SELECT consumed_at FROM pending_email_verification WHERE id=?",
  )
    .bind(pending.id)
    .first<{ consumed_at: number | null }>();
  if (
    !proof?.consumed_at ||
    pending.purpose !== "microsoft_link" ||
    pending.providerTenantId !== MICROSOFT_CONSUMER_DIRECTORY ||
    !pending.providerSubject
  )
    throw denied();
  const settings = await policy(adapter, pending.tenantId, pending.revision);
  await env.AUTH_DB.exec(TABLE);
  const bound = await env.AUTH_DB.prepare(
    "SELECT user_id FROM microsoft_email_binding WHERE provider_subject=?",
  )
    .bind(pending.providerSubject)
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
  const ownedId = `ms-${pending.id}`;
  let created = false;
  if (!user) {
    if (!settings.allowRegistration) throw denied();
    user = await adapter.create<Record<string, unknown>, LocalUser>({
      model: "user",
      forceAllowId: true,
      data: {
        id: ownedId,
        email: pending.email,
        emailVerified: true,
        emailTenantId: pending.tenantId,
        role: "user",
        name: pending.email.split("@")[0],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    created = true;
  }
  if (!user) throw denied();
  try {
    const owned = created || user.id === ownedId;
    const response = await env.SAVIA_IDENTITY.fetch(
      new Request(
        `https://savia-identity.internal/_internal/social-registration${owned ? "" : "/eligible"}`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            attemptId: pending.id,
            tenantId: pending.tenantId,
            subject: user.id,
            email: pending.email,
            displayName: pending.email.split("@")[0],
            provider: "microsoft",
            revision: pending.revision,
          }),
        },
      ),
    );
    if (!response.ok) throw denied();
    // Never turn an administrator's concurrent edits into this verified binding.
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
        'UPDATE "user" SET "emailVerified"=TRUE WHERE id=? AND email=? AND "emailTenantId"=? AND role=\'user\' AND (banned=FALSE OR banned IS NULL) RETURNING id',
      )
        .bind(user.id, pending.email, pending.tenantId)
        .first();
      if (!changed) throw denied();
    }
    await env.AUTH_DB.prepare(
      "INSERT INTO microsoft_email_binding(provider_subject,provider_tenant_id,tenant_id,user_id,verified_email,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(provider_subject) DO NOTHING",
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
      "SELECT user_id,tenant_id,verified_email FROM microsoft_email_binding WHERE provider_subject=?",
    )
      .bind(pending.providerSubject)
      .first<{ user_id: string; tenant_id: number; verified_email: string }>();
    if (
      saved?.user_id !== user.id ||
      saved.tenant_id !== pending.tenantId ||
      saved.verified_email !== pending.email
    )
      throw denied();
  } catch (error) {
    if (created) {
      const removed = await env.SAVIA_IDENTITY.fetch(
        new Request(
          `https://savia-identity.internal/_internal/social-registration/${pending.id}`,
          { method: "DELETE", headers },
        ),
      ).catch(() => null);
      if (removed?.ok)
        await env.AUTH_DB.prepare(
          'DELETE FROM "user" WHERE id=? AND email=? AND "emailTenantId"=? AND role=\'user\' AND (banned=FALSE OR banned IS NULL) AND NOT EXISTS(SELECT 1 FROM microsoft_email_binding WHERE user_id=?)',
        )
          .bind(ownedId, pending.email, pending.tenantId, ownedId)
          .run();
    }
    throw error;
  }
}

function microsoftVerificationEndpoints(
  env: AuthWorkerEnvironment,
  deps: AccountEmailDependencies,
) {
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
      const cookie = ctx.context.createAuthCookie(
        "microsoft_email_verification",
        { maxAge: 1200 },
      );
      const browserNonce = await ctx.getSignedCookie(
        cookie.name,
        ctx.context.secret,
      );
      if (!browserNonce)
        return microsoftVerificationPage({
          id,
          email: "",
          notice:
            "Abre el enlace en el navegador donde comenzaste. Si no lo tienes, inicia sesión otra vez.",
        });
      const expected = {
        browserNonce,
        origin,
        purpose: "microsoft_link" as const,
      };
      let pending: PendingVerification;
      try {
        pending = await readPendingVerification(id, env, expected);
        await policy(ctx.context.adapter, pending.tenantId, pending.revision);
      } catch {
        return microsoftVerificationPage({
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
          await completeMicrosoftVerification(
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
      return microsoftVerificationPage(
        { id, email: pending.email, notice },
        tenantBrandingFromHeader(
          request.headers.get("x-savia-tenant-branding"),
        ),
      );
    });
  return {
    microsoftEmailVerification: route("/microsoft-email-verification", "GET"),
    microsoftEmailVerificationSend: route(
      "/microsoft-email-verification/send",
      "POST",
    ),
    microsoftEmailVerificationVerify: route(
      "/microsoft-email-verification/verify",
      "GET",
    ),
  };
}
