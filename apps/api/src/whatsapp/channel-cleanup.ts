import { WhatsappChannelRepository } from "./channel-repository";

export const CHANNEL_RETENTION_DAYS = 30;
/** Keep uncertain dispatch evidence until an operator resolves it. Domain records
 * and ownership links follow tenant/connection deletion, never history cleanup. */
export async function cleanupChannelState(
  repository: WhatsappChannelRepository,
  now = Date.now(),
) {
  const cutoff = new Date(
    now - CHANNEL_RETENTION_DAYS * 86400000,
  ).toISOString();
  const db = repository.db;
  await db
    .prepare(
      "UPDATE whatsapp_channel_actions SET status='expired' WHERE status='pending' AND expires_at<?",
    )
    .bind(new Date(now).toISOString())
    .run();
  await db
    .prepare("DELETE FROM whatsapp_channel_history WHERE created_at<?")
    .bind(cutoff)
    .run();
  await db
    .prepare(
      "DELETE FROM whatsapp_channel_actions WHERE created_at<? AND status IN ('completed','failed','cancelled','expired')",
    )
    .bind(cutoff)
    .run();
  const rows = await db
    .prepare(
      "SELECT connection_id,contact,draft_json FROM whatsapp_channel_contacts WHERE draft_json IS NOT NULL AND NOT EXISTS (SELECT 1 FROM whatsapp_channel_actions a WHERE a.connection_id=whatsapp_channel_contacts.connection_id AND a.contact=whatsapp_channel_contacts.contact AND a.status IN ('queued','dispatching','uncertain'))",
    )
    .all<{ connection_id: string; contact: string; draft_json: string }>();
  for (const row of rows.results) {
    const updatedAt = JSON.parse(row.draft_json)._updatedAt;
    if (typeof updatedAt === "string" && updatedAt < cutoff)
      await db
        .prepare(
          "UPDATE whatsapp_channel_contacts SET draft_json=NULL WHERE connection_id=? AND contact=? AND draft_json=?",
        )
        .bind(row.connection_id, row.contact, row.draft_json)
        .run();
  }
}
