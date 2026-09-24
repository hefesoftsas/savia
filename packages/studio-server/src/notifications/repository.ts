import {
  inboxQuerySchema,
  noticeEventSchema,
  type InboxPage,
  type InboxQuery,
  type NoticeActionState,
  type NoticeEventInput,
  type NoticeScope,
  type NoticeSource,
  type NoticeView,
} from "@savia/studio-shared/notifications";
import { fail } from "../context";
import {
  canonicalPayload,
  decodeCursor,
  encodeCursor,
  stableEventId,
  type DeliveryRow,
} from "./types";

export class NotificationRepository {
  constructor(private readonly db: D1Database) {}

  eventStatements(input: NoticeEventInput): D1PreparedStatement[] {
    const event = noticeEventSchema.parse(input);
    return [
      this.db
        .prepare(
          `INSERT INTO notification_events(id,scope_kind,scope_id,event_key,payload,created_at,expires_at)
           VALUES (?,?,?,?,?,?,?)`,
        )
        .bind(
          stableEventId(event),
          event.scope.kind,
          event.scope.id,
          event.key,
          canonicalPayload(event),
          event.createdAt,
          event.expiresAt,
        ),
    ];
  }

  async find(input: NoticeEventInput): Promise<{ id: string; payload: string } | null> {
    const event = noticeEventSchema.parse(input);
    const row = await this.db
      .prepare("SELECT id,payload FROM notification_events WHERE id=?")
      .bind(stableEventId(event))
      .first<{ id: string; payload: string }>();
    return row ?? null;
  }

  async accept(input: NoticeEventInput): Promise<{ id: string; duplicate: boolean }> {
    const event = noticeEventSchema.parse(input);
    const id = stableEventId(event);
    const payload = canonicalPayload(event);
    try {
      await this.db
        .prepare(
          `INSERT INTO notification_events(id,scope_kind,scope_id,event_key,payload,created_at,expires_at)
           VALUES (?,?,?,?,?,?,?)`,
        )
        .bind(
          id,
          event.scope.kind,
          event.scope.id,
          event.key,
          payload,
          event.createdAt,
          event.expiresAt,
        )
        .run();
      return { id, duplicate: false };
    } catch (e) {
      if (!String(e).includes("UNIQUE")) throw e;
      const existing = await this.db
        .prepare("SELECT payload FROM notification_events WHERE id=?")
        .bind(id)
        .first<string>("payload");
      if (existing === payload) return { id, duplicate: true };
      return fail("The event key already exists with different content.", 409);
    }
  }

