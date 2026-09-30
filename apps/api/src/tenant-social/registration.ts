import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { AuthService } from "../auth/better-auth";

type RegistrationInput = {
  attemptId: string;
  tenantId: number;
  subject: string;
  email: string;
  displayName: string;
  provider: "google" | "microsoft";
  revision: string;
};

type RegistrationResult = {
  principalId: string;
  membershipId: string;
  created: boolean;
};

type LedgerRow = RegistrationInput & {
  principal_id: string;
  membership_id: string;
};

const registrationInput = z
  .object({
    attemptId: z.string().trim().min(1).max(200),
    tenantId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    subject: z.string().trim().min(1).max(512),
    email: z.string().trim().email().max(254),
    displayName: z.string().trim().min(1).max(200),
    provider: z.enum(["google", "microsoft"]),
    revision: z.string().trim().min(1).max(200),
  })
  .strict();

type SocialBridge = Pick<AuthService, "fetch">;

function sameAttempt(row: LedgerRow, input: RegistrationInput): boolean {
  return (
    row.attemptId === input.attemptId &&
    row.tenantId === input.tenantId &&
    row.subject === input.subject &&
    row.email === input.email &&
    row.provider === input.provider &&
    row.revision === input.revision
  );
}

async function ledgerByAttempt(
  db: D1Database,
  attemptId: string,
): Promise<LedgerRow | null> {
  return db
    .prepare(
      "SELECT attempt_id AS attemptId,tenant_id AS tenantId,auth_subject AS subject,email,provider,revision,principal_id,membership_id FROM social_registration_ledger WHERE attempt_id=?",
    )
    .bind(attemptId)
    .first<LedgerRow>();
}

async function finalizedRowsAreActive(
  db: D1Database,
  row: LedgerRow,
  input: RegistrationInput,
): Promise<boolean> {
  const result = await db
    .prepare(
      "SELECT 1 AS valid FROM tenants t JOIN identity_principal p ON p.id=? AND p.issuer='savia:better-auth' AND p.subject=? AND p.email=? AND p.is_active=1 JOIN identity_tenant_membership m ON m.id=? AND m.principal_id=p.id AND m.tenant_id=t.id AND m.role='viewer' AND m.is_active=1 WHERE t.id=? AND t.is_active=1 AND t.id=?",
    )
    .bind(
      row.principal_id,
      input.subject,
      input.email,
      row.membership_id,
      row.tenantId,
      input.tenantId,
    )
    .first<{ valid: number }>();
  return !!result;
}

async function recordAudit(
  db: D1Database,
  tenantId: number,
  attemptId: string,
  event: "finalized" | "rejected" | "compensated",
  reason: string | null = null,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO social_registration_audit(id,tenant_id,attempt_id,event,reason,created_at) VALUES(?,?,?,?,?,?)",
    )
    .bind(
      crypto.randomUUID(),
      tenantId,
      attemptId,
      event,
      reason,
      new Date().toISOString(),
    )
    .run();
}

async function registrationPolicy(
  bridge: SocialBridge | undefined,
  key: string | undefined,
  input: RegistrationInput,
): Promise<{ allowed: boolean; reason?: string }> {
  if (!bridge || !key?.trim())
    return { allowed: false, reason: "policy_unavailable" };
  let response: Response;
  try {
    response = await bridge.fetch(
      new Request(
        `https://savia-auth.internal/_internal/tenant-social/${input.tenantId}`,
        { headers: { "x-savia-bridge-key": key } },
      ),
    );
  } catch {
    return { allowed: false, reason: "policy_unavailable" };
  }
  if (!response.ok) return { allowed: false, reason: "policy_unavailable" };
  const settings = (await response.json().catch(() => null)) as {
    active?: unknown;
    allowRegistration?: unknown;
    googleEnabled?: unknown;
    microsoftEnabled?: unknown;
    revision?: unknown;
  } | null;
  if (
    settings?.active !== true ||
    settings.allowRegistration !== true ||
    settings.revision !== input.revision ||
    (input.provider === "google" && settings.googleEnabled !== true) ||
    (input.provider === "microsoft" && settings.microsoftEnabled !== true)
  )
    return { allowed: false, reason: "policy_rejected" };
  return { allowed: true };
}

function conflictMessage(error: unknown): "capacity" | "identity" | null {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("TENANT_ACTIVE_USER_LIMIT_REACHED")) return "capacity";
  if (
    message.includes("IDENTITY_EMAIL_CONFLICT") ||
    message.includes("UNIQUE constraint failed") ||
    message.includes("duplicate key value")
  )
    return "identity";
  return null;
}

