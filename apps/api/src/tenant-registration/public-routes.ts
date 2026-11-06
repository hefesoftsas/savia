import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import type { AuthService } from "../auth/better-auth";
import { canonicalHostForApi } from "../auth/tenant-host-guard";
import {
  captchaProofIdentity,
  createCaptchaChallenge,
  verifyCaptchaProof,
} from "../captcha/verification";
import { captchaConfiguration } from "../public-forms/captcha";
import {
  readTenantBranding,
  type TenantBrandingConfig,
} from "../tenant-branding/service";
import { parseTenantSlugFromHostname } from "@savia/tenant-host/tenant-host";
import { resolveTenantSlug } from "../tenant-slugs";
import {
  registrationBridge,
  registrationCaptchaOptions,
} from "./settings-routes";
import type { CaptchaOptions } from "../public-forms/captcha";

type PublicTenant = { id: number; id_slug: string; name: string };
type EffectiveSettings = {
  allowEmailRegistration?: unknown;
  passwordAllowed?: unknown;
  captchaMode?: unknown;
  siteKey?: unknown;
  secretKey?: unknown;
  secretConfigured?: unknown;
  emailReady?: unknown;
  revision?: unknown;
};
type PublicRegistrationOptions = CaptchaOptions;
type Bridge = Pick<AuthService, "fetch">;

const safeConfigSchema = z.object({
  tenantId: z.number().int().positive(),
  tenantName: z.string(),
  logoUrl: z.string().optional(),
  loginUrl: z.string(),
  captchaProvider: z.enum(["turnstile", "altcha"]),
  siteKey: z.string().optional(),
});
const requestSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().email().max(254),
    password: z.string().min(12).max(128),
    passwordConfirmation: z.string().min(12).max(128),
    captchaToken: z.string().min(1).max(32_768),
    requestId: z.string().uuid(),
  })
  .strict();
const unavailable = () =>
  new HTTPException(404, { message: "Registration unavailable." });
const serviceUnavailable = () =>
  new HTTPException(503, {
    message: "Registration is temporarily unavailable.",
  });
const jsonResponse = {
  description: "Tenant registration response",
  content: {
    "application/json": { schema: z.record(z.string(), z.unknown()) },
  },
};

