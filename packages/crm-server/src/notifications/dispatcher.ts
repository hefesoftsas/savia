import {
  notificationDefaults,
  type DispatchOptions,
  type DispatchReport,
  type NoticeEventInput,
  type NotificationPolicy,
} from "@savia/crm-shared/notifications";
import { guard } from "../services";
import { resolveAudienceRecipients } from "./audience";

const RETRY_DELAYS_MINUTES = [1, 5, 15, 60, 240];
const MAX_RETRIES = 5;

interface EventRow {
  id: string;
  scope_kind: string;
  scope_id: string;
  payload: string;
  cursor: string | null;
  attempts: number;
  lease_token: string | null;
  lease_until: number;
}

type ResolvedDispatchOptions = Required<
  Omit<DispatchOptions, "now" | "random">
> & {
  now: () => number;
  random: () => number;
};

interface RetryRow {
  recipient_id: string;
  attempts: number;
  next_retry: number;
  status: string;
}

function backoffMs(attempts: number, random: () => number): number {
  const minutes =
    RETRY_DELAYS_MINUTES[Math.min(attempts, RETRY_DELAYS_MINUTES.length - 1)];
  return minutes * 60_000 + Math.floor(random() * 60_000);
}

export async function processNotifications(
  db: D1Database,
  policy: NotificationPolicy,
  rawOptions: DispatchOptions,
): Promise<DispatchReport> {
  const now = rawOptions.now ?? Date.now;
  const random = rawOptions.random ?? Math.random;
  const options: ResolvedDispatchOptions = {
    maxEvents: notificationDefaults.maxEvents,
    maxRecipients: notificationDefaults.maxRecipients,
    maxRecipientAttempts: notificationDefaults.maxRecipientAttempts,
    softBudgetMs: notificationDefaults.softBudgetMs,
    leaseMs: notificationDefaults.leaseMs,
    ...rawOptions,
    now,
    random,
  };
  const report: DispatchReport = {
    claimed: 0,
    delivered: 0,
    skipped: 0,
    failed: 0,
    retried: 0,
    recoveredLeases: 0,
  };
  const startedAt = now();
  let recipientAttempts = 0;
  const seen = new Set<string>();
  for (;;) {
    if (
      report.claimed >= options.maxEvents ||
      recipientAttempts >= options.maxRecipientAttempts ||
      now() - startedAt >= options.softBudgetMs
    ) {
      return report;
    }
    const exclusion = seen.size
      ? ` AND id NOT IN (${[...seen].map(() => "?").join(",")})`
      : "";
    const due = (
      await db
        .prepare(
          `SELECT id,scope_kind,scope_id,payload,cursor,attempts,lease_token,lease_until,status
           FROM notification_events
           WHERE status IN ('pending','processing') AND next_retry<=? AND lease_until<=?${exclusion}
           ORDER BY next_retry,created_at,id LIMIT 1`,
        )
        .bind(now(), now(), ...seen)
        .all<EventRow & { status: string }>()
    ).results[0];
    if (!due) return report;
    if (
      due.status === "processing" ||
      (due.lease_until > 0 && due.lease_until < now())
    )
      report.recoveredLeases += 1;
    const token = `${options.workerId}:${Math.floor(random() * Number.MAX_SAFE_INTEGER).toString(36)}`;
    const claimed = await db
      .prepare(
        `UPDATE notification_events
         SET status='processing',lease_token=?,lease_until=?,attempts=attempts+1
         WHERE id=? AND status IN ('pending','processing') AND next_retry<=? AND lease_until<=?`,
      )
      .bind(token, now() + options.leaseMs, due.id, now(), now())
      .run();
    if ((claimed.meta.changes ?? 0) === 0) continue;
    report.claimed += 1;
    const used = await processEvent(
      db,
      policy,
      options,
      now,
      random,
      due,
      token,
      report,
    );
    recipientAttempts += used;
    seen.add(due.id);
  }
}

