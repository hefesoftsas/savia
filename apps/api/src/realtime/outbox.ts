import type { RealtimeEventInput } from "./protocol";
import type { RealtimeHubClient } from "./hub-client";
import { principalRoom } from "./protocol";

type OutboxRow = {
  event_id: number;
  principal_id: string;
  topic: "assistant-threads" | "request-pages";
  type: "created" | "updated" | "deleted";
  collection: string;
  resource_id: string;
  created_at: string;
  attempts: number;
};

export type RealtimeOutboxFilter = {
  principalId?: string;
  topic?: OutboxRow["topic"];
  resourceId?: string;
  limit?: number;
  inspectBacklog?: boolean;
};

export type RealtimeOutboxDispatchReport = {
  delivered: number;
  failed: number;
  pending?: boolean;
  oldestPendingAgeMs?: number | null;
};

/** Deliver pending D1 outbox rows; failures remain durable for a later retry. */
export async function dispatchRealtimeOutbox(
  db: D1Database,
  hub: RealtimeHubClient | undefined,
  filter: RealtimeOutboxFilter = {},
): Promise<RealtimeOutboxDispatchReport> {
  if (!hub) return { delivered: 0, failed: 0 };
  const limit = Math.max(1, Math.min(filter.limit ?? 100, 1000));
  const clauses = ["published_at IS NULL", "next_attempt_at <= ?"];
  const values: (string | number)[] = [Date.now()];
  if (filter.principalId) {
    clauses.push("principal_id = ?");
    values.push(filter.principalId);
  }
  if (filter.topic) {
    clauses.push("topic = ?");
    values.push(filter.topic);
  }
  if (filter.resourceId) {
    clauses.push("resource_id = ?");
    values.push(filter.resourceId);
  }
  const { results } = await db
    .prepare(
      `SELECT event_id, principal_id, topic, type, collection, resource_id,
              created_at, attempts
       FROM realtime_event_outbox WHERE ${clauses.join(" AND ")}
       ORDER BY event_id LIMIT ?`,
    )
    .bind(...values, limit)
    .all<OutboxRow>();

  let delivered = 0;
  let failed = 0;
  for (const row of results) {
    const event: RealtimeEventInput = {
      eventId: row.event_id,
      topic: row.topic,
      type: row.type,
      collection: row.collection,
      id: row.resource_id,
      actor: row.principal_id,
      at: row.created_at,
    };
    let accepted = false;
    if (hub.publishConfirmed) {
      accepted = await hub.publishConfirmed(
        principalRoom(row.principal_id),
        event,
      );
    } else {
      // Compatibility for test doubles and older injected clients. This path
      // cannot acknowledge delivery, so it never clears the durable row.
      try {
        hub.publish(principalRoom(row.principal_id), event);
      } catch {
        // The scheduled dispatcher will retry this row.
      }
    }
    if (accepted) {
      await db
        .prepare(
          "UPDATE realtime_event_outbox SET published_at=?, attempts=attempts+1 WHERE event_id=? AND published_at IS NULL",
        )
        .bind(new Date().toISOString(), row.event_id)
        .run();
      delivered++;
    } else if (hub.publishConfirmed) {
      const delayMs = Math.min(60_000 * 2 ** row.attempts, 3_600_000);
      await db
        .prepare(
          "UPDATE realtime_event_outbox SET attempts=attempts+1, next_attempt_at=? WHERE event_id=? AND published_at IS NULL",
        )
        .bind(Date.now() + delayMs, row.event_id)
        .run();
      failed++;
    }
  }
  if (!filter.inspectBacklog) return { delivered, failed };
  const oldestPending = await db
    .prepare(
      "SELECT created_at FROM realtime_event_outbox WHERE published_at IS NULL ORDER BY event_id LIMIT 1",
    )
    .first<{ created_at: string }>();
  return {
    delivered,
    failed,
    pending: Boolean(oldestPending),
    oldestPendingAgeMs: oldestPending
      ? Math.max(0, Date.now() - Date.parse(oldestPending.created_at))
      : null,
  };
}

/** Retain a 30-day recovery window and record per-principal cursor watermarks. */
export async function pruneRealtimeOutbox(
  db: D1Database,
  now = Date.now(),
  limit = 1000,
): Promise<number> {
  const cutoff = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const boundedLimit = Math.max(1, Math.min(limit, 5000));
  const candidates = `SELECT principal_id, event_id
    FROM realtime_event_outbox
    WHERE published_at IS NOT NULL AND published_at < ?
    ORDER BY event_id LIMIT ?`;
  const result = await db.batch([
    db
      .prepare(
        `INSERT INTO realtime_event_retention (principal_id, expired_through)
         SELECT principal_id, MAX(event_id)
         FROM (${candidates}) AS expired
         GROUP BY principal_id
         ON CONFLICT(principal_id) DO UPDATE SET expired_through =
           CASE WHEN realtime_event_retention.expired_through > excluded.expired_through
             THEN realtime_event_retention.expired_through ELSE excluded.expired_through END`,
      )
      .bind(cutoff, boundedLimit),
    db
      .prepare(
        `DELETE FROM realtime_event_outbox WHERE event_id IN (
          SELECT event_id FROM realtime_event_outbox
          WHERE published_at IS NOT NULL AND published_at < ?
          ORDER BY event_id LIMIT ?
        )`,
      )
      .bind(cutoff, boundedLimit),
  ]);
  return Number(result[1]?.meta.changes ?? 0);
}
