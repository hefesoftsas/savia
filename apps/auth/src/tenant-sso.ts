import {
  sso,
  deriveSAMLIdentityProviderEntityID,
  type SAMLConfig,
} from "@better-auth/sso";
import { assertTenantAuthenticationActive } from "./tenant-auth-state";
import { DOMParser } from "@xmldom/xmldom";
import { APIError, createAuthMiddleware } from "better-auth/api";
import type { BetterAuthOptions } from "better-auth";
import type { AuthWorkerEnvironment } from "./index";
import { authNoticeBridgeAuthorized } from "./notification-events";

export type TenantSSOAdapter = Pick<
  Awaited<
    ReturnType<typeof import("better-auth").betterAuth>["$context"]
  >["adapter"],
  "findOne" | "findMany" | "create" | "update" | "delete" | "deleteMany"
>;
type Provider = {
  id: string;
  providerId: string;
  issuer: string;
  domain: string;
  samlConfig: string;
  saviaTenantId: number;
  saviaDisplayName: string;
  saviaEnabled: boolean;
  saviaSSOOnly: boolean;
  saviaRevision: string;
  saviaTenantActive: boolean;
};
type ScopedUser = {
  emailTenantId?: number | null;
  emailVerified?: boolean;
  role?: string | null;
  email: string;
  banned?: boolean | null;
};
const md = "urn:oasis:names:tc:SAML:2.0:metadata";
const ds = "http://www.w3.org/2000/09/xmldsig#";
const redirectBinding = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect";
export const disabledSSOPaths = [
  "/sso/register",
  "/sso/providers",
  "/sso/get-provider",
  "/sso/update-provider",
  "/sso/delete-provider",
  "/sso/request-domain-verification",
  "/sso/verify-domain",
];

export function parseTenantSAMLSettings(value: unknown, allowLocal: boolean) {
  if (!value || typeof value !== "object")
    throw new Error("Invalid SAML settings");
  const input = value as Record<string, unknown>;
  const displayName =
    typeof input.displayName === "string" ? input.displayName.trim() : "";
  const domain =
    typeof input.domain === "string" ? input.domain.trim().toLowerCase() : "";
  const idpMetadata =
    typeof input.idpMetadata === "string" ? input.idpMetadata.trim() : "";
  if (!displayName || displayName.length > 100)
    throw new Error("Enter a connection name (up to 100 characters)");
  if (
    domain.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(
      domain,
    )
  )
    throw new Error("Enter an exact email domain");
  if (
    typeof input.enabled !== "boolean" ||
    typeof input.ssoOnly !== "boolean" ||
    (input.ssoOnly && !input.enabled)
  )
    throw new Error("SSO-only requires an enabled connection");
  if (
    !idpMetadata ||
    new TextEncoder().encode(idpMetadata).length > 102400 ||
    /<!DOCTYPE|<!ENTITY/i.test(idpMetadata)
  )
    throw new Error(
      "Provide IdP metadata XML (maximum 100 KiB, without entities)",
    );
  // samlify brings an older ambient xmldom declaration; runtime is pinned to 0.9.12.
  const parserOptions = {
    onError: () => {
      throw new Error("Invalid IdP metadata XML");
    },
  };
  const xml = new DOMParser(
    parserOptions as ConstructorParameters<typeof DOMParser>[0],
  ).parseFromString(idpMetadata, "application/xml");
  const entities = xml.getElementsByTagNameNS(md, "EntityDescriptor");
  const descriptors = xml.getElementsByTagNameNS(md, "IDPSSODescriptor");
  if (
    entities.length !== 1 ||
    descriptors.length !== 1 ||
    xml.documentElement !== entities[0] ||
    descriptors[0]?.parentNode !== entities[0]
  )
    throw new Error(
      "Metadata must describe exactly one SAML identity provider",
    );
  const idpEntityId = entities[0]?.getAttribute("entityID")?.trim();
  if (!idpEntityId) throw new Error("Missing IdP entity ID");
  if (
    ["true", "1"].includes(
      descriptors[0]!.getAttribute("WantAuthnRequestsSigned") ?? "",
    )
  ) {
    throw new Error(
      "This connection uses unsigned AuthnRequests. Configure the IdP client and its metadata to accept them; signed assertions remain required.",
    );
  }
  const certificates = descriptors[0]!.getElementsByTagNameNS(
    ds,
    "X509Certificate",
  );
  if (
    !certificates.length ||
    !Array.from(certificates).some((c) => c.textContent?.trim())
  )
    throw new Error("Metadata requires a signing certificate");
  const services = Array.from(
    descriptors[0]!.getElementsByTagNameNS(md, "SingleSignOnService"),
  );
  const entryPoint = services
    .find((service) => service.getAttribute("Binding") === redirectBinding)
    ?.getAttribute("Location");
  if (!entryPoint)
    throw new Error("Metadata requires an HTTP-Redirect SSO endpoint");
  for (const service of services) {
    const url = new URL(service.getAttribute("Location") || "");
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      (url.protocol !== "https:" &&
        !(allowLocal && local && url.protocol === "http:"))
    )
      throw new Error(
        "IdP endpoints must use HTTPS (loopback HTTP is available only for explicit local tests)",
      );
  }
  return {
    displayName,
    domain,
    idpMetadata,
    enabled: input.enabled,
    ssoOnly: input.ssoOnly,
    idpEntityId,
    entryPoint,
  };
}

