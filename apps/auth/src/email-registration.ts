import { APIError } from "better-auth/api";
import type { BetterAuthOptions } from "better-auth";
import type { AuthWorkerEnvironment, createBetterAuth } from "./index";
import { readTenantRegistrationSettings } from "./tenant-registration-settings";
import {
  accountEmailAvailable,
  type AccountEmailDependencies,
} from "./account-email";
import { authNoticeBridgeAuthorized } from "./notification-events";
import { assertPasswordAllowed, type TenantSSOAdapter } from "./tenant-sso";
import { assertTenantAuthenticationActive } from "./tenant-auth-state";
import {
  isAllowedPublicOrigin,
  normalizeCanonicalHost,
} from "@savia/tenant-host/tenant-host";
import { limitVerificationMail } from "./pending-email-verification";

const schema = `CREATE TABLE IF NOT EXISTS pending_password_registration (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, tenant_id BIGINT NOT NULL,
 email TEXT NOT NULL, name TEXT NOT NULL, revision TEXT NOT NULL,
 fingerprint TEXT NOT NULL, status TEXT NOT NULL, expires_at BIGINT NOT NULL)`.replace(
  /\n/g,
  " ",
);
type Pending = {
  id: string;
  user_id: string;
  tenant_id: number;
  email: string;
  name: string;
  revision: string;
  fingerprint: string;
  status: string;
  expires_at: number;
};
type LocalUser = {
  id: string;
  email: string;
  name: string;
  role?: string | null;
  banned?: boolean | null;
  emailVerified: boolean;
  emailTenantId?: number | null;
};
type Auth = ReturnType<typeof createBetterAuth>;
const response = (status = 200) =>
  Response.json(
    { status: status === 200 },
    { status, headers: { "cache-control": "no-store" } },
  );
