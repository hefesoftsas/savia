import type {
  NoticeScope,
  NotificationPolicy,
} from "@savia/studio-shared/notifications";
import { fail } from "../context";
import { WorkflowRepository } from "../workflows/repository";

export type NoticeResolution =
  | { kind: "none" }
  | { kind: "task"; state: "pending" | "done" | "unavailable"; resolved: boolean }
  | { kind: "acknowledge"; acknowledged: boolean }
  | { kind: "navigate"; route: string };

export async function resolveNoticeAction(
  db: D1Database,
  policy: NotificationPolicy,
  principal: string,
  scope: NoticeScope,
  deliveryId: string,
): Promise<NoticeResolution> {
  const row = await db
    .prepare(
      `SELECT d.event_id,e.payload FROM notification_deliveries d
       JOIN notification_events e ON e.id=d.event_id
       WHERE d.id=? AND d.recipient_id=? AND d.scope_kind=? AND d.scope_id=?`,
    )
    .bind(deliveryId, principal, scope.kind, scope.id)
    .first<{ event_id: string; payload: string }>();
  if (!row) return fail("Notification not found.", 404);
  let event: { source: { kind: string; id?: string } };
  try {
    event = JSON.parse(row.payload);
  } catch {
    return fail("Notification payload is unreadable.", 422);
  }
  if (event.source?.kind === "workflow-task") {
    const task = await db
      .prepare("SELECT status,assignee FROM workflow_tasks WHERE id=?")
      .bind(event.source.id)
      .first<{ status: string; assignee: string }>();
    if (!task) return { kind: "task", state: "unavailable", resolved: false };
    if (task.assignee !== principal) return fail("Notification not found.", 404);
    if (task.status === "done") return { kind: "task", state: "done", resolved: true };
    return { kind: "task", state: "pending", resolved: false };
  }
  if (event.source?.kind === "admin-message") {
    const ack = await db
      .prepare("SELECT resolved_at FROM notification_deliveries WHERE id=?")
      .bind(deliveryId)
      .first<{ resolved_at: number | null }>();
    return { kind: "acknowledge", acknowledged: ack?.resolved_at != null };
  }
  if (event.source?.kind === "security-request") {
    return { kind: "navigate", route: "/account/security" };
  }
  return { kind: "none" };
}

export async function resolveTaskNotice(
  db: D1Database,
  policy: NotificationPolicy,
  principal: string,
  scope: NoticeScope,
  deliveryId: string,
): Promise<void> {
  const resolution = await resolveNoticeAction(db, policy, principal, scope, deliveryId);
  if (resolution.kind === "task" && resolution.state === "pending") {
    const row = await db
      .prepare(
        `SELECT e.payload FROM notification_deliveries d
         JOIN notification_events e ON e.id=d.event_id WHERE d.id=?`,
      )
      .bind(deliveryId)
      .first<{ payload: string }>();
    const source = (JSON.parse(row?.payload ?? "{}") as { source?: { id?: string } }).source;
    if (scope.kind !== "workspace" || !source?.id) return fail("Task cannot be resolved.", 409);
    await new WorkflowRepository(db, scope.id).resolveTask(source.id, principal);
    return;
  }
  if (resolution.kind === "acknowledge") {
    const updated = await db
      .prepare(
        `UPDATE notification_deliveries SET resolved_at=?
         WHERE id=? AND recipient_id=? AND resolved_at IS NULL`,
      )
      .bind(Date.now(), deliveryId, principal)
      .run();
    if ((updated.meta.changes ?? 0) === 0) return fail("Notification not found.", 404);
    return;
  }
  return fail("Notice has no resolvable action.", 409);
}