export function assertSAMLUser(
  provider: Pick<Provider, "saviaTenantId" | "saviaEnabled" | "domain"> | null,
  user: ScopedUser | null,
) {
  if (
    !provider?.saviaEnabled ||
    !Number.isSafeInteger(provider.saviaTenantId) ||
    provider.saviaTenantId <= 0 ||
    ("saviaTenantActive" in provider && provider.saviaTenantActive === false) ||
    !user ||
    user.banned ||
    user.role?.split(",").includes("admin") ||
    !user.emailVerified ||
    !Number.isSafeInteger(user.emailTenantId) ||
    user.emailTenantId! <= 0 ||
    user.emailTenantId !== provider.saviaTenantId ||
    user.email.split("@")[1]?.toLowerCase() !== provider.domain
  ) {
    throw new APIError("FORBIDDEN", {
      code: "TENANT_SSO_ACCESS_DENIED",
      message:
        "This account is not authorized for this organization's SSO connection",
    });
  }
}
const byProvider = (adapter: TenantSSOAdapter, providerId: string) =>
  adapter.findOne<Provider>({
    model: "ssoProvider",
    where: [{ field: "providerId", value: providerId }],
  });
const byTenant = (adapter: TenantSSOAdapter, tenantId: number) =>
  adapter.findOne<Provider>({
    model: "ssoProvider",
    where: [{ field: "saviaTenantId", value: tenantId }],
  });
export async function assertPasswordAllowed(
  adapter: TenantSSOAdapter,
  user: ScopedUser,
) {
  if (user.role?.split(",").includes("admin") || !user.emailTenantId) return;
  const provider = await byTenant(adapter, user.emailTenantId);
  if (provider?.saviaSSOOnly)
    throw new APIError("FORBIDDEN", {
      code: "SSO_REQUIRED",
      message: "Use your organization's single sign-on",
    });
}

export function tenantSSOPlugin() {
  return sso({
    providersLimit: 0,
    disableImplicitSignUp: true,
    domainVerification: { enabled: true },
    saml: {
      enableInResponseToValidation: true,
      allowIdpInitiated: false,
      requireTimestamps: true,
      algorithms: { onDeprecated: "reject" },
    },
    schema: {
      ssoProvider: {
        additionalFields: {
          saviaTenantId: {
            type: "number",
            required: false,
            input: false,
            unique: true,
            returned: false,
          },
          saviaTenantActive: {
            type: "boolean",
            required: false,
            input: false,
            returned: false,
            defaultValue: true,
          },
          saviaRevision: {
            type: "string",
            required: false,
            input: false,
            returned: false,
          },
          saviaDisplayName: { type: "string", required: false, input: false },
          saviaEnabled: {
            type: "boolean",
            required: false,
            input: false,
            defaultValue: false,
          },
          saviaSSOOnly: {
            type: "boolean",
            required: false,
            input: false,
            defaultValue: false,
          },
        },
      },
    },
  });
}

