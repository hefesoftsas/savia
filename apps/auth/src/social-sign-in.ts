import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthMiddleware,
  addOAuthServerContext,
  getOAuthState,
} from "better-auth/api";
import {
  beginSocialRegistration,
  readSocialRegistration,
  REGISTRATION_PREFIX,
  type SocialRegistrationAttempt,
} from "./social-registration-context";
import { authNoticeBridgeAuthorized } from "./notification-events";
import { assertPasswordAllowed, type TenantSSOAdapter } from "./tenant-sso";
import type { AuthWorkerEnvironment } from "./index";
import { assertTenantAuthenticationActive } from "./tenant-auth-state";

export type SocialEnvironment = {
  SAVIA_GOOGLE_CLIENT_ID?: string;
  SAVIA_GOOGLE_CLIENT_SECRET?: string;
  SAVIA_MICROSOFT_CLIENT_ID?: string;
  SAVIA_MICROSOFT_CLIENT_SECRET?: string;
};
type Provider = "google" | "microsoft";
type Settings = {
  id: string;
  tenantId: number;
  googleEnabled: boolean;
  microsoftEnabled: boolean;
  microsoftTenantId: string;
  allowRegistration: boolean;
  allowMicrosoftPersonalAccounts: boolean;
  active: boolean;
  revision: string;
};
type User = {
  id: string;
  email: string;
  emailVerified: boolean;
  emailTenantId?: number;
  banned?: boolean;
  role?: string;
};
type Proof = {
  userId: string;
  email: string;
  tenantId: number;
  provider: Provider;
  revision: string;
  registration?: SocialRegistrationAttempt;
  registrationEnvironment?: AuthWorkerEnvironment;
  created?: boolean;
  finalized?: boolean;
  issued?: boolean;
  displayName?: string;
};
const MICROSOFT_CONSUMER_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad";
const proofs = new WeakMap<object, Proof>();
export const SOCIAL_MFA_PREFIX = "savia-social-mfa:";
const isProvider = (id: unknown): id is Provider =>
  id === "google" || id === "microsoft";
const deny = () =>
  new APIError("FORBIDDEN", {
    code: "SOCIAL_SIGN_IN_DENIED",
    message:
      "This account cannot use this sign-in method. Contact your administrator.",
  });
const byTenant = (adapter: TenantSSOAdapter, tenantId: number) =>
  adapter.findOne<Settings>({
    model: "tenantSocialSettings",
    where: [{ field: "tenantId", value: tenantId }],
  });

export function socialProviders(
  environment: SocialEnvironment,
): NonNullable<BetterAuthOptions["socialProviders"]> {
  const providers: NonNullable<BetterAuthOptions["socialProviders"]> = {};
  const googleId = environment.SAVIA_GOOGLE_CLIENT_ID?.trim();
  const googleSecret = environment.SAVIA_GOOGLE_CLIENT_SECRET?.trim();
  const microsoftId = environment.SAVIA_MICROSOFT_CLIENT_ID?.trim();
  const microsoftSecret = environment.SAVIA_MICROSOFT_CLIENT_SECRET?.trim();
  if (!!googleId !== !!googleSecret || !!microsoftId !== !!microsoftSecret)
    throw new Error(
      "Social sign-in requires both client ID and client secret for each configured provider",
    );
  if (googleId && googleSecret)
    providers.google = {
      clientId: googleId,
      clientSecret: googleSecret,
      disableSignUp: false,
      prompt: "select_account",
      includeGrantedScopes: false,
    };
  if (microsoftId && microsoftSecret)
    providers.microsoft = {
      clientId: microsoftId,
      clientSecret: microsoftSecret,
      disableSignUp: false,
      tenantId: "common",
      prompt: "select_account",
      disableDefaultScope: true,
      disableProfilePhoto: true,
      scope: ["openid", "profile", "email"],
    };
  return providers;
}