export async function finalizeSocialRegistration(
  db: D1Database,
  input: RegistrationInput,
): Promise<RegistrationResult> {
  const previous = await ledgerByAttempt(db, input.attemptId);
  if (previous) {
    if (!sameAttempt(previous, input))
      throw new Error("SOCIAL_REGISTRATION_CONFLICT");
    if (!(await finalizedRowsAreActive(db, previous, input)))
      throw new Error("SOCIAL_REGISTRATION_STALE");
    return {
      principalId: previous.principal_id,
      membershipId: previous.membership_id,
      created: false,
    };
  }

  const tenant = await db
    .prepare("SELECT id FROM tenants WHERE id=? AND is_active=1")
    .bind(input.tenantId)
    .first<{ id: number }>();
  if (!tenant) throw new Error("SOCIAL_REGISTRATION_TENANT_INACTIVE");

  const existingSubject = await db
    .prepare(
      "SELECT id FROM identity_principal WHERE issuer='savia:better-auth' AND subject=?",
    )
    .bind(input.subject)
    .first<{ id: string }>();
  const existingEmail = await db
    .prepare(
      "SELECT id FROM identity_principal WHERE lower(trim(email))=lower(trim(?))",
    )
    .bind(input.email)
    .first<{ id: string }>();
  if (existingSubject || existingEmail)
    throw new Error("SOCIAL_REGISTRATION_IDENTITY_CONFLICT");

  const principalId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        "INSERT INTO identity_principal(id,issuer,subject,email,display_name,is_active,created_at,updated_at) VALUES(?,'savia:better-auth',?,?,?,?,?,?)",
      )
      .bind(
        principalId,
        input.subject,
        input.email,
        input.displayName,
        1,
        now,
        now,
      ),
    db
      .prepare(
        "INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at) VALUES(?,?,?,'viewer',1,?,?)",
      )
      .bind(membershipId, principalId, input.tenantId, now, now),
    db
      .prepare(
        "INSERT INTO social_registration_ledger(attempt_id,auth_subject,tenant_id,email,provider,revision,principal_id,membership_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        input.attemptId,
        input.subject,
        input.tenantId,
        input.email,
        input.provider,
        input.revision,
        principalId,
        membershipId,
        now,
      ),
    db
      .prepare(
        "INSERT INTO social_registration_audit(id,tenant_id,attempt_id,event,reason,created_at) VALUES(?,?,?,'finalized',NULL,?)",
      )
      .bind(crypto.randomUUID(), input.tenantId, input.attemptId, now),
  ]);
  return { principalId, membershipId, created: true };
}