export const SAML_MFA_PREFIX = "savia-saml-mfa:";
const sessionGuards = new WeakMap<
  object,
  { user: ScopedUser; provider: Provider | null; passwordFlow: boolean }
>();

export function samlSessionProof(context: object) {
  return sessionGuards.get(context)?.provider;
}

export async function recordSAMLChallenge(
  adapter: TenantSSOAdapter,
  challenge: string,
  proof: Pick<Provider, "providerId" | "saviaRevision">,
) {
  const { providerId } = proof;
  const provider = await byProvider(adapter, providerId);
  const pending = await adapter.findOne<{ value: string; expiresAt: Date }>({
    model: "verification",
    where: [{ field: "identifier", value: challenge }],
  });
  if (
    !provider?.saviaEnabled ||
    provider.saviaTenantActive === false ||
    !pending ||
    provider.saviaRevision !== proof.saviaRevision
  )
    throw new APIError("FORBIDDEN", {
      message: "The SSO connection changed. Sign in again.",
    });
  await assertTenantAuthenticationActive(adapter, provider.saviaTenantId);
  const now = new Date();
  await adapter.create({
    model: "verification",
    data: {
      identifier: SAML_MFA_PREFIX + challenge,
      value: JSON.stringify({
        providerId,
        userId: pending.value,
        revision: provider.saviaRevision,
      }),
      expiresAt: pending.expiresAt,
      createdAt: now,
      updatedAt: now,
    },
  });
}

