import {
  adminNoticeSchema,
  type NoticeEventInput,
  type NotificationPolicy,
} from "@savia/crm-shared/notifications";
import { canonicalPayload } from "./types";
import { fail } from "../context";
import { NotificationRepository } from "./repository";

export interface AdminSendResult {
  eventId: string;
  status: "accepted";
  duplicate: boolean;
}

export interface AdminEventStatus {
  eventId: string;
  status: "accepted" | "processing" | "completed" | "failed";
  delivered: number;
  failed: number;
  pendingRetries: number;
  failures: { recipient: string; error: string }[];
}

const WINDOW_MS = 60_000;
const WINDOW_LIMIT = 10;

export async function sendAdminNotice(
  db: D1Database,
  policy: NotificationPolicy,
  principal: string,
  scope: { kind: "workspace"; id: string },
  key: string,
  rawPayload: unknown,
  now: number = Date.now(),
): Promise<AdminSendResult> {
  const payload = adminNoticeSchema.parse(rawPayload);
  if (!(await policy.canSend(principal, scope)))
    return fail("Administrator permission required.", 403);
  if (!key || key.length > 200) return fail("Invalid message key.", 400);
  const event: NoticeEventInput = {
    scope,
    key: `admin:${principal}:${key}`,
    actor: { kind: "user", id: principal },
    source: { kind: "admin-message", id: key },
    title: payload.title,
    body: payload.body,
    audience: payload.audience,
    createdAt: now,
    expiresAt: null,
  };
  const repository = new NotificationRepository(db);
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  const existing = await repository.find(event);
  if (existing) {
    if (existing.payload === canonicalPayload(event))
      return { eventId: existing.id, status: "accepted", duplicate: true };
    return fail("The message key already exists with different content.", 409);
  }
  const spent = await db
    .prepare(
      `SELECT count FROM notification_send_limits WHERE workspace_id=? AND actor_id=? AND window_start=?`,
    )
    .bind(scope.id, principal, windowStart)
    .first<number>("count");
  if ((spent ?? 0) >= WINDOW_LIMIT)
    return fail("Administrator send quota exceeded. Retry in a minute.", 429);
  const accepted = await repository.accept(event);
  await db.batch([
    db
      .prepare(
        `INSERT INTO notification_send_limits(workspace_id,actor_id,window_start,count)
         VALUES (?,?,?,1)
         ON CONFLICT(workspace_id,actor_id,window_start) DO UPDATE SET count=count+1`,
      )
      .bind(scope.id, principal, windowStart),
    db
      .prepare(
        `INSERT INTO notification_admin_audit(id,workspace_id,actor_id,event_id,action,created_at)
         VALUES (?,?,?,?,?,?)`,
      )
      .bind(
        `audit_${accepted.id}`,
        scope.id,
        principal,
        accepted.id,
        "send",
        now,
      ),
  ]);
  return { eventId: accepted.id, status: "accepted", duplicate: false };
}

export async function adminEventStatus(
  db: D1Database,
  principal: string,
  eventId: string,
): Promise<AdminEventStatus> {
  const event = await db
    .prepare("SELECT id,status FROM notification_events WHERE id=?")
    .bind(eventId)
    .first<{ id: string; status: string }>();
  if (!event) return fail("Notification event not found.", 404);
  const delivered =
    (await db
      .prepare("SELECT COUNT(*) AS n FROM notification_deliveries WHERE event_id=?")
      .bind(eventId)
      .first<number>("n")) ?? 0;
  const retries = (
    await db
      .prepare(
        "SELECT recipient_id,error,status FROM notification_recipient_retries WHERE event_id=?",
      )
      .bind(eventId)
      .all<{ recipient_id: string; error: string; status: string }>()
  ).results;
  return {
    eventId,
    status:
      event.status === "completed"
        ? "completed"
        : event.status === "failed"
          ? "failed"
          : event.status === "processing"
            ? "processing"
            : "accepted",
    delivered,
    failed: retries.filter((row) => row.status === "failed").length,
    pendingRetries: retries.filter((row) => row.status === "pending").length,
    failures: retries
      .filter((row) => row.status === "failed")
      .map((row) => ({ recipient: row.recipient_id, error: row.error })),
  };
}

export async function retryAdminEvent(
  db: D1Database,
  principal: string,
  eventId: string,
  now: number = Date.now(),
): Promise<{ retried: number }> {
  const event = await db
    .prepare("SELECT id FROM notification_events WHERE id=?")
    .bind(eventId)
    .first<{ id: string }>();
  if (!event) return fail("Notification event not found.", 404);
  const result = await db
    .prepare(
      `UPDATE notification_recipient_retries SET status='pending',next_retry=?
       WHERE event_id=? AND status='failed'`,
    )
    .bind(now, eventId)
    .run();
  await db
    .prepare(
      `UPDATE notification_events SET status='pending',next_retry=? WHERE id=? AND status='failed'`,
    )
    .bind(now, eventId)
    .run();
  await db
    .prepare(
      `INSERT INTO notification_admin_audit(id,workspace_id,actor_id,event_id,action,created_at)
       VALUES (?,?,?,?,?,?)`,
    )
    .bind(`audit_retry_${eventId}_${now}`, "", principal, eventId, "retry", now)
    .run();
  return { retried: result.meta.changes ?? 0 };
}