export function parseSocialSettings(value: unknown) {
  const input = value as Record<string, unknown> | null;
  if (
    !input ||
    typeof input.googleEnabled !== "boolean" ||
    typeof input.microsoftEnabled !== "boolean" ||
    typeof input.microsoftTenantId !== "string" ||
    (input.allowMicrosoftPersonalAccounts !== undefined &&
      typeof input.allowMicrosoftPersonalAccounts !== "boolean") ||
    (input.allowRegistration !== undefined &&
      typeof input.allowRegistration !== "boolean")
  )
    throw new Error("Invalid social sign-in settings");
  const microsoftTenantId = input.microsoftTenantId.trim().toLowerCase();
  if (
    (microsoftTenantId &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        microsoftTenantId,
      )) ||
    (input.microsoftEnabled && !microsoftTenantId) ||
    microsoftTenantId === "9188040d-6c67-4c5b-b112-36a304b66dad"
  )
    throw new Error(
      "Microsoft sign-in requires your organization's directory tenant ID (UUID)",
    );
  return {
    googleEnabled: input.googleEnabled,
    microsoftEnabled: input.microsoftEnabled,
    microsoftTenantId,
    allowRegistration: input.allowRegistration === true,
    allowMicrosoftPersonalAccounts:
      input.allowMicrosoftPersonalAccounts === true,
  };
}

export const tenantSocialPlugin = () =>
  ({
    id: "savia-tenant-social",
    schema: {
      tenantAuthState: {
        fields: {
          tenantId: {
            type: "number",
            required: true,
            unique: true,
            input: false,
          },
          active: { type: "boolean", required: true, input: false },
        },
      },
      tenantSocialSettings: {
        fields: {
          tenantId: {
            type: "number",
            required: true,
            unique: true,
            input: false,
          },
          googleEnabled: { type: "boolean", required: true, input: false },
          microsoftEnabled: { type: "boolean", required: true, input: false },
          microsoftTenantId: { type: "string", required: true, input: false },
          allowMicrosoftPersonalAccounts: {
            type: "boolean",
            required: true,
            defaultValue: false,
            input: false,
          },
          allowRegistration: {
            type: "boolean",
            required: true,
            defaultValue: false,
            input: false,
          },
          active: { type: "boolean", required: true, input: false },
          revision: { type: "string", required: true, input: false },
        },
      },
    },
  }) satisfies BetterAuthPlugin;

async function assertAllowed(
  adapter: TenantSSOAdapter,
  user: User | null,
  provider: Provider,
) {
  if (
    !user ||
    user.banned ||
    !user.emailVerified ||
    !Number.isSafeInteger(user.emailTenantId) ||
    user.emailTenantId! <= 0 ||
    user.role?.split(",").includes("admin")
  )
    throw deny();
  const tenantId = user.emailTenantId!;
  await assertPasswordAllowed(adapter, user);
  await assertTenantAuthenticationActive(adapter, tenantId);
  const settings = await byTenant(adapter, tenantId);
  if (
    !settings?.active ||
    !(provider === "google"
      ? settings.googleEnabled
      : settings.microsoftEnabled)
  )
    throw deny();
  return settings;
}

type ValidateSocialIdentity = NonNullable<
  NonNullable<BetterAuthOptions["user"]>["validateUserInfo"]
>;
export async function validateSocialIdentity(
  { user, source }: Parameters<ValidateSocialIdentity>[0],
  ctx: Parameters<ValidateSocialIdentity>[1],
  environment?: AuthWorkerEnvironment,
) {
  if (source.method !== "oauth") return;
  proofs.delete(ctx.context);
  const provider = source.oauth?.providerId;
  if (!isProvider(provider)) return { error: "social_provider_not_allowed" };
  try {
    if (!user.email || user.emailVerified !== true) throw deny();
    const local = await ctx.context.adapter.findOne<User>({
      model: "user",
      where: [{ field: "email", value: String(user.email).toLowerCase() }],
    });
    const oauthState = environment ? await getOAuthState() : null;
    let registration: SocialRegistrationAttempt | null = null;
    if (source.action === "create-user") {
      if (local || !environment?.SAVIA_IDENTITY) throw deny();
      registration = await readSocialRegistration(
        ctx.context.adapter,
        oauthState,
        provider,
      );
      if (!registration) throw deny();
    }
    if (local && oauthState?.serverContext?.socialAttemptId) {
      const attempt = await readSocialRegistration(
        ctx.context.adapter,
        oauthState,
        provider,
      );
      if (!attempt || attempt.tenantId !== local.emailTenantId) throw deny();
    }
    const settings = registration
      ? await byTenant(ctx.context.adapter, registration.tenantId)
      : await assertAllowed(ctx.context.adapter, local, provider);
    if (!settings) throw deny();
    if (
      provider === "microsoft" &&
      !(
        String(source.oauth?.profile?.tid ?? "").toLowerCase() ===
          settings.microsoftTenantId ||
        (settings.allowMicrosoftPersonalAccounts === true &&
          String(source.oauth?.profile?.tid ?? "").toLowerCase() ===
            MICROSOFT_CONSUMER_TENANT_ID)
      )
    )
      throw deny();
    if (registration) {
      const claimed = await environment!.AUTH_DB.prepare(
        'DELETE FROM "verification" WHERE identifier = ? RETURNING id',
      )
        .bind(REGISTRATION_PREFIX + registration.attemptId)
        .first();
      if (!claimed) throw deny();
    }
    proofs.set(ctx.context, {
      userId: local?.id ?? "",
      email: String(user.email).toLowerCase(),
      tenantId: settings.tenantId,
      provider,
      revision: settings.revision,
      ...(registration
        ? {
            registration,
            registrationEnvironment: environment,
            displayName: String(user.name ?? user.email),
          }
        : {}),
    });
  } catch {
    return {
      error: "social_sign_in_denied",
      errorDescription:
        "This account cannot use this sign-in method. Contact your administrator.",
    };
  }
}