export async function registrationPasswordAllowed(
  adapter: TenantSSOAdapter,
  tenantId: number,
) {
  try {
    await assertTenantAuthenticationActive(adapter, tenantId);
    await assertPasswordAllowed(adapter, {
      email: "",
      role: "user",
      emailTenantId: tenantId,
    });
    return true;
  } catch {
    return false;
  }
}
async function policy(
  environment: AuthWorkerEnvironment,
  adapter: TenantSSOAdapter,
  tenantId: number,
  revision: string,
) {
  const settings = await readTenantRegistrationSettings(environment, tenantId);
  if (
    !settings.allowEmailRegistration ||
    settings.revision !== revision ||
    !(await registrationPasswordAllowed(adapter, tenantId))
  )
    throw new APIError("FORBIDDEN", {
      message: "Registration is unavailable for this tenant",
    });
}
async function fingerprint(secret: string, input: unknown) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(JSON.stringify(input)),
    ),
  );
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
async function removeOwnedUnverified(
  env: AuthWorkerEnvironment,
  pending: Pending,
) {
  // The predicate is evaluated atomically. Verification or administrative edits preserve the account.
  const deleted = await env.AUTH_DB.prepare(
    `DELETE FROM "user" WHERE id=? AND email=? AND name=? AND "emailTenantId"=? AND "emailVerified"=FALSE AND role='user' AND (banned IS NULL OR banned=FALSE) AND NOT EXISTS(SELECT 1 FROM "session" WHERE "userId"=?) RETURNING id`,
  )
    .bind(
      pending.user_id,
      pending.email,
      pending.name,
      pending.tenant_id,
      pending.user_id,
    )
    .first<{ id: string }>();
  if (deleted)
    await env.AUTH_DB.prepare('DELETE FROM "account" WHERE "userId"=?')
      .bind(pending.user_id)
      .run();
}
export async function cleanupPasswordRegistrations(env: AuthWorkerEnvironment) {
  await env.AUTH_DB.exec(schema);
  const rows = await env.AUTH_DB.prepare(
    "SELECT * FROM pending_password_registration WHERE expires_at<? AND status NOT IN ('expired','verified_pending') LIMIT 25",
  )
    .bind(Date.now())
    .all<Pending>();
  for (const row of rows.results ?? []) {
    if (row.status !== "completed" && row.status !== "existing")
      await removeOwnedUnverified(env, row);
    // Preserve the guard for verified or administratively changed pending users: expiration cannot grant access.
    const user = await env.AUTH_DB.prepare('SELECT * FROM "user" WHERE id=?')
      .bind(row.user_id)
      .first<LocalUser>();
    if (user && !["completed", "existing"].includes(row.status))
      await env.AUTH_DB.prepare(
        "UPDATE pending_password_registration SET status=? WHERE id=?",
      )
        .bind(
          user.emailVerified &&
            user.email === row.email &&
            user.emailTenantId === row.tenant_id &&
            user.role === "user" &&
            !user.banned &&
            row.status === "sent"
            ? "verified_pending"
            : "expired",
          row.id,
        )
        .run();
    if (!user || ["completed", "existing"].includes(row.status))
      await env.AUTH_DB.prepare(
        "DELETE FROM pending_password_registration WHERE id=?",
      )
        .bind(row.id)
        .run();
  }
}
export async function emailRegistrationResponse(
  request: Request,
  env: AuthWorkerEnvironment,
  deps: AccountEmailDependencies,
  auth: Auth,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== "/_internal/email-registration/start")
    return null;
  if (!authNoticeBridgeAuthorized(env.SAVIA_INTERNAL_BRIDGE_KEY, request))
    return response(403);
  if (request.method !== "POST") return response(405);
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (
    !body ||
    Object.keys(body).some(
      (k) =>
        ![
          "attemptId",
          "tenantId",
          "name",
          "email",
          "password",
          "revision",
          "origin",
        ].includes(k),
    ) ||
    typeof body.attemptId !== "string" ||
    !/^[a-f0-9-]{36}$/i.test(body.attemptId) ||
    !Number.isSafeInteger(body.tenantId) ||
    Number(body.tenantId) <= 0 ||
    typeof body.name !== "string" ||
    !body.name.trim() ||
    body.name.length > 100 ||
    typeof body.email !== "string" ||
    body.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) ||
    typeof body.password !== "string" ||
    body.password.length < 12 ||
    body.password.length > 128 ||
    typeof body.revision !== "string" ||
    typeof body.origin !== "string"
  )
    return response(400);
  const input = {
    attemptId: body.attemptId,
    tenantId: body.tenantId as number,
    name: body.name.trim(),
    email: body.email.trim().toLowerCase(),
    password: body.password,
    revision: body.revision,
    origin: body.origin,
  };
  const canonical = normalizeCanonicalHost(
    new URL(env.SAVIA_API_RESOURCE ?? env.BETTER_AUTH_URL).hostname,
  );
  // API supplies the authoritative hostname; this second guard rejects arbitrary callback origins.
  if (!isAllowedPublicOrigin(input.origin, canonical)) return response(400);
  const context = await auth.$context;
  let owned: Pending | undefined;
  try {
    await policy(env, context.adapter, input.tenantId, input.revision);
    if (!(await accountEmailAvailable(env, deps, input.tenantId)))
      return response(503);
    await cleanupPasswordRegistrations(env);
    const digest = await fingerprint(env.BETTER_AUTH_SECRET, input);
    let pending = await env.AUTH_DB.prepare(
      "SELECT * FROM pending_password_registration WHERE id=?",
    )
      .bind(input.attemptId)
      .first<Pending>();
    if (pending && pending.fingerprint !== digest) return response(409);
    if (
      pending &&
      ["sent", "verified_pending", "existing", "completed"].includes(
        pending.status,
      )
    )
      return response();
    if (pending?.status === "creating") return response(503);
    if (pending && pending.expires_at <= Date.now()) return response(403);
    const userId = `email-${input.attemptId}`;
    if (!pending) {
      pending = await env.AUTH_DB.prepare(
        "INSERT INTO pending_password_registration(id,user_id,tenant_id,email,name,revision,fingerprint,status,expires_at) VALUES(?,?,?,?,?,?,?,'creating',?) ON CONFLICT(id) DO NOTHING RETURNING *",
      )
        .bind(
          input.attemptId,
          userId,
          input.tenantId,
          input.email,
          input.name,
          input.revision,
          digest,
          Date.now() + 24 * 60 * 60 * 1000,
        )
        .first<Pending>();
      if (!pending) return response(503);
    } else {
      const claimed = await env.AUTH_DB.prepare(
        "UPDATE pending_password_registration SET status='creating' WHERE id=? AND status='failed' RETURNING *",
      )
        .bind(pending.id)
        .first<Pending>();
      if (!claimed) return response(503);
      pending = claimed;
    }
    owned = pending;
    const existing = await context.internalAdapter.findUserByEmail(input.email);
    if (existing) {
      if (existing.user.id === pending.user_id) return response(503);
      await env.AUTH_DB.prepare(
        "UPDATE pending_password_registration SET status='existing' WHERE id=?",
      )
        .bind(input.attemptId)
        .run();
      return response();
    }
    await limitVerificationMail(env, {
      tenantId: input.tenantId,
      email: input.email,
    });
    await context.adapter.create<Record<string, unknown>, LocalUser>({
      model: "user",
      forceAllowId: true,
      data: {
        id: userId,
        email: input.email,
        name: input.name,
        emailVerified: false,
        role: "user",
        banned: false,
        emailTenantId: input.tenantId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await context.adapter.create({
      model: "account",
      data: {
        accountId: userId,
        userId,
        providerId: "credential",
        password: await context.password.hash(input.password),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await auth.api.sendVerificationEmail({
      body: {
        email: input.email,
        callbackURL: new URL("/api/auth/email-verified", input.origin).href,
      },
    });
    await env.AUTH_DB.prepare(
      "UPDATE pending_password_registration SET status='sent' WHERE id=? AND status='creating'",
    )
      .bind(input.attemptId)
      .run();
    return response();
  } catch {
    if (owned) {
      await removeOwnedUnverified(env, owned);
      await env.AUTH_DB.prepare(
        "UPDATE pending_password_registration SET status='failed' WHERE id=? AND status='creating'",
      )
        .bind(owned.id)
        .run();
    }
    return response(503);
  }
}
export function emailRegistrationHooks(
  environment: AuthWorkerEnvironment,
): NonNullable<BetterAuthOptions["databaseHooks"]> {
  return {
    session: {
      create: {
        before: async (session, ctx) => {
          await environment.AUTH_DB.exec(schema);
          const pending = await environment.AUTH_DB.prepare(
            "SELECT * FROM pending_password_registration WHERE user_id=? AND status NOT IN ('completed','existing')",
          )
            .bind(session.userId)
            .first<Pending>();
          if (!pending) return;
          if (!ctx || !["sent", "verified_pending"].includes(pending.status))
            throw new APIError("FORBIDDEN", {
              message: "Complete registration before signing in",
            });
          const user = await ctx.context.adapter.findOne<LocalUser>({
            model: "user",
            where: [{ field: "id", value: session.userId }],
          });
          if (
            !user ||
            !user.emailVerified ||
            user.email !== pending.email ||
            user.emailTenantId !== pending.tenant_id ||
            user.role !== "user" ||
            user.banned
          )
            throw new APIError("FORBIDDEN", {
              message: "Registration identity changed",
            });
          await policy(
            environment,
            ctx.context.adapter,
            pending.tenant_id,
            pending.revision,
          );
          if (
            !environment.SAVIA_IDENTITY ||
            !environment.SAVIA_INTERNAL_BRIDGE_KEY
          )
            throw new APIError("SERVICE_UNAVAILABLE", {
              message: "Registration service unavailable",
            });
          let result: Response;
          try {
            result = await environment.SAVIA_IDENTITY.fetch(
              new Request(
                "https://savia-api.internal/_internal/email-registration",
                {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    "x-savia-bridge-key": environment.SAVIA_INTERNAL_BRIDGE_KEY,
                  },
                  body: JSON.stringify({
                    attemptId: pending.id,
                    tenantId: pending.tenant_id,
                    subject: pending.user_id,
                    email: pending.email,
                    displayName: user.name,
                    revision: pending.revision,
                  }),
                },
              ),
            );
          } catch {
            throw new APIError("SERVICE_UNAVAILABLE", {
              message: "Registration service unavailable",
            });
          }
          if (!result.ok)
            throw new APIError("FORBIDDEN", {
              message:
                "Registration cannot be completed. Contact your administrator.",
            });
          await environment.AUTH_DB.prepare(
            "UPDATE pending_password_registration SET status='completed' WHERE id=? AND status IN ('sent','verified_pending')",
          )
            .bind(pending.id)
            .run();
        },
      },
    },
  };
}