async function processEvent(
  db: D1Database,
  policy: NotificationPolicy,
  options: ResolvedDispatchOptions,
  now: () => number,
  random: () => number,
  due: EventRow,
  token: string,
  report: DispatchReport,
): Promise<number> {
  const local: DispatchReport = {
    claimed: 0,
    delivered: 0,
    skipped: 0,
    failed: 0,
    retried: 0,
    recoveredLeases: 0,
  };
  let event: NoticeEventInput;
  try {
    event = JSON.parse(due.payload);
  } catch {
    await db
      .prepare(
        "UPDATE notification_events SET status='failed',error=? WHERE id=?",
      )
      .bind("Unparseable event payload", due.id)
      .run();
    report.failed += 1;
    return 0;
  }
  if (event.expiresAt !== null && event.expiresAt <= now()) {
    await db
      .prepare(
        "UPDATE notification_events SET status='failed',error=? WHERE id=?",
      )
      .bind("Event expired before delivery", due.id)
      .run();
    report.failed += 1;
    return 0;
  }
  const delivered = new Set(
    (
      await db
        .prepare(
          "SELECT recipient_id FROM notification_deliveries WHERE event_id=?",
        )
        .bind(due.id)
        .all<{ recipient_id: string }>()
    ).results.map((row) => row.recipient_id),
  );
  const retries = new Map(
    (
      await db
        .prepare(
          "SELECT recipient_id,attempts,next_retry,status FROM notification_recipient_retries WHERE event_id=?",
        )
        .bind(due.id)
        .all<RetryRow>()
    ).results.map((row) => [row.recipient_id, row] as const),
  );
  const scope = {
    kind: due.scope_kind,
    id: due.scope_id,
  } as NoticeEventInput["scope"];
  const statements: D1PreparedStatement[] = [];
  const newWaits: number[] = [];
  let usedAttempts = 0;
  let after: string | null = due.cursor;
  let exhausted = false;
  let nextRetry: number | null = null;
  for (;;) {
    if (usedAttempts >= options.maxRecipients) break;
    const page = await resolveAudienceRecipients(db, policy, event, after, 100);
    if (page.ids.length === 0) {
      exhausted = page.nextCursor === null;
      after = page.nextCursor;
      if (exhausted) break;
      continue;
    }
    for (const recipient of page.ids) {
      if (usedAttempts >= options.maxRecipients) break;
      usedAttempts += 1;
      if (delivered.has(recipient)) continue;
      if (event.actor.kind === "user" && event.actor.id === recipient) {
        local.skipped += 1;
        continue;
      }
      let readable = false;
      try {
        readable =
          (await policy.canReadScope(recipient, scope)) &&
          (await policy.canReadSource(recipient, scope, event.source));
      } catch (error) {
        const wait = recordRetry(
          statements,
          db,
          due.id,
          recipient,
          retries.get(recipient),
          now,
          random,
          error,
          local,
        );
        if (wait !== null) newWaits.push(wait);
        continue;
      }
      if (!readable) {
        local.skipped += 1;
        continue;
      }
      const retry = retries.get(recipient);
      if (retry && retry.status === "pending" && retry.next_retry > now()) {
        const wait = retry.next_retry;
        nextRetry = nextRetry === null ? wait : Math.min(nextRetry, wait);
        continue;
      }
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO notification_deliveries(id,event_id,scope_kind,scope_id,recipient_id,created_at)
             VALUES (?,?,?,?,?,?)`,
          )
          .bind(
            `dlv_${due.id}_${recipient}`,
            due.id,
            scope.kind,
            scope.id,
            recipient,
            now(),
          ),
      );
      delivered.add(recipient);
      local.delivered += 1;
    }
    after = page.nextCursor;
    if (after === null) {
      exhausted = true;
      break;
    }
  }
  const pendingWaits: number[] = [...newWaits];
  for (const retry of retries.values()) {
    if (retry.status === "pending" && retry.next_retry > now())
      pendingWaits.push(retry.next_retry);
  }
  if (nextRetry !== null) pendingWaits.push(nextRetry);
  const done = exhausted && pendingWaits.length === 0;
  statements.push(
    db
      .prepare(
        `UPDATE notification_events SET status=?,cursor=?,next_retry=?,error=NULL,lease_token=NULL,lease_until=0 WHERE id=?`,
      )
      .bind(
        done ? "completed" : "pending",
        after,
        done ? 0 : pendingWaits.length ? Math.min(...pendingWaits) : now(),
        due.id,
      ),
  );
  const lease = guard(
    db,
    "SELECT 1 FROM notification_events WHERE id=? AND lease_token=? AND lease_until>?",
    [due.id, token, now()],
  );
  try {
    await db.batch([lease.start, ...statements, lease.end]);
  } catch (error) {
    if (String(error).includes("crm_write_guards")) return usedAttempts;
    throw error;
  }
  report.delivered += local.delivered;
  report.skipped += local.skipped;
  report.failed += local.failed;
  report.retried += local.retried;
  return usedAttempts;
}

function recordRetry(
  statements: D1PreparedStatement[],
  db: D1Database,
  eventId: string,
  recipient: string,
  retry: RetryRow | undefined,
  now: () => number,
  random: () => number,
  error: unknown,
  report: DispatchReport,
): number | null {
  const attempts = (retry?.attempts ?? 0) + 1;
  const message = error instanceof Error ? error.message : String(error);
  if (attempts >= MAX_RETRIES) {
    statements.push(
      db
        .prepare(
          `INSERT INTO notification_recipient_retries(event_id,recipient_id,attempts,next_retry,error,status)
           VALUES (?,?,?,?,?,'failed')
           ON CONFLICT(event_id,recipient_id) DO UPDATE SET attempts=?,next_retry=?,error=?,status='failed'`,
        )
        .bind(
          eventId,
          recipient,
          attempts,
          now(),
          message.slice(0, 500),
          attempts,
          now(),
          message.slice(0, 500),
        ),
    );
    report.failed += 1;
    return null;
  }
  const wait = backoffMs(attempts - 1, random);
  statements.push(
    db
      .prepare(
        `INSERT INTO notification_recipient_retries(event_id,recipient_id,attempts,next_retry,error,status)
         VALUES (?,?,?,?,?,'pending')
         ON CONFLICT(event_id,recipient_id) DO UPDATE SET attempts=?,next_retry=?,error=?,status='pending'`,
      )
      .bind(
        eventId,
        recipient,
        attempts,
        now() + wait,
        message.slice(0, 500),
        attempts,
        now() + wait,
        message.slice(0, 500),
      ),
  );
  report.retried += 1;
  return now() + wait;
}