export async function socialRegistrationBefore(
  ctx: Parameters<ValidateSocialIdentity>[1],
  environment: AuthWorkerEnvironment,
) {
  if (
    ctx.path !== "/sign-in/social" ||
    !isProvider(ctx.body?.provider) ||
    !ctx.request ||
    !environment.SAVIA_IDENTITY
  )
    return;
  const attempt = await beginSocialRegistration(
    ctx.request,
    ctx.body.provider,
    environment,
    ctx.context.adapter,
  );
  if (attempt)
    await addOAuthServerContext({ socialAttemptId: attempt.attemptId });
}

export const socialAfter = createAuthMiddleware(async (ctx) => {
  const proof = proofs.get(ctx.context);
  if (!proof?.registration || !proof.created || proof.issued) return;
  const environment = proof.registrationEnvironment!;
  const currentUser = await ctx.context.adapter.findOne<User>({
    model: "user",
    where: [{ field: "id", value: proof.userId }],
  });
  await ctx.context.internalAdapter.deleteUserSessions(proof.userId);
  // An administrator may have changed this new account while the callback ran.
  if (
    !currentUser ||
    currentUser.email !== proof.email ||
    currentUser.emailTenantId !== proof.tenantId ||
    currentUser.role !== "user"
  )
    return;
  // Compensate only the new account owned by this OAuth attempt.
  let removed = false;
  try {
    const response = await environment.SAVIA_IDENTITY!.fetch(
      new Request(
        `https://savia-identity.internal/_internal/social-registration/${proof.registration.attemptId}`,
        {
          method: "DELETE",
          headers: {
            "x-savia-bridge-key": environment.SAVIA_INTERNAL_BRIDGE_KEY!,
          },
        },
      ),
    );
    if (!response.ok) throw new Error("Identity compensation rejected");
    removed =
      ((await response.json()) as { removed?: boolean }).removed === true;
  } catch {
    // A failed bridge must never leave a usable auth account or session.
    console.error(
      "Federated registration compensation requires retry",
      proof.registration.attemptId,
    );
  }
  await ctx.context.internalAdapter.deleteUserSessions(proof.userId);
  if (removed) {
    await ctx.context.internalAdapter.deleteAccounts(proof.userId);
    await ctx.context.internalAdapter.deleteUser(proof.userId);
  } else {
    // Preserve the subject if identity cleanup was unavailable or an admin changed it.
    await ctx.context.adapter.update({
      model: "user",
      where: [{ field: "id", value: proof.userId }],
      update: {
        banned: true,
        banReason: `Federated registration needs reconciliation: ${proof.registration.attemptId}`,
      },
    });
  }
  await ctx.context.adapter.deleteMany({
    model: "verification",
    where: [
      {
        field: "identifier",
        value: REGISTRATION_PREFIX + proof.registration.attemptId,
      },
    ],
  });
});

export const socialBefore = createAuthMiddleware(async (ctx) => {
  if (ctx.path === "/sign-in/social") {
    if (
      !isProvider(ctx.body?.provider) ||
      ctx.body?.idToken ||
      ctx.body?.requestSignUp ||
      ctx.body?.scopes ||
      ctx.body?.additionalParams
    )
      throw deny();
  }
  // OAuth connections here are identity-only; prevent alternate linking/token APIs
  // from obtaining broader connector permissions or bypassing MFA policy.
  if (
    [
      "/link-social",
      "/unlink-account",
      "/get-access-token",
      "/refresh-token",
      "/account-info",
    ].includes(ctx.path)
  )
    throw deny();
});

