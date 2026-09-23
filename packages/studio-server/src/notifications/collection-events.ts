import type { NoticeEventInput } from "@savia/studio-shared/notifications";
import { NotificationRepository } from "./repository";

export function workflowNoticeStatements(
  db: D1Database,
  input: NoticeEventInput,
): D1PreparedStatement[] {
  return new NotificationRepository(db).eventStatements(input);
}

export function workflowTaskNotice(
  db: D1Database,
  workspaceId: string,
  runId: string,
  nodeId: string,
  taskId: string,
  title: string,
  body: string,
  assignee: string,
  now: number,
): D1PreparedStatement[] {
  const event: NoticeEventInput = {
    scope: { kind: "workspace", id: workspaceId },
    key: `workflow:${runId}:${nodeId}`,
    actor: { kind: "workflow", id: runId },
    source: { kind: "workflow-task", id: taskId },
    title,
    body,
    audience: { kind: "explicit", principals: [assignee] },
    createdAt: now,
    expiresAt: null,
  };
  return workflowNoticeStatements(db, event);
}
