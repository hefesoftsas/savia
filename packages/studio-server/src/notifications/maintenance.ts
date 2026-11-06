import { retentionSchema } from "@savia/studio-shared/notifications";
import { fail } from "../context";
import { NotificationRepository } from "./repository";

export interface MaintenanceReport {
  cleanedDeliveries: number;
  cleanedEvents: number;
  backfilled: number;
  cursor: string | null;
}

export async function getRetentionSettings(
  db: D1Database,
  workspaceId: string,
) {
  const row = await db
    .prepare(
      "SELECT read_days,unread_days FROM notification_scope_settings WHERE workspace_id=?",
    )
    .bind(workspaceId)
    .first<{ read_days: number; unread_days: number }>();
  return {
    readDays: row?.read_days ?? 90,
    unreadDays: row?.unread_days ?? 180,
  };
}

export async function saveRetentionSettings(
  db: D1Database,
  workspaceId: string,
  input: unknown,
) {
  const parsed = retentionSchema.parse(input);
  await db
    .prepare(
      `INSERT INTO notification_scope_settings(workspace_id,read_days,unread_days)
       VALUES (?,?,?)
       ON CONFLICT(workspace_id) DO UPDATE SET read_days=?,unread_days=?`,
    )
    .bind(
      workspaceId,
      parsed.readDays,
      parsed.unreadDays,
      parsed.readDays,
      parsed.unreadDays,
    )
    .run();
  return parsed;
}

export async function maintainNotifications(
  db: D1Database,
  now: number,
  limit = 100,
): Promise<MaintenanceReport> {
  const report: MaintenanceReport = {
    cleanedDeliveries: 0,
    cleanedEvents: 0,
    backfilled: 0,
    cursor: null,
  };
  const scopes = (
    await db
      .prepare("SELECT workspace_id FROM notification_scope_settings")
      .all<{
        workspace_id: string;
      }>()
  ).results;
  const settings = new Map<string, { readDays: number; unreadDays: number }>();
  for (const row of scopes) {
    settings.set(
      row.workspace_id,
      await getRetentionSettings(db, row.workspace_id),
    );
  }
  const pendingTasks = new Set(
    (
      await db
        .prepare("SELECT id FROM workflow_tasks WHERE status!='done'")
        .all<{ id: string }>()
    ).results.map((row) => row.id),
  );
  const deliveries = (
    await db
      .prepare(
        `SELECT d.id,d.created_at,d.read_at,d.archived_at,d.scope_kind,d.scope_id,e.payload
         FROM notification_deliveries d
         JOIN notification_events e ON e.id=d.event_id
         ORDER BY d.created_at LIMIT ?`,
      )
      .bind(limit)
      .all<{
        id: string;
        created_at: number;
        read_at: number | null;
        archived_at: number | null;
        scope_kind: string;
        scope_id: string;
        payload: string;
      }>()
  ).results;
  const dayMs = 86_400_000;
  for (const row of deliveries) {
    const retention =
      row.scope_kind === "workspace"
        ? (settings.get(row.scope_id) ?? { readDays: 90, unreadDays: 180 })
        : { readDays: 90, unreadDays: 180 };
    const read = row.read_at !== null || row.archived_at !== null;
    const age = now - row.created_at;
    const expired =
      age > (read ? retention.readDays : retention.unreadDays) * dayMs;
    if (!expired) continue;
    let protected_ = false;
    try {
      const source = (
        JSON.parse(row.payload) as { source?: { kind?: string; id?: string } }
      ).source;
      if (
        source?.kind === "workflow-task" &&
        source.id &&
        pendingTasks.has(source.id)
      )
        protected_ = true;
      if (source?.kind === "security-request") protected_ = true;
    } catch {
      continue;
    }
    if (protected_) continue;
    await db
      .prepare("DELETE FROM notification_deliveries WHERE id=?")
      .bind(row.id)
      .run();
    report.cleanedDeliveries += 1;
  }
  const orphaned = (
    await db
      .prepare(
        `SELECT e.id FROM notification_events e
         LEFT JOIN notification_deliveries d ON d.event_id=e.id
         WHERE d.id IS NULL AND e.status IN ('completed','failed') LIMIT ?`,
      )
      .bind(limit)
      .all<{ id: string }>()
  ).results;
  for (const row of orphaned) {
    await db
      .prepare("DELETE FROM notification_events WHERE id=?")
      .bind(row.id)
      .run();
    report.cleanedEvents += 1;
  }
  return report;
}

export async function backfillWorkflowNotices(
  db: D1Database,
  after: string | null,
  limit = 100,
): Promise<{ backfilled: number; cursor: string | null }> {
  const tasks = (
    await db
      .prepare(
        after
          ? `SELECT workspace_id,id,title,assignee FROM workflow_tasks
             WHERE status!='done' AND id>? ORDER BY id LIMIT ?`
          : `SELECT workspace_id,id,title,assignee FROM workflow_tasks
             WHERE status!='done' ORDER BY id LIMIT ?`,
      )
      .bind(...(after ? [after, limit] : [limit]))
      .all<{
        workspace_id: string;
        id: string;
        title: string;
        assignee: string;
      }>()
  ).results;
  const repository = new NotificationRepository(db);
  let backfilled = 0;
  let cursor: string | null = after;
  for (const task of tasks) {
    const statements = repository.eventStatements({
      scope: { kind: "workspace", id: task.workspace_id },
      key: `workflow:backfill:${task.id}`,
      actor: { kind: "system", id: null },
      source: { kind: "workflow-task", id: task.id },
      title: task.title,
      body: "",
      audience: { kind: "explicit", principals: [task.assignee] },
      createdAt: Date.now(),
      expiresAt: null,
    });
    try {
      await db.batch(statements);
      backfilled += 1;
    } catch (error) {
      if (!String(error).includes("UNIQUE")) throw error;
    }
    cursor = task.id;
  }
  const checkpoint = await db
    .prepare(
      "SELECT cursor FROM notification_maintenance_checkpoints WHERE name='backfill'",
    )
    .bind()
    .first<{ cursor: string }>();
  if (cursor && cursor !== checkpoint?.cursor) {
    await db
      .prepare(
        `INSERT INTO notification_maintenance_checkpoints(name,cursor) VALUES ('backfill',?)
         ON CONFLICT(name) DO UPDATE SET cursor=?`,
      )
      .bind(cursor, cursor)
      .run();
  }
  return { backfilled, cursor };
}

export async function notificationSettingsRoute(
  db: D1Database,
  principal: string,
  workspaceId: string,
  canManage: boolean,
  input?: unknown,
) {
  if (!canManage) return fail("Administrator permission required.", 403);
  if (input === undefined) return getRetentionSettings(db, workspaceId);
  return saveRetentionSettings(db, workspaceId, input);
}