export function socialSessionProof(context: object) {
  return proofs.get(context);
}
async function checkProof(
  adapter: TenantSSOAdapter,
  proof: Proof,
  userId: string,
) {
  if (proof.userId !== userId) throw deny();
  const user = await adapter.findOne<User>({
    model: "user",
    where: [{ field: "id", value: userId }],
  });
  const settings = await assertAllowed(adapter, user, proof.provider);
  if (
    settings.revision !== proof.revision ||
    settings.tenantId !== proof.tenantId ||
    user?.email !== proof.email
  )
    throw deny();
}

export async function recordSocialChallenge(
  adapter: TenantSSOAdapter,
  challenge: string,
  proof: Proof,
) {
  const pending = await adapter.findOne<{ value: string; expiresAt: Date }>({
    model: "verification",
    where: [{ field: "identifier", value: challenge }],
  });
  if (!pending) throw deny();
  await checkProof(adapter, proof, pending.value);
  await adapter.create({
    model: "verification",
    data: {
      identifier: SOCIAL_MFA_PREFIX + challenge,
      value: JSON.stringify(proof),
      expiresAt: pending.expiresAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

export const socialHooks: NonNullable<BetterAuthOptions["databaseHooks"]> = {
  user: {
    create: {
      before: async (_user, ctx) => {
        if (
          ctx?.path?.startsWith("/callback/") ||
          ctx?.path === "/sign-in/social"
        ) {
          const proof = ctx && proofs.get(ctx.context);
          if (
            !proof?.registration ||
            proof.created ||
            _user.email.toLowerCase() !== proof.email
          )
            throw deny();
          return {
            data: {
              ..._user,
              emailVerified: true,
              emailTenantId: proof.tenantId,
              role: "user",
            },
          };
        }
      },
      after: async (user, ctx) => {
        const proof = ctx && proofs.get(ctx.context);
        if (!proof?.registration) return;
        proof.userId = user.id;
        proof.created = true;
      },
    },
  },
  account: {
    create: {
      before: async (account, ctx) => {
        if (!isProvider(account.providerId)) return;
        const proof = ctx && proofs.get(ctx.context);
        if (!proof || proof.provider !== account.providerId) throw deny();
        if (proof.registration && !proof.userId) {
          // Better Auth can defer user.create.after until the account transaction
          // completes. Bind the new user here before validating the account.
          proof.userId = account.userId;
          proof.created = true;
        }
        await checkProof(ctx!.context.adapter, proof, account.userId);
      },
    },
  },
  session: {
    create: {
      before: async (session, ctx) => {
        if (!ctx) return;
        let proof = proofs.get(ctx.context);
        if (
          /^\/callback\/(google|microsoft|:id)$/.test(ctx.path ?? "") ||
          ctx.path === "/sign-in/social"
        ) {
          if (!proof) throw deny();
        } else if (ctx.path?.startsWith("/two-factor/verify-")) {
          const cookie = ctx.context.createAuthCookie("two_factor");
          const challenge = await ctx.getSignedCookie(
            cookie.name,
            ctx.context.secret,
          );
          const marker = challenge
            ? await ctx.context.adapter.findOne<{
                value: string;
                expiresAt: Date;
              }>({
                model: "verification",
                where: [
                  { field: "identifier", value: SOCIAL_MFA_PREFIX + challenge },
                ],
              })
            : null;
          if (marker) {
            if (new Date(marker.expiresAt).getTime() <= Date.now())
              throw deny();
            proof = JSON.parse(marker.value) as Proof;
            proofs.set(ctx.context, proof);
          }
        }
        if (proof?.registration && !proof.finalized) {
          const environment = proof.registrationEnvironment!;
          let response: Response;
          try {
            response = await environment.SAVIA_IDENTITY!.fetch(
              new Request(
                "https://savia-identity.internal/_internal/social-registration",
                {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    "x-savia-bridge-key":
                      environment.SAVIA_INTERNAL_BRIDGE_KEY!,
                  },
                  body: JSON.stringify({
                    attemptId: proof.registration.attemptId,
                    tenantId: proof.tenantId,
                    subject: proof.userId,
                    email: proof.email,
                    displayName: proof.displayName,
                    provider: proof.provider,
                    revision: proof.revision,
                  }),
                },
              ),
            );
          } catch {
            throw deny();
          }
          if (!response.ok) throw deny();
          proof.finalized = true;
        }
        if (proof) await checkProof(ctx.context.adapter, proof, session.userId);
      },
      after: async (session, ctx) => {
        const proof = ctx && proofs.get(ctx.context);
        if (!ctx || !proof) return;
        try {
          await checkProof(ctx.context.adapter, proof, session.userId);
          if (proof.registration) {
            await ctx.context.adapter.deleteMany({
              model: "verification",
              where: [
                {
                  field: "identifier",
                  value: REGISTRATION_PREFIX + proof.registration.attemptId,
                },
              ],
            });
            proof.issued = true;
          }
        } catch (error) {
          await ctx.context.adapter.delete({
            model: "session",
            where: [{ field: "id", value: session.id }],
          });
          throw error;
        }
      },
    },
  },
};

export async function tenantSocialResponse(
  request: Request,
  environment: AuthWorkerEnvironment & SocialEnvironment,
  adapter: TenantSSOAdapter,
): Promise<Response | null> {
  const url = new URL(request.url);
  const providers = socialProviders(environment);
  const json = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { "cache-control": "no-store" } });
  if (
    url.pathname === "/api/auth/savia-social/providers" &&
    request.method === "GET"
  )
    return json({ providers: Object.keys(providers) });
  const match = url.pathname.match(
    /^\/_internal\/tenant-social\/(\d+)(\/activity)?$/,
  );
  if (!match) return null;
  if (
    !authNoticeBridgeAuthorized(environment.SAVIA_INTERNAL_BRIDGE_KEY, request)
  )
    return json({ error: "Forbidden" }, 403);
  const tenantId = Number(match[1]);
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0)
    return json({ error: "Invalid tenant" }, 400);
  let existing = await byTenant(adapter, tenantId);
  const response = () => ({
    configured: !!existing,
    googleEnabled: existing?.googleEnabled ?? false,
    microsoftEnabled: existing?.microsoftEnabled ?? false,
    microsoftTenantId: existing?.microsoftTenantId ?? "",
    allowRegistration: existing?.allowRegistration === true,
    allowMicrosoftPersonalAccounts:
      existing?.allowMicrosoftPersonalAccounts === true,
    active: existing?.active ?? false,
    revision: existing?.revision ?? "",
    googleAvailable: !!providers.google,
    microsoftAvailable: !!providers.microsoft,
    googleCallbackUrl: `${new URL(environment.BETTER_AUTH_URL).origin}/api/auth/callback/google`,
    microsoftCallbackUrl: `${new URL(environment.BETTER_AUTH_URL).origin}/api/auth/callback/microsoft`,
  });
  const revoke = () =>
    environment.AUTH_DB.prepare(
      'DELETE FROM "session" WHERE "userId" IN (SELECT id FROM "user" WHERE "emailTenantId" = ?)',
    )
      .bind(tenantId)
      .run();
  if (match[2]) {
    if (request.method !== "PATCH")
      return json({ error: "Method not allowed" }, 405);
    const body = (await request.json().catch(() => null)) as {
      active?: unknown;
    } | null;
    if (typeof body?.active !== "boolean")
      return json({ error: "Invalid tenant activity" }, 400);
    if (existing) {
      await adapter.update({
        model: "tenantSocialSettings",
        where: [{ field: "id", value: existing.id }],
        update: { active: body.active, revision: crypto.randomUUID() },
      });
      await revoke();
    }
    return new Response(null, { status: 204 });
  }
  if (request.method === "GET") return json(response());
  if (request.method === "DELETE") {
    if (existing) {
      await adapter.update({
        model: "tenantSocialSettings",
        where: [{ field: "id", value: existing.id }],
        update: { active: false, revision: crypto.randomUUID() },
      });
      await revoke();
      await adapter.delete({
        model: "tenantSocialSettings",
        where: [{ field: "id", value: existing.id }],
      });
      existing = null;
    }
    return json(response());
  }
  if (request.method !== "PUT")
    return json({ error: "Method not allowed" }, 405);
  let settings: ReturnType<typeof parseSocialSettings>;
  try {
    settings = parseSocialSettings(await request.json());
    if (
      (settings.googleEnabled && !providers.google) ||
      (settings.microsoftEnabled && !providers.microsoft)
    )
      throw new Error(
        "Configure the provider's client ID and secret in the deployment before enabling it",
      );
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Invalid settings" },
      400,
    );
  }
  const data = {
    ...settings,
    tenantId,
    revision: crypto.randomUUID(),
  };
  existing = existing
    ? await adapter.update<Settings>({
        model: "tenantSocialSettings",
        where: [{ field: "id", value: existing.id }],
        update: data,
      })
    : await adapter.create<Settings>({
        model: "tenantSocialSettings",
        data: { ...data, active: true },
      });
  await revoke();
  return json(response());
}
