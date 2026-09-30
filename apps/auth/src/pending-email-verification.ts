import {
  sendAccountEmail,
  type AccountEmailDependencies,
  type AccountEmailEnvironment,
} from "./account-email";

export type VerificationPurpose = "microsoft_link" | "password_registration";
export type PendingVerification = {
  id: string;
  purpose: VerificationPurpose;
  tenantId: number;
  email: string;
  revision: string;
  returnOrigin: string;
  browserNonceHash: string;
  expiresAt: number;
  providerSubject?: string;
  providerTenantId?: string;
};
export type PendingVerificationInput = Omit<
  PendingVerification,
  "id" | "browserNonceHash" | "expiresAt"
> & { browserNonce: string };
type Row = {
  id: string;
  value: string;
  expires_at: number;
  token_hash: string | null;
  token_expires_at: number | null;
  sent_at: number | null;
  sends: number;
  consumed_at: number | null;
};
const TABLE =
  "CREATE TABLE IF NOT EXISTS pending_email_verification (id TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NOT NULL, token_hash TEXT, token_expires_at INTEGER, sent_at INTEGER, sends INTEGER NOT NULL DEFAULT 0, consumed_at INTEGER)";
const invalid = () =>
  new Error(
    "Email verification expired or invalid. Return to the original browser and try again.",
  );
export async function verificationHash(value: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
export function newVerificationNonce() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function createPendingVerification(
  input: PendingVerificationInput,
  env: AccountEmailEnvironment,
): Promise<PendingVerification> {
  if (
    !["microsoft_link", "password_registration"].includes(input.purpose) ||
    !Number.isSafeInteger(input.tenantId) ||
    input.tenantId <= 0 ||
    !input.browserNonce ||
    input.browserNonce.length < 8 ||
    !input.revision ||
    !/^\S+@\S+\.\S+$/.test(input.email) ||
    input.email.length > 254 ||
    /[\r\n<>]/.test(input.email)
  )
    throw invalid();
  const origin = new URL(input.returnOrigin);
  if (
    !["https:", "http:"].includes(origin.protocol) ||
    origin.origin !== input.returnOrigin ||
    origin.username ||
    origin.password
  )
    throw invalid();
  if (
    input.purpose === "microsoft_link" &&
    (!input.providerSubject || !input.providerTenantId)
  )
    throw invalid();
  const { browserNonce, ...fields } = input;
  const value: PendingVerification = {
    ...fields,
    email: input.email.trim().toLowerCase(),
    id: crypto.randomUUID(),
    browserNonceHash: await verificationHash(browserNonce),
    expiresAt: Date.now() + 20 * 60_000,
  };
  await env.AUTH_DB.exec(TABLE);
  await env.AUTH_DB.prepare(
    "INSERT INTO pending_email_verification(id,value,expires_at) VALUES(?,?,?)",
  )
    .bind(value.id, JSON.stringify(value), value.expiresAt)
    .run();
  return value;
}
export async function readPendingVerification(
  id: string,
  env: AccountEmailEnvironment,
  expected: {
    browserNonce: string;
    origin: string;
    purpose?: VerificationPurpose;
    tenantId?: number;
  },
): Promise<PendingVerification> {
  await env.AUTH_DB.exec(TABLE);
  const row = await env.AUTH_DB.prepare(
    "SELECT * FROM pending_email_verification WHERE id=?",
  )
    .bind(id)
    .first<Row>();
  if (!row || row.expires_at <= Date.now()) throw invalid();
  const pending = JSON.parse(row.value) as PendingVerification;
  if (
    pending.id !== id ||
    pending.browserNonceHash !==
      (await verificationHash(expected.browserNonce)) ||
    pending.returnOrigin !== expected.origin ||
    (expected.purpose !== undefined && pending.purpose !== expected.purpose) ||
    (expected.tenantId !== undefined && pending.tenantId !== expected.tenantId)
  )
    throw invalid();
  return pending;
}
export async function sendPendingVerification(
  input: { id: string; browserNonce: string; origin: string },
  env: AccountEmailEnvironment,
  deps: AccountEmailDependencies,
): Promise<void> {
  const pending = await readPendingVerification(input.id, env, input);
  const token = newVerificationNonce(),
    hash = await verificationHash(token),
    now = Date.now();
  const claimed = await env.AUTH_DB.prepare(
    "UPDATE pending_email_verification SET token_hash=?,token_expires_at=?,sent_at=?,sends=sends+1 WHERE id=? AND consumed_at IS NULL AND expires_at>? AND sends<5 AND (sent_at IS NULL OR sent_at<=?) RETURNING id",
  )
    .bind(
      hash,
      Math.min(now + 15 * 60_000, pending.expiresAt),
      now,
      input.id,
      now,
      now - 60_000,
    )
    .first();
  if (!claimed)
    throw new Error(
      "Please wait before requesting another verification email.",
    );
  const path =
    pending.purpose === "microsoft_link"
      ? "/api/auth/microsoft-email-verification/verify"
      : "/api/auth/registration-email-verification/verify";
  const link = new URL(path, pending.returnOrigin);
  link.searchParams.set("id", pending.id);
  link.searchParams.set("token", token);
  try {
    await sendAccountEmail(
      env,
      deps,
      {
        to: pending.email,
        subject: "Verify your email to continue",
        text: `Verify your email to continue:\n\n${link.href}\n\nThis link expires in 15 minutes. Open it in the browser where you started. If you did not request this, ignore this email.`,
      },
      pending.tenantId,
    );
  } catch {
    await env.AUTH_DB.prepare(
      "UPDATE pending_email_verification SET token_hash=NULL,token_expires_at=NULL WHERE id=? AND token_hash=?",
    )
      .bind(pending.id, hash)
      .run();
    throw new Error("Verification email delivery unavailable.");
  }
}
export async function consumePendingVerification(
  input: {
    id: string;
    token: string;
    browserNonce: string;
    origin: string;
    purpose: VerificationPurpose;
    tenantId: number;
  },
  env: AccountEmailEnvironment,
): Promise<PendingVerification> {
  const pending = await readPendingVerification(input.id, env, input);
  if (!input.token || input.token.length > 256) throw invalid();
  const now = Date.now();
  const row = await env.AUTH_DB.prepare(
    "UPDATE pending_email_verification SET consumed_at=?,token_hash=NULL WHERE id=? AND token_hash=? AND consumed_at IS NULL AND expires_at>? AND token_expires_at>? RETURNING id",
  )
    .bind(now, pending.id, await verificationHash(input.token), now, now)
    .first();
  if (!row) throw invalid();
  return pending;
}
export async function cleanupPendingVerifications(
  env: AccountEmailEnvironment,
): Promise<void> {
  await env.AUTH_DB.exec(TABLE);
  await env.AUTH_DB.prepare(
    "DELETE FROM pending_email_verification WHERE id IN (SELECT id FROM pending_email_verification WHERE expires_at<? LIMIT 100)",
  )
    .bind(Date.now())
    .run();
}
