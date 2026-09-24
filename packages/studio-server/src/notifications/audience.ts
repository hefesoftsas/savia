import type {
  NoticeEventInput,
  NotificationPolicy,
} from "@savia/studio-shared/notifications";

export interface RecipientPage {
  ids: string[];
  nextCursor: string | null;
}

export async function resolveAudienceRecipients(
  db: D1Database,
  policy: NotificationPolicy,
  event: NoticeEventInput,
  after: string | null,
  limit: number,
): Promise<RecipientPage> {
  if (event.audience.kind === "explicit") {
    const ordered = [...new Set(event.audience.principals)].sort();
    const start = after === null ? 0 : ordered.findIndex((id) => id > after);
    const ids = (start < 0 ? [] : ordered.slice(start, start + limit));
    const last = ids[ids.length - 1];
    return {
      ids,
      nextCursor:
        last !== undefined && start + limit < ordered.length ? last : null,
    };
  }
  return policy.recipients(event, after, limit);
}

export async function listFollowers(
  db: D1Database,
  workspaceId: string,
  collection: string,
): Promise<string[]> {
  const rows = (
    await db
      .prepare(
        `SELECT principal_id FROM notification_subscriptions
         WHERE workspace_id=? AND collection=? ORDER BY principal_id`,
      )
      .bind(workspaceId, collection)
      .all<{ principal_id: string }>()
  ).results;
  return rows.map((row) => row.principal_id);
}