  async list(
    principal: string,
    scopes: NoticeScope[],
    rawQuery: InboxQuery,
  ): Promise<InboxPage> {
    const query = inboxQuerySchema.parse(rawQuery ?? {});
    if (scopes.length === 0)
      return { items: [], nextCursor: null, cutoff: "" };
    const scopeWhere = scopes.map(() => "(d.scope_kind=? AND d.scope_id=?)").join(" OR ");
    const scopeArgs = scopes.flatMap((s) => [s.kind, s.id]);
    const rows = (
      await this.db
        .prepare(
          `SELECT d.id,d.event_id,d.scope_kind,d.scope_id,d.recipient_id,d.created_at,
                  d.read_at,d.archived_at,e.payload
           FROM notification_deliveries d
           JOIN notification_events e ON e.id=d.event_id
           WHERE d.recipient_id=? AND (${scopeWhere})
           ORDER BY d.created_at DESC, d.id DESC`,
        )
        .bind(principal, ...scopeArgs)
        .all<DeliveryRow & { payload: string }>()
    ).results;
    let cursor: [number, string] | null = query.cursor ? decodeCursor(query.cursor) : null;
    if (query.cursor && !cursor) return fail("Invalid inbox cursor.", 400);
    const taskIds = new Set<string>();
    for (const row of rows) {
      try {
        const source = (JSON.parse(row.payload) as NoticeEventInput).source;
        if (source?.kind === "workflow-task") taskIds.add(source.id);
      } catch {
        continue;
      }
    }
    const taskStatus = await this.readTaskStatuses([...taskIds]);
    const items: NoticeView[] = [];
    for (const row of rows) {
      if (cursor) {
        const [at, id] = cursor;
        if (row.created_at > at || (row.created_at === at && row.id >= id)) continue;
      }
      let parsed: NoticeEventInput;
      try {
        parsed = JSON.parse(row.payload);
      } catch {
        continue;
      }
      const actionState = this.resolveActionState(parsed.source, taskStatus);
      const unread = row.read_at === null && row.archived_at === null;
      if (query.filter === "unread" && !unread) continue;
      if (query.filter === "pending" && (!unread || actionState !== "pending")) continue;
      items.push({
        id: row.id,
        scope: { kind: row.scope_kind, id: row.scope_id } as NoticeScope,
        title: parsed.title,
        body: parsed.body,
        createdAt: row.created_at,
        readAt: row.read_at,
        archivedAt: row.archived_at,
        source: parsed.source,
        actionState,
      });
      if (items.length >= query.limit) break;
    }
    const last = items[items.length - 1];
    const nextCursor =
      items.length >= query.limit && last ? encodeCursor(last.createdAt, last.id) : null;
    return {
      items,
      nextCursor,
      cutoff: last ? encodeCursor(last.createdAt, last.id) : "",
    };
  }

  async markRead(
    principal: string,
    scope: NoticeScope,
    id: string,
    read: boolean,
  ): Promise<void> {
    const row = await this.db
      .prepare(
        `SELECT id FROM notification_deliveries
         WHERE id=? AND recipient_id=? AND scope_kind=? AND scope_id=?`,
      )
      .bind(id, principal, scope.kind, scope.id)
      .first<string>("id");
    if (!row) return fail("Notification not found.", 404);
    await this.db
      .prepare("UPDATE notification_deliveries SET read_at=? WHERE id=?")
      .bind(read ? Date.now() : null, id)
      .run();
  }

  async count(
    principal: string,
    scopes: NoticeScope[],
    rawQuery: { filter?: "all" | "unread" | "pending" },
  ): Promise<number> {
    const filter = rawQuery?.filter ?? "all";
    if (scopes.length === 0) return 0;
    const scopeWhere = scopes.map(() => "(d.scope_kind=? AND d.scope_id=?)").join(" OR ");
    const scopeArgs = scopes.flatMap((s) => [s.kind, s.id]);
    if (filter === "all") {
      return (
        await this.db
          .prepare(
            `SELECT COUNT(*) AS n FROM notification_deliveries d WHERE d.recipient_id=? AND (${scopeWhere})`,
          )
          .bind(principal, ...scopeArgs)
          .first<number>("n")
      ) ?? 0;
    }
    if (filter === "unread") {
      return (
        await this.db
          .prepare(
            `SELECT COUNT(*) AS n FROM notification_deliveries d
             WHERE d.recipient_id=? AND (${scopeWhere}) AND d.read_at IS NULL AND d.archived_at IS NULL`,
          )
          .bind(principal, ...scopeArgs)
          .first<number>("n")
      ) ?? 0;
    }
    return (
      await this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM notification_deliveries d
           JOIN notification_events e ON e.id=d.event_id
           LEFT JOIN workflow_tasks t ON t.id=json_extract(e.payload,'$.source.id')
             AND json_extract(e.payload,'$.source.kind')='workflow-task'
           WHERE d.recipient_id=? AND (${scopeWhere})
             AND d.read_at IS NULL AND d.archived_at IS NULL
             AND t.status IS NOT NULL AND t.status!='done'`,
        )
        .bind(principal, ...scopeArgs)
        .first<number>("n")
    ) ?? 0;
  }

  async markAllRead(
    principal: string,
    scope: NoticeScope,
    cutoff?: string,
  ): Promise<{ updated: number; nextCursor: string | null }> {
    let bound: [number, string] | null = cutoff ? decodeCursor(cutoff) : null;
    if (cutoff && !bound) return fail("Invalid inbox cursor.", 400);
    const params: (string | number | null)[] = [principal, scope.kind, scope.id];
    let andCutoff = "";
    if (bound) {
      andCutoff = "AND (d.created_at<? OR (d.created_at=? AND d.id<?))";
      params.push(bound[0], bound[0], bound[1]);
    }
    const ids = (
      await this.db
        .prepare(
          `SELECT d.id,d.created_at FROM notification_deliveries d
           WHERE d.recipient_id=? AND d.scope_kind=? AND d.scope_id=? AND d.read_at IS NULL ${andCutoff}
           ORDER BY d.created_at DESC,d.id DESC LIMIT 101`,
        )
        .bind(...params)
        .all<{ id: string; created_at: number }>()
    ).results;
    const page = ids.slice(0, 100);
    const stamp = Date.now();
    for (const row of page) {
      await this.db
        .prepare("UPDATE notification_deliveries SET read_at=? WHERE id=?")
        .bind(stamp, row.id)
        .run();
    }
    const last = page[page.length - 1];
    return {
      updated: page.length,
      nextCursor:
        ids.length > 100 && last ? encodeCursor(last.created_at, last.id) : null,
    };
  }

  async follow(principal: string, workspaceId: string, collection: string): Promise<void> {
    if (!collection || collection.length > 200) return fail("Invalid collection.", 400);
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO notification_subscriptions(workspace_id,principal_id,collection,created_at)
         VALUES (?,?,?,?)`,
      )
      .bind(workspaceId, principal, collection, Date.now())
      .run();
  }

