import { NotificationRepository } from "../src/notifications/repository";
import type { NoticeEventInput } from "@savia/crm-shared/notifications";

/**
 * Loopback-only preview fixture: seeds a workspace inbox with representative
 * notices for recorded browser verification. Never points at production data.
 */
export async function seedNotificationsPreview(
  db: D1Database,
  workspaceId: string,
  recipient: string,
  now: number = Date.now(),
): Promise<string[]> {
  const repository = new NotificationRepository(db);
  const inputs: NoticeEventInput[] = [
    {
      scope: { kind: "workspace", id: workspaceId },
      key: "preview:edit",
      actor: { kind: "user", id: "colleague" },
      source: {
        kind: "record",
        collection: "requests",
        id: "req-1",
        operation: "updated",
      },
      title: "Requests updated",
      body: "Status changed to approved",
      audience: { kind: "explicit", principals: [recipient] },
      createdAt: now - 60_000,
      expiresAt: null,
    },
    {
      scope: { kind: "workspace", id: workspaceId },
      key: "preview:task",
      actor: { kind: "workflow", id: "run-1" },
      source: { kind: "workflow-task", id: "task-1" },
      title: "Review the quote",
      body: "",
      audience: { kind: "explicit", principals: [recipient] },
      createdAt: now - 30_000,
      expiresAt: null,
    },
    {
      scope: { kind: "workspace", id: workspaceId },
      key: "preview:admin",
      actor: { kind: "user", id: "admin" },
      source: { kind: "admin-message", id: "msg-1" },
      title: "Planned maintenance",
      body: "Sunday 02:00 UTC",
      audience: { kind: "explicit", principals: [recipient] },
      createdAt: now,
      expiresAt: null,
    },
  ];
  const ids: string[] = [];
  for (const input of inputs) {
    const { id } = await repository.accept(input);
    await db
      .prepare(
        `INSERT OR IGNORE INTO notification_deliveries(id,event_id,scope_kind,scope_id,recipient_id,created_at)
         VALUES (?,?,?,?,?,?)`,
      )
      .bind(
        `dlv_preview_${id}`,
        id,
        "workspace",
        workspaceId,
        recipient,
        input.createdAt,
      )
      .run();
    ids.push(`dlv_preview_${id}`);
  }
  return ids;
}