function actualOrigin(request: Request): string | null {
  try {
    const url = new URL(request.url);
    if (!["https:", "http:"].includes(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function tenantFromTrustedHostname(
  db: D1Database,
  request: Request,
  canonicalHost: string,
): Promise<PublicTenant | null> {
  let hostname: string;
  try {
    hostname = new URL(request.url).hostname;
  } catch {
    return null;
  }
  const slug = parseTenantSlugFromHostname(hostname, canonicalHost);
  if (!slug) return null;
  const tenant = await resolveTenantSlug(db, slug);
  return tenant
    ? { id: tenant.id, id_slug: tenant.idSlug, name: tenant.name }
    : null;
}

async function effectiveSettings(
  bridge: Bridge | undefined,
  key: string | undefined,
  tenantId: number,
): Promise<EffectiveSettings> {
  const value = (await registrationBridge(
    bridge,
    key,
    tenantId,
    "GET",
    undefined,
    true,
  )) as EffectiveSettings;
  return value;
}

async function loadPublicContext(
  db: D1Database,
  request: Request,
  canonicalHost: string,
  bridge: Bridge | undefined,
  bridgeKey: string | undefined,
  options: PublicRegistrationOptions,
) {
  const tenant = await tenantFromTrustedHostname(db, request, canonicalHost);
  if (!tenant) throw unavailable();
  const settings = await effectiveSettings(bridge, bridgeKey, tenant.id);
  if (
    settings.allowEmailRegistration !== true ||
    settings.passwordAllowed !== true ||
    settings.emailReady !== true ||
    typeof settings.revision !== "string" ||
    typeof settings.captchaMode !== "string" ||
    typeof settings.siteKey !== "string"
  )
    throw unavailable();
  if (!options.rateLimiter) throw unavailable();
  const captchaOptions = registrationCaptchaOptions(options, {
    captchaMode: settings.captchaMode,
    siteKey: settings.siteKey,
    ...(typeof settings.secretKey === "string"
      ? { secretKey: settings.secretKey }
      : {}),
  });
  const origin = actualOrigin(request);
  if (!origin) throw unavailable();
  const requestCaptchaOptions = { ...captchaOptions, publicOrigin: origin };
  const provider =
    options.captchaProvider === "altcha" ? "altcha" : "turnstile";
  try {
    // Readiness uses deployment configuration; this check also rejects malformed
    // per-tenant credentials after applying them.
    captchaConfiguration(requestCaptchaOptions);
  } catch {
    throw unavailable();
  }
  if (provider === "turnstile" && typeof captchaOptions.siteKey !== "string")
    throw unavailable();
  const branding = await readTenantBranding(db, tenant);
  const loginUrl = "/api/auth/login";
  return {
    tenant,
    settings,
    captchaOptions: requestCaptchaOptions,
    provider,
    branding,
    loginUrl,
  };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function hmacFingerprint(
  secret: string,
  value: unknown,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function rateLimit(
  options: PublicRegistrationOptions,
  tenantId: number,
  ip: string,
  email?: string,
) {
  if (!options.rateLimiter) throw unavailable();
  const keys = [
    `tenant-signup:tenant:${tenantId}`,
    `tenant-signup:tenant-ip:${tenantId}:${await sha256(ip)}`,
    ...(email
      ? [`tenant-signup:tenant-email:${tenantId}:${await sha256(email)}`]
      : []),
  ];
  try {
    for (const key of keys)
      if (!(await options.rateLimiter.limit({ key })).success)
        throw new HTTPException(429, {
          message: "Too many registration attempts. Try again later.",
        });
  } catch (error) {
    if (error instanceof HTTPException && error.status === 429) throw error;
    throw serviceUnavailable();
  }
}

function consumeStatus(
  db: D1Database,
  proofHash: string,
  status: "verified" | "accepted" | "failed",
) {
  return db
    .prepare(
      "UPDATE registration_captcha_consumption SET status=? WHERE proof_hash=?",
    )
    .bind(status, proofHash)
    .run();
}

async function cleanupExpiredProofs(db: D1Database): Promise<void> {
  await db
    .prepare(
      "DELETE FROM registration_captcha_consumption WHERE proof_hash IN (SELECT proof_hash FROM registration_captcha_consumption WHERE expires_at<=? ORDER BY expires_at LIMIT 100)",
    )
    .bind(Date.now())
    .run();
}

async function startAuthRegistration(
  bridge: Bridge | undefined,
  bridgeKey: string | undefined,
  input: {
    attemptId: string;
    tenantId: number;
    name: string;
    email: string;
    password: string;
    revision: string;
    origin: string;
  },
): Promise<void> {
  if (!bridge || !bridgeKey?.trim()) throw serviceUnavailable();
  let response: Response;
  try {
    response = await bridge.fetch(
      new Request(
        "https://savia-auth.internal/_internal/email-registration/start",
        {
          method: "POST",
          headers: {
            "x-savia-bridge-key": bridgeKey,
            "content-type": "application/json",
          },
          body: JSON.stringify(input),
        },
      ),
    );
  } catch {
    throw serviceUnavailable();
  }
  if (!response.ok) throw serviceUnavailable();
}

export function registerPublicTenantRegistrationRoutes(
  app: OpenAPIHono,
  db: D1Database,
  bridge: Bridge | undefined,
  bridgeKey: string | undefined,
  options: PublicRegistrationOptions = {},
) {
  const canonicalHost = canonicalHostForApi(options.publicOrigin);
  const prefix = "/v1/public/registration";
  for (const path of [prefix, `${prefix}/*`])
    app.use(path, async (c, next) => {
      c.header("Cache-Control", "no-store");
      c.header("X-Robots-Tag", "noindex, nofollow");
      c.header("Referrer-Policy", "no-referrer");
      await next();
    });
  for (const path of [prefix, `${prefix}/*`])
    app.use(path, bodyLimit({ maxSize: 65_536 }));

  app.openapi(
    createRoute({
      method: "get",
      path: prefix,
      security: [],
      tags: ["Tenant Registration"],
      responses: { 200: jsonResponse, 404: jsonResponse, 503: jsonResponse },
    }),
    async (c) => {
      const context = await loadPublicContext(
        db,
        c.req.raw,
        canonicalHost,
        bridge,
        bridgeKey,
        options,
      );
      const branding = context.branding as TenantBrandingConfig;
      const body = safeConfigSchema.parse({
        tenantId: context.tenant.id,
        tenantName: branding.displayName,
        ...(branding.logoUrl ? { logoUrl: branding.logoUrl } : {}),
        loginUrl: context.loginUrl,
        captchaProvider: context.provider,
        ...(context.provider === "turnstile"
          ? { siteKey: (context.captchaOptions as CaptchaOptions).siteKey }
          : {}),
      });
      return c.json(body, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: `${prefix}/challenge`,
      security: [],
      tags: ["Tenant Registration"],
      responses: {
        200: jsonResponse,
        404: jsonResponse,
        429: jsonResponse,
        503: jsonResponse,
      },
    }),
    async (c) => {
      const context = await loadPublicContext(
        db,
        c.req.raw,
        canonicalHost,
        bridge,
        bridgeKey,
        options,
      );
      if (context.provider !== "altcha") throw unavailable();
      const ip = c.req.header("cf-connecting-ip") ?? "unknown";
      await rateLimit(options, context.tenant.id, ip);
      await cleanupExpiredProofs(db);
      const challenge = await createCaptchaChallenge(context.captchaOptions, {
        purpose: "tenant_signup",
        subject: String(context.tenant.id),
        origin: actualOrigin(c.req.raw)!,
      });
      return c.json(challenge, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: prefix,
      security: [],
      tags: ["Tenant Registration"],
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: requestSchema } },
        },
      },
      responses: {
        200: jsonResponse,
        400: jsonResponse,
        403: jsonResponse,
        404: jsonResponse,
        429: jsonResponse,
        503: jsonResponse,
      },
    }),
    async (c) => {
      const origin = actualOrigin(c.req.raw);
      if (!origin || c.req.header("origin") !== origin)
        throw new HTTPException(403, {
          message: "Registration request rejected.",
        });
      const body = requestSchema.parse(await c.req.json());
      if (body.password !== body.passwordConfirmation)
        throw new HTTPException(400, { message: "Passwords do not match." });
      const context = await loadPublicContext(
        db,
        c.req.raw,
        canonicalHost,
        bridge,
        bridgeKey,
        options,
      );
      const tenantId = context.tenant.id;
      const email = body.email.trim().toLowerCase();
      const name = body.name.trim();
      const ip = c.req.header("cf-connecting-ip") ?? "unknown";
      await rateLimit(options, tenantId, ip, email);
      await cleanupExpiredProofs(db);
      if (!bridgeKey?.trim()) throw serviceUnavailable();

      let identity: ReturnType<typeof captchaProofIdentity>;
      try {
        identity = captchaProofIdentity(
          context.captchaOptions,
          body.captchaToken,
        );
      } catch {
        throw new HTTPException(403, {
          message: "Verification failed. Complete the challenge again.",
        });
      }
      const proofHash = await sha256(identity.key);
      const fingerprint = await hmacFingerprint(bridgeKey, {
        tenantId,
        requestId: body.requestId,
        name,
        email,
        password: body.password,
        revision: context.settings.revision,
        origin,
      });
      const expiresAt = Date.now() + 60 * 60 * 1000;
      const claimed = await db
        .prepare(
          "INSERT OR IGNORE INTO registration_captcha_consumption(proof_hash,request_id,tenant_id,fingerprint,status,expires_at) VALUES(?,?,?,?,'pending',?)",
        )
        .bind(proofHash, body.requestId, tenantId, fingerprint, expiresAt)
        .run();
      if (claimed.meta.changes === 0) {
        const existing = await db
          .prepare(
            "SELECT proof_hash,request_id,tenant_id,fingerprint,status,expires_at FROM registration_captcha_consumption WHERE proof_hash=? OR request_id=?",
          )
          .bind(proofHash, body.requestId)
          .first<{
            proof_hash: string;
            request_id: string;
            tenant_id: number;
            fingerprint: string;
            status: string;
            expires_at: number;
          }>();
        if (
          !existing ||
          existing.proof_hash !== proofHash ||
          existing.request_id !== body.requestId ||
          existing.tenant_id !== tenantId ||
          existing.fingerprint !== fingerprint ||
          existing.expires_at <= Date.now()
        )
          throw new HTTPException(403, {
            message: "Registration request rejected.",
          });
        if (existing.status === "accepted")
          return c.json({ accepted: true }, 200);
        if (existing.status !== "verified")
          throw new HTTPException(403, {
            message: "Verification failed. Complete the challenge again.",
          });
        await startAuthRegistration(bridge, bridgeKey, {
          attemptId: body.requestId,
          tenantId,
          name,
          email,
          password: body.password,
          revision: String(context.settings.revision),
          origin,
        });
        await consumeStatus(db, proofHash, "accepted");
        return c.json({ accepted: true }, 200);
      }

      try {
        await verifyCaptchaProof(context.captchaOptions, {
          token: body.captchaToken,
          submissionId: body.requestId,
          ip,
          binding: {
            purpose: "tenant_signup",
            subject: String(tenantId),
            origin,
          },
        });
      } catch (error) {
        await consumeStatus(db, proofHash, "failed");
        if (error instanceof HTTPException && error.status === 503)
          throw serviceUnavailable();
        throw new HTTPException(403, {
          message: "Verification failed. Complete the challenge again.",
        });
      }
      await consumeStatus(db, proofHash, "verified");
      try {
        await startAuthRegistration(bridge, bridgeKey, {
          attemptId: body.requestId,
          tenantId,
          name,
          email,
          password: body.password,
          revision: String(context.settings.revision),
          origin,
        });
      } catch {
        // Leave the durable proof verified so an identical request can retry
        // the bridge without consuming single-use Turnstile again.
        throw serviceUnavailable();
      }
      await consumeStatus(db, proofHash, "accepted");
      return c.json({ accepted: true }, 200);
    },
  );
}