  async unfollow(principal: string, workspaceId: string, collection: string): Promise<void> {
    await this.db
      .prepare(
        `DELETE FROM notification_subscriptions WHERE workspace_id=? AND principal_id=? AND collection=?`,
      )
      .bind(workspaceId, principal, collection)
      .run();
  }

  async follows(principal: string, workspaceId: string): Promise<string[]> {
    return (
      await this.db
        .prepare(
          `SELECT collection FROM notification_subscriptions WHERE workspace_id=? AND principal_id=? ORDER BY collection`,
        )
        .bind(workspaceId, principal)
        .all<{ collection: string }>()
    ).results.map((row) => row.collection);
  }

  async archive(principal: string, scope: NoticeScope, id: string): Promise<void> {
    const row = await this.db
      .prepare(
        `SELECT id FROM notification_deliveries
         WHERE id=? AND recipient_id=? AND scope_kind=? AND scope_id=?`,
      )
      .bind(id, principal, scope.kind, scope.id)
      .first<string>("id");
    if (!row) return fail("Notification not found.", 404);
    await this.db
      .prepare("UPDATE notification_deliveries SET archived_at=? WHERE id=?")
      .bind(Date.now(), id)
      .run();
  }

  private async readTaskStatuses(ids: string[]): Promise<Map<string, string>> {
    const statuses = new Map<string, string>();
    if (ids.length === 0) return statuses;
    const placeholders = ids.map(() => "?").join(",");
    const rows = (
      await this.db
        .prepare(`SELECT id,status FROM workflow_tasks WHERE id IN (${placeholders})`)
        .bind(...ids)
        .all<{ id: string; status: string }>()
    ).results;
    for (const row of rows) statuses.set(row.id, row.status);
    return statuses;
  }

  private resolveActionState(
    source: NoticeSource,
    taskStatus: Map<string, string>,
  ): NoticeActionState {
    if (source?.kind === "workflow-task") {
      const status = taskStatus.get(source.id);
      if (status === undefined) return "unavailable";
      return status === "done" ? "done" : "pending";
    }
    return "none";
  }
}