export const tenantSSOHooks: NonNullable<BetterAuthOptions["databaseHooks"]> = {
  user: {
    create: {
      before: async (_user, ctx) => {
        if (ctx?.path?.startsWith("/sso/"))
          throw new APIError("FORBIDDEN", {
            message:
              "SAML accounts must be provisioned by a tenant administrator",
          });
      },
    },
  },
  account: {
    create: {
      before: async (account, ctx) => {
        if (!account.providerId.startsWith("savia-saml-")) return;
        if (!ctx) throw new APIError("FORBIDDEN");
        const provider = await byProvider(
          ctx.context.adapter,
          account.providerId,
        );
        const user = await ctx.context.adapter.findOne<ScopedUser>({
          model: "user",
          where: [{ field: "id", value: account.userId }],
        });
        assertSAMLUser(provider, user);
        await assertTenantAuthenticationActive(
          ctx.context.adapter,
          provider!.saviaTenantId,
        );
      },
    },
  },
  session: {
    create: {
      before: async (session, ctx) => {
        if (!ctx) return;
        const adapter = ctx.context.adapter;
        const user = await adapter.findOne<ScopedUser>({
          model: "user",
          where: [{ field: "id", value: session.userId }],
        });
        if (!user || user.banned) throw new APIError("FORBIDDEN");
        const path = ctx.path ?? "";
        let provider: Provider | null = null;
        let passwordFlow =
          path === "/sign-in/email" || path === "/reset-password";
        if (path.startsWith("/sso/")) {
          provider = await byProvider(
            adapter,
            ctx.params?.providerId ?? path.split("/").pop() ?? "",
          );
          assertSAMLUser(provider, user);
          await assertTenantAuthenticationActive(
            adapter,
            provider!.saviaTenantId,
          );
        } else if (path.startsWith("/two-factor/verify-")) {
          const cookie = ctx.context.createAuthCookie("two_factor");
          const challenge = await ctx.getSignedCookie(
            cookie.name,
            ctx.context.secret,
          );
          const marker = challenge
            ? await adapter.findOne<{ value: string; expiresAt: Date }>({
                model: "verification",
                where: [
                  { field: "identifier", value: SAML_MFA_PREFIX + challenge },
                ],
              })
            : null;
          if (marker && new Date(marker.expiresAt).getTime() > Date.now()) {
            const proof = JSON.parse(marker.value) as {
              userId: string;
              providerId: string;
              revision: string;
            };
            provider = await byProvider(adapter, proof.providerId);
            if (
              proof.userId !== session.userId ||
              proof.revision !== provider?.saviaRevision
            )
              throw new APIError("FORBIDDEN", {
                message: "The SSO connection changed. Sign in again.",
              });
            assertSAMLUser(provider, user);
            await assertTenantAuthenticationActive(
              adapter,
              provider!.saviaTenantId,
            );
          } else passwordFlow = true;
        }
        if (passwordFlow) await assertPasswordAllowed(adapter, user);
        sessionGuards.set(ctx.context, { user, provider, passwordFlow });
      },
      after: async (session, ctx) => {
        if (!ctx) return;
        const guard = sessionGuards.get(ctx.context);
        if (!guard) return;
        const adapter = ctx.context.adapter;
        try {
          const user = await adapter.findOne<ScopedUser>({
            model: "user",
            where: [{ field: "id", value: session.userId }],
          });
          if (
            !user ||
            user.banned ||
            user.emailTenantId !== guard.user.emailTenantId ||
            user.emailVerified !== guard.user.emailVerified ||
            user.role !== guard.user.role
          )
            throw new APIError("FORBIDDEN", {
              message: "Account access changed. Sign in again.",
            });
          if (guard.provider) {
            const provider = await byProvider(
              adapter,
              guard.provider.providerId,
            );
            assertSAMLUser(provider, user);
            await assertTenantAuthenticationActive(
              adapter,
              provider!.saviaTenantId,
            );
            if (provider?.saviaRevision !== guard.provider.saviaRevision)
              throw new APIError("FORBIDDEN", {
                message: "The SSO connection changed. Sign in again.",
              });
          }
          if (guard.passwordFlow) await assertPasswordAllowed(adapter, user);
        } catch (error) {
          // D1 has no native transaction: remove a late insert before surfacing denial.
          await adapter.delete({
            model: "session",
            where: [{ field: "id", value: session.id }],
          });
          throw error;
        }
      },
    },
  },
};

export const tenantSSOBefore = createAuthMiddleware(async (ctx) => {
  if (ctx.path === "/sign-in/sso") {
    // Always require the explicit connection chosen in Savia's login page.
    const providerId = ctx.body?.providerId;
    const provider =
      typeof providerId === "string"
        ? await byProvider(ctx.context.adapter, providerId)
        : null;
    if (
      typeof providerId !== "string" ||
      !provider?.saviaEnabled ||
      provider.saviaTenantActive === false
    )
      throw new APIError("FORBIDDEN", {
        message: "SSO connection is unavailable",
      });
    await assertTenantAuthenticationActive(
      ctx.context.adapter,
      provider.saviaTenantId,
    );
  }
  if (
    ["/sign-in/email", "/request-password-reset"].includes(ctx.path) &&
    typeof ctx.body?.email === "string"
  ) {
    const user = await ctx.context.adapter.findOne<ScopedUser>({
      model: "user",
      where: [{ field: "email", value: ctx.body.email.trim().toLowerCase() }],
    });
    if (user) await assertPasswordAllowed(ctx.context.adapter, user);
  }
  if (ctx.path === "/reset-password") {
    const token = ctx.body?.token || ctx.query?.token;
    if (typeof token === "string") {
      const verification =
        await ctx.context.internalAdapter.findVerificationValue(
          `reset-password:${token}`,
        );
      if (verification) {
        const user = await ctx.context.adapter.findOne<ScopedUser>({
          model: "user",
          where: [{ field: "id", value: verification.value }],
        });
        if (user) await assertPasswordAllowed(ctx.context.adapter, user);
      }
    }
  }
});

