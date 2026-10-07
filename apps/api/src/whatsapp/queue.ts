import type { WhatsappInboundInput } from "./inbound-contracts";

export type WhatsappQueueScope = { connectionId: string; contact: string };

/** Only unfinished work participates; completed history never keeps a worker awake. */
export async function nextWhatsappWake(
  db: D1Database,
  scope: WhatsappQueueScope,
): Promise<number | null> {
  const result = await db
    .prepare(
      `
    SELECT MIN(due_at) AS due_at FROM (
      SELECT due_at FROM (
        SELECT CASE WHEN state='pending' THEN COALESCE(retry_at,received_at)
          ELSE lease_until END AS due_at
        FROM whatsapp_inbox WHERE connection_id=? AND normalized_contact=?
          AND state IN ('pending','generating','responding')
        ORDER BY received_at,message_id LIMIT 1
      )
      UNION ALL
      SELECT CASE WHEN status='dispatching' THEN lease_until
        WHEN delivery_state='sending' THEN COALESCE(lease_until,created_at)
        WHEN status='queued' THEN COALESCE(queued_at,created_at)
        ELSE created_at END AS due_at
      FROM whatsapp_channel_actions WHERE connection_id=? AND contact=? AND (
        status='dispatching'
        OR (status='queued' AND NOT EXISTS (
          SELECT 1 FROM whatsapp_channel_actions active
          WHERE active.connection_id=whatsapp_channel_actions.connection_id
            AND active.contact=whatsapp_channel_actions.contact AND active.status='dispatching'
        ))
        OR (status IN ('completed','failed','uncertain')
          AND (delivery_state IS NULL OR delivery_state IN ('history_pending','sending')))
      )
    )`,
    )
    .bind(scope.connectionId, scope.contact, scope.connectionId, scope.contact)
    .first<{ due_at: string | null }>();
  const due = result?.due_at ? Date.parse(result.due_at) : NaN;
  return Number.isFinite(due) ? due : null;
}

/** Recovery is deliberately infrequent; a fresh webhook is the normal wake source. */
export async function recoverWhatsappScopes(
  db: D1Database,
): Promise<WhatsappQueueScope[]> {
  const rows = await db
    .prepare(
      `
    SELECT connection_id,normalized_contact AS contact FROM whatsapp_inbox
      WHERE state IN ('pending','generating','responding')
    UNION
    SELECT connection_id,contact FROM whatsapp_channel_actions
      WHERE status IN ('queued','dispatching') OR (
        status IN ('completed','failed','uncertain')
        AND (delivery_state IS NULL OR delivery_state IN ('history_pending','sending'))
      )`,
    )
    .all<{ connection_id: string; contact: string }>();
  return rows.results.map((row) => ({
    connectionId: row.connection_id,
    contact: row.contact,
  }));
}

export async function wakeWhatsappScope(
  namespace: DurableObjectNamespace,
  scope: WhatsappQueueScope,
): Promise<void> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify([scope.connectionId, scope.contact]),
    ),
  );
  const name = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const response = await namespace
    .get(namespace.idFromName(name))
    .fetch("https://whatsapp-dispatch.internal/wake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(scope),
    });
  if (!response.ok) throw new Error("WHATSAPP_WAKE_FAILED");
}

/** Resolve from the persisted row, including provider redelivery after a lost wake. */
export async function wakeWhatsappInput(
  db: D1Database,
  namespace: DurableObjectNamespace,
  input: WhatsappInboundInput,
): Promise<void> {
  const row = await db
    .prepare(
      `SELECT connection_id,normalized_contact FROM whatsapp_inbox
    WHERE message_id=? AND phone_number_id=? AND waba_id=? AND normalized_contact=?`,
    )
    .bind(
      input.messageId,
      input.phoneNumberId,
      input.wabaId,
      input.contactPhone.replace(/\D/g, ""),
    )
    .first<{ connection_id: string; normalized_contact: string }>();
  if (row)
    await wakeWhatsappScope(namespace, {
      connectionId: row.connection_id,
      contact: row.normalized_contact,
    });
}

export function usesWhatsappEvents(environment: {
  WHATSAPP_PROCESSING_MODE?: string;
  WHATSAPP_DISPATCHER?: DurableObjectNamespace;
}): boolean {
  return environment.WHATSAPP_PROCESSING_MODE === "events";
}

export function isWhatsappRecoveryTick(scheduledTime: number): boolean {
  return Math.floor(scheduledTime / 60_000) % 5 === 0;
}
