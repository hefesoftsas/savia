import type { SaviaCollectionEvent } from "@savia/studio-shared/savia-flows";

type EventRow = {
  id: string;
  tenant_id: string;
  collection_name: string;
  operation: SaviaCollectionEvent["operation"];
  record_id: string;
  record_version: number;
  occurred_at: string;
  before_snapshot: string | null;
  after_snapshot: string | null;
  changed_fields: string;
  actor_kind: string;
  actor_id: string;
  cause_id: string | null;
};

export type ClaimedCollectionEvent = {
  event: SaviaCollectionEvent;
  lease: string;
};

const MAX_ATTEMPTS = 20;
const MAX_BACKOFF_MS = 5 * 60_000;
const LEASE_MS = 60_000;
const DELIVERED_RETENTION_MS = 30 * 24 * 60 * 60_000;
const CLEANUP_BATCH = 100;

function parseCause(value: string | null): SaviaCollectionEvent["cause"] {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return undefined;
    const cause = parsed as Record<string, unknown>;
    if (
      typeof cause.rootEventId !== "string" ||
      !Array.isArray(cause.workflowIds) ||
      !cause.workflowIds.every((id) => typeof id === "string") ||
      !Number.isInteger(cause.depth) ||
      (cause.depth as number) < 0
    )
      return undefined;
    return {
      rootEventId: cause.rootEventId,
      workflowIds: cause.workflowIds,
      depth: cause.depth as number,
    };
  } catch {
    // Older writers stored execution IDs and other opaque strings here.
    return undefined;
  }
}

function parseSnapshot(value: string | null): Record<string, unknown> | null {
  if (value === null) return null;
  const parsed: unknown = JSON.parse(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

function mapEvent(row: EventRow): SaviaCollectionEvent {
  const cause = parseCause(row.cause_id);
  return {
    id: row.id,
    tenant: row.tenant_id,
    collection: row.collection_name,
    operation: row.operation,
    recordId: row.record_id,
    recordVersion: Number(row.record_version),
    timestamp: row.occurred_at,
    before: parseSnapshot(row.before_snapshot),
    after: parseSnapshot(row.after_snapshot),
    changedFields: JSON.parse(row.changed_fields) as string[],
    actor: { kind: row.actor_kind, id: row.actor_id },
    ...(cause ? { cause } : {}),
  };
}

/** Transactional capture is provided by studio_records triggers; this class only leases delivery work. */
export class CollectionEventOutbox {
  constructor(private readonly db: D1Database) {}

  async claim(limit: number, now: number): Promise<ClaimedCollectionEvent[]> {
    const bounded = Math.max(1, Math.min(100, Math.trunc(limit) || 1));
    await this.db
      .prepare(
        `DELETE FROM savia_flows_collection_event_outbox
         WHERE id IN (
           SELECT id FROM savia_flows_collection_event_outbox
           WHERE status='delivered' AND delivered_at<=?
           ORDER BY delivered_at LIMIT ?
         )`,
      )
      .bind(now - DELIVERED_RETENTION_MS, CLEANUP_BATCH)
      .run();

    const lease = crypto.randomUUID();
    const { results = [] } = await this.db
      .prepare(
        `UPDATE savia_flows_collection_event_outbox
         SET lease_token=?, lease_expires_at=?, attempt_count=attempt_count+1
         WHERE id IN (
           SELECT id FROM savia_flows_collection_event_outbox
           WHERE status='pending' AND available_at<=?
             AND (lease_expires_at IS NULL OR lease_expires_at<=?)
           ORDER BY created_at, id LIMIT ?
         )
         RETURNING *`,
      )
      .bind(lease, now + LEASE_MS, now, now, bounded)
      .all<EventRow & { lease_token: string }>();
    return results.map((row) => ({
      event: mapEvent(row),
      lease: row.lease_token,
    }));
  }

  async complete(id: string, lease: string, now: number): Promise<void> {
    await this.db
      .prepare(
        `UPDATE savia_flows_collection_event_outbox
         SET status='delivered', delivered_at=?, lease_token=NULL,
             lease_expires_at=NULL, last_error=NULL
         WHERE id=? AND status='pending' AND lease_token=?`,
      )
      .bind(now, id, lease)
      .run();
  }

  async retry(
    id: string,
    lease: string,
    error: string,
    now: number,
  ): Promise<void> {
    const row = await this.db
      .prepare(
        `SELECT attempt_count FROM savia_flows_collection_event_outbox
         WHERE id=? AND status='pending' AND lease_token=?`,
      )
      .bind(id, lease)
      .first<{ attempt_count: number }>();
    if (!row) return;
    const attempt = Number(row.attempt_count);
    const status = attempt >= MAX_ATTEMPTS ? "failed" : "pending";
    const delay = Math.min(
      MAX_BACKOFF_MS,
      1000 * 2 ** Math.min(30, attempt - 1),
    );
    await this.db
      .prepare(
        `UPDATE savia_flows_collection_event_outbox
         SET status=?, available_at=?, lease_token=NULL, lease_expires_at=NULL,
             last_error=?
         WHERE id=? AND status='pending' AND lease_token=?`,
      )
      .bind(status, now + delay, error.slice(0, 2000), id, lease)
      .run();
  }

  async get(id: string): Promise<SaviaCollectionEvent | null> {
    const row = await this.db
      .prepare(
        `SELECT id,tenant_id,collection_name,operation,record_id,record_version,
                occurred_at,before_snapshot,after_snapshot,changed_fields,
                actor_kind,actor_id,cause_id
         FROM savia_flows_collection_event_outbox WHERE id=?`,
      )
      .bind(id)
      .first<EventRow>();
    return row ? mapEvent(row) : null;
  }
}
