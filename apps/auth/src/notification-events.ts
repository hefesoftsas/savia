export interface AuthNoticeEvent {
  id: string;
  subject: string;
  kind: "email-verified" | "two-factor-enabled";
  createdAt: number;
  expiresAt: number | null;
  requestId: string | null;
}

async function run(db: D1Database, sql: string): Promise<void> {
  await db.prepare(sql).run();
}

export async function ensureAuthNoticeSchema(db: D1Database): Promise<void> {
  await run(
    db,
    "CREATE TABLE IF NOT EXISTS auth_notice_events(id TEXT PRIMARY KEY, subject TEXT NOT NULL, kind TEXT NOT NULL, created_at BIGINT NOT NULL, expires_at BIGINT, request_id TEXT, acked_at BIGINT NOT NULL DEFAULT 0)",
  );
  await run(
    db,
    "CREATE INDEX IF NOT EXISTS auth_notice_events_pending ON auth_notice_events(acked_at, id)",
  );
  await run(db, "DROP TRIGGER IF EXISTS auth_notice_email_verified");
  await run(
    db,
    `CREATE TRIGGER auth_notice_email_verified AFTER UPDATE ON "user" WHEN OLD.emailVerified=0 AND NEW.emailVerified=1 BEGIN INSERT INTO auth_notice_events(id,subject,kind,created_at,request_id) VALUES ('auth_'||NEW.id||'_email_'||NEW.updatedAt,NEW.id,'email-verified',CAST(strftime('%s','now') AS INTEGER)*1000,NULL); END`,
  );
  await run(db, "DROP TRIGGER IF EXISTS auth_notice_two_factor");
  await run(
    db,
    `CREATE TRIGGER auth_notice_two_factor AFTER UPDATE ON "user" WHEN OLD.twoFactorEnabled=0 AND NEW.twoFactorEnabled=1 BEGIN INSERT INTO auth_notice_events(id,subject,kind,created_at,request_id) VALUES ('auth_'||NEW.id||'_totp_'||NEW.updatedAt,NEW.id,'two-factor-enabled',CAST(strftime('%s','now') AS INTEGER)*1000,NULL); END`,
  );
}

export async function readAuthNoticeEvents(
  db: D1Database,
  after: string | null,
  limit: number,
): Promise<AuthNoticeEvent[]> {
  const bounded = Math.min(Math.max(limit, 1), 100);
  const rows = (
    await db
      .prepare(
        after
          ? `SELECT id,subject,kind,created_at,expires_at,request_id FROM auth_notice_events
             WHERE acked_at=0 AND id>? ORDER BY id LIMIT ?`
          : `SELECT id,subject,kind,created_at,expires_at,request_id FROM auth_notice_events
             WHERE acked_at=0 ORDER BY id LIMIT ?`,
      )
      .bind(...(after ? [after, bounded] : [bounded]))
      .all<{
        id: string;
        subject: string;
        kind: AuthNoticeEvent["kind"];
        created_at: number;
        expires_at: number | null;
        request_id: string | null;
      }>()
  ).results;
  return rows.map((row) => ({
    id: row.id,
    subject: row.subject,
    kind: row.kind,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    requestId: row.request_id,
  }));
}

export async function ackAuthNoticeEvents(db: D1Database, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(",");
  const result = await db
    .prepare(
      `UPDATE auth_notice_events SET acked_at=? WHERE id IN (${placeholders}) AND acked_at=0`,
    )
    .bind(Date.now(), ...ids.slice(0, 100))
    .run();
  return result.meta.changes ?? 0;
}

export function authNoticeBridgeAuthorized(
  bridgeKey: string | undefined,
  request: Request,
): boolean {
  if (!bridgeKey) return false;
  return request.headers.get("x-savia-bridge-key") === bridgeKey;
}