function publicSettings(provider: Provider, base: string) {
  const config = JSON.parse(provider.samlConfig) as SAMLConfig;
  return {
    configured: true,
    displayName: provider.saviaDisplayName,
    domain: provider.domain,
    idpMetadata: config.idpMetadata.metadata,
    enabled: provider.saviaEnabled,
    ssoOnly: provider.saviaSSOOnly,
    providerId: provider.providerId,
    entityId: provider.issuer,
    acsUrl: `${base}/sso/saml2/sp/acs/${provider.providerId}`,
    metadataUrl: `${base}/sso/saml2/sp/metadata?providerId=${encodeURIComponent(provider.providerId)}`,
  };
}
async function revokeProviderSessions(
  database: D1Database,
  provider: Provider,
) {
  await database
    .prepare(
      'DELETE FROM "session" WHERE "userId" IN (SELECT id FROM "user" WHERE "emailTenantId" = ?)',
    )
    .bind(provider.saviaTenantId)
    .run();
}

export async function tenantSSOResponse(
  request: Request,
  environment: AuthWorkerEnvironment,
  adapter: TenantSSOAdapter,
): Promise<Response | null> {
  const url = new URL(request.url);
  const json = (data: unknown, status = 200) =>
    Response.json(data, { status, headers: { "cache-control": "no-store" } });
  if (
    url.pathname === "/api/auth/savia-sso/connections" &&
    request.method === "GET"
  ) {
    const domain = url.searchParams.get("domain")?.trim().toLowerCase();
    if (!domain) return json({ connections: [] });
    const providers = await adapter.findMany<Provider>({
      model: "ssoProvider",
      where: [
        { field: "domain", value: domain },
        { field: "saviaEnabled", value: true },
        { field: "saviaTenantActive", value: true },
      ],
      limit: 100,
    });
    return json({
      connections: providers.map((p) => ({
        providerId: p.providerId,
        displayName: p.saviaDisplayName,
      })),
    });
  }
  const match = url.pathname.match(
    /^\/_internal\/tenant-sso\/(\d+)(\/activity)?$/,
  );
  if (!match) return null;
  if (
    !authNoticeBridgeAuthorized(environment.SAVIA_INTERNAL_BRIDGE_KEY, request)
  )
    return json({ error: "Forbidden" }, 403);
  const tenantId = Number(match[1]);
  if (!Number.isSafeInteger(tenantId) || tenantId < 1)
    return json({ error: "Invalid tenant" }, 400);
  const base = `${new URL(environment.BETTER_AUTH_URL).origin}/api/auth`;
  const existing = await byTenant(adapter, tenantId);
  if (match[2]) {
    if (request.method !== "PATCH")
      return json({ error: "Method not allowed" }, 405);
    const body = (await request.json().catch(() => null)) as {
      active?: unknown;
    } | null;
    if (typeof body?.active !== "boolean")
      return json({ error: "Invalid tenant activity" }, 400);
    // One database batch changes all tenant login methods and revokes sessions.
    // This prevents partially reactivating one method if a later bridge call fails.
    const revision = crypto.randomUUID();
    await environment.AUTH_DB.batch([
      environment.AUTH_DB.prepare(
        'INSERT INTO "tenantAuthState" ("id","tenantId","active") VALUES (?,?,?) ON CONFLICT ("tenantId") DO UPDATE SET "active"=excluded."active"',
      ).bind(crypto.randomUUID(), tenantId, Number(body.active)),
      environment.AUTH_DB.prepare(
        'UPDATE "ssoProvider" SET "saviaTenantActive"=?,"saviaRevision"=? WHERE "saviaTenantId"=?',
      ).bind(Number(body.active), revision, tenantId),
      environment.AUTH_DB.prepare(
        'UPDATE "tenantSocialSettings" SET "active"=?,"revision"=? WHERE "tenantId"=?',
      ).bind(Number(body.active), revision, tenantId),
      environment.AUTH_DB.prepare(
        'DELETE FROM "session" WHERE "userId" IN (SELECT id FROM "user" WHERE "emailTenantId"=?)',
      ).bind(tenantId),
    ]);
    return new Response(null, { status: 204 });
  }
  if (request.method === "GET")
    return json(
      existing ? publicSettings(existing, base) : { configured: false },
    );
  if (request.method === "DELETE") {
    if (existing) {
      // Disable first so concurrent callbacks fail before removing bindings.
      await adapter.update({
        model: "ssoProvider",
        where: [{ field: "id", value: existing.id }],
        update: { saviaEnabled: false },
      });
      await revokeProviderSessions(environment.AUTH_DB, existing);
      await adapter.deleteMany({
        model: "account",
        where: [{ field: "providerId", value: existing.providerId }],
      });
      await adapter.delete({
        model: "ssoProvider",
        where: [{ field: "id", value: existing.id }],
      });
    }
    return json({ configured: false });
  }
  if (request.method !== "PUT")
    return json({ error: "Method not allowed" }, 405);
  let input: ReturnType<typeof parseTenantSAMLSettings>;
  let actorSubject: string;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    input = parseTenantSAMLSettings(
      body,
      environment.SAVIA_SSO_ALLOW_LOCAL_IDP === "true",
    );
    if (typeof body.actorSubject !== "string" || !body.actorSubject)
      throw new Error("Missing authenticated actor");
    actorSubject = body.actorSubject;
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : "Invalid SAML settings",
      },
      400,
    );
  }
  const previous = existing
    ? (JSON.parse(existing.samlConfig) as SAMLConfig)
    : null;
  const rotate =
    !!existing &&
    (existing.domain !== input.domain ||
      deriveSAMLIdentityProviderEntityID(previous!) !== input.idpEntityId);
  const providerId =
    !existing || rotate
      ? `savia-saml-${tenantId}-${crypto.randomUUID()}`
      : existing.providerId;
  const issuer = `${base}/sso/saml2/sp/${providerId}`;
  const samlConfig: SAMLConfig = {
    issuer,
    audience: issuer,
    entryPoint: input.entryPoint,
    idpMetadata: { metadata: input.idpMetadata },
    wantAssertionsSigned: true,
    authnRequestsSigned: false,
    mapping: { email: "email", name: "name" },
  };
  try {
    deriveSAMLIdentityProviderEntityID(samlConfig);
  } catch {
    return json({ error: "Invalid IdP authority in metadata" }, 400);
  }
  const data = {
    providerId,
    issuer,
    domain: input.domain,
    domainVerified: true,
    userId: actorSubject,
    samlConfig: JSON.stringify(samlConfig),
    saviaTenantId: tenantId,
    saviaDisplayName: input.displayName,
    saviaEnabled: input.enabled,
    saviaSSOOnly: input.ssoOnly,
    saviaRevision: crypto.randomUUID(),
  };
  if (existing) {
    await adapter.update({
      model: "ssoProvider",
      where: [{ field: "id", value: existing.id }],
      update: { saviaEnabled: false },
    });
    if (rotate)
      await adapter.deleteMany({
        model: "account",
        where: [{ field: "providerId", value: existing.providerId }],
      });
  }
  const saved = existing
    ? await adapter.update<Provider>({
        model: "ssoProvider",
        where: [{ field: "id", value: existing.id }],
        update: data,
      })
    : await adapter.create<Provider>({
        model: "ssoProvider",
        data: { ...data, saviaTenantActive: true },
      });
  // Apply the policy before revocation, including when SSO-only is enabled on first setup.
  await revokeProviderSessions(environment.AUTH_DB, saved!);
  return json(publicSettings(saved!, base));
}