export function registerSocialRegistrationRoutes(
  app: OpenAPIHono,
  db: D1Database,
  authService?: SocialBridge,
  bridgeKey?: string,
): void {
  app.post("/_internal/social-registration", async (c) => {
    if (!bridgeKey?.trim())
      return c.json({ error: "Social registration service unavailable." }, 503);
    if (c.req.header("x-savia-bridge-key") !== bridgeKey)
      return c.json({ error: "Forbidden" }, 401);
    const parsed = registrationInput.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success)
      return c.json({ error: "Invalid social registration." }, 400);
    const input = parsed.data;
    if (!authService)
      return c.json({ error: "Social registration policy unavailable." }, 503);

    const policy = await registrationPolicy(authService, bridgeKey, input);
    if (!policy.allowed) {
      if (policy.reason === "policy_rejected")
        await recordAudit(
          db,
          input.tenantId,
          input.attemptId,
          "rejected",
          policy.reason,
        ).catch(() => undefined);
      return c.json(
        {
          error: "Social registration is not allowed by current tenant policy.",
        },
        policy.reason === "policy_unavailable" ? 503 : 409,
      );
    }
    try {
      return c.json(await finalizeSocialRegistration(db, input), 200);
    } catch (error) {
      const replay = await ledgerByAttempt(db, input.attemptId).catch(
        () => null,
      );
      if (replay && sameAttempt(replay, input)) {
        if (await finalizedRowsAreActive(db, replay, input))
          return c.json(
            {
              principalId: replay.principal_id,
              membershipId: replay.membership_id,
              created: false,
            },
            200,
          );
        return c.json(
          { error: "Social registration result is no longer active." },
          409,
        );
      }
      const reason = conflictMessage(error);
      if (reason === "capacity" || reason === "identity")
        await recordAudit(
          db,
          input.tenantId,
          input.attemptId,
          "rejected",
          reason,
        );
      if (
        error instanceof Error &&
        error.message === "SOCIAL_REGISTRATION_CONFLICT"
      )
        return c.json(
          {
            error:
              "Social registration attempt conflicts with an existing result.",
          },
          409,
        );
      if (
        error instanceof Error &&
        (error.message === "SOCIAL_REGISTRATION_TENANT_INACTIVE" ||
          error.message === "SOCIAL_REGISTRATION_STALE")
      )
        return c.json(
          {
            error:
              error.message === "SOCIAL_REGISTRATION_STALE"
                ? "Social registration result is no longer active."
                : "Tenant is inactive.",
          },
          409,
        );
      if (reason === "capacity")
        return c.json({ error: "Tenant user capacity has been reached." }, 409);
      if (
        reason === "identity" ||
        (error instanceof Error &&
          error.message === "SOCIAL_REGISTRATION_IDENTITY_CONFLICT")
      )
        return c.json(
          { error: "Social identity conflicts with an existing account." },
          409,
        );
      return c.json(
        { error: "Social registration could not be finalized." },
        500,
      );
    }
  });

  app.delete("/_internal/social-registration/:attemptId", async (c) => {
    if (!bridgeKey?.trim())
      return c.json({ error: "Social registration service unavailable." }, 503);
    if (c.req.header("x-savia-bridge-key") !== bridgeKey)
      return c.json({ error: "Forbidden" }, 401);
    const attemptId = c.req.param("attemptId");
    const row = await ledgerByAttempt(db, attemptId);
    if (!row) return c.json({ ok: true, removed: true }, 200);
    const now = new Date().toISOString();
    await db.batch([
      db
        .prepare(
          "DELETE FROM identity_tenant_membership WHERE id=? AND principal_id=? AND tenant_id=? AND role='viewer' AND is_active=1 AND NOT EXISTS(SELECT 1 FROM identity_global_role g WHERE g.principal_id=?) AND NOT EXISTS(SELECT 1 FROM access_assignments a WHERE a.principal_id=? AND a.scope=? AND a.role_id<>?)",
        )
        .bind(
          row.membership_id,
          row.principal_id,
          row.tenantId,
          row.principal_id,
          row.principal_id,
          `tenant:${row.tenantId}`,
          `builtin:tenant:${row.tenantId}:viewer`,
        ),
      db
        .prepare(
          "DELETE FROM identity_principal WHERE id=? AND issuer='savia:better-auth' AND subject=? AND email=? AND is_active=1 AND NOT EXISTS(SELECT 1 FROM identity_tenant_membership m WHERE m.principal_id=identity_principal.id) AND NOT EXISTS(SELECT 1 FROM identity_global_role g WHERE g.principal_id=identity_principal.id) AND NOT EXISTS(SELECT 1 FROM access_assignments a WHERE a.principal_id=identity_principal.id AND a.role_id NOT LIKE 'builtin:%')",
        )
        .bind(row.principal_id, row.subject, row.email),
      db
        .prepare(
          "DELETE FROM social_registration_ledger WHERE attempt_id=? AND (NOT EXISTS(SELECT 1 FROM identity_principal p WHERE p.id=?) OR (EXISTS(SELECT 1 FROM identity_principal p WHERE p.id=? AND p.issuer='savia:better-auth' AND p.subject=? AND p.email=? AND p.is_active=1) AND NOT EXISTS(SELECT 1 FROM identity_tenant_membership m WHERE m.principal_id=?) AND NOT EXISTS(SELECT 1 FROM identity_global_role g WHERE g.principal_id=? ) AND NOT EXISTS(SELECT 1 FROM access_assignments a WHERE a.principal_id=? AND a.role_id NOT LIKE 'builtin:%')))",
        )
        .bind(
          attemptId,
          row.principal_id,
          row.principal_id,
          row.subject,
          row.email,
          row.principal_id,
          row.principal_id,
          row.principal_id,
        ),
      db
        .prepare(
          "INSERT INTO social_registration_audit(id,tenant_id,attempt_id,event,reason,created_at) SELECT ?,?,?,'compensated',NULL,? WHERE NOT EXISTS(SELECT 1 FROM social_registration_ledger WHERE attempt_id=?)",
        )
        .bind(crypto.randomUUID(), row.tenantId, attemptId, now, attemptId),
    ]);
    const remains = await ledgerByAttempt(db, attemptId);
    return c.json({ ok: true, removed: !remains }, 200);
  });
}
