import type { ContactAccess } from "./channel-contracts";
import type { WhatsappInboundInput } from "./inbound-contracts";
import { WhatsappChannelRepository } from "./channel-repository";
import { isMainMenuCommand } from "./task-menu";

const request = "borrar mis datos y empezar de nuevo";
const invalid =
  "No hay una confirmación de borrado vigente o el código no coincide. Escribe Borrar mis datos y empezar de nuevo para solicitar otra.";
const busy =
  "Hay una solicitud confirmada en procesamiento. Espera a que termine antes de borrar el borrador y la conversación.";
const success =
  "Tus borradores y el contexto de los asistentes fueron borrados. Las cotizaciones ejecutadas y sus registros se conservan. Escribe menú para elegir una tarea y empezar de nuevo.";
export const redactResetCode = (text: string) =>
  text.replace(/\bBORRAR [A-Z2-7]{10}\b/gi, "[Confirmación de borrado]");

async function hash(value: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** Contact-bound controls are handled before any model or employee tools. */
export async function handleConversationReset(
  repo: WhatsappChannelRepository,
  access: ContactAccess,
  input: WhatsappInboundInput,
): Promise<{ access: ContactAccess; reply: string; request: boolean } | null> {
  const text = input.text
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const row = await repo.db
    .prepare(
      "SELECT reset_token_hash,reset_expires_at,last_reset_message_id FROM whatsapp_channel_contacts WHERE connection_id=? AND contact=? AND generation=?",
    )
    .bind(access.connectionId, access.contact, access.generation)
    .first<{
      reset_token_hash: string | null;
      reset_expires_at: string | null;
      last_reset_message_id: string | null;
    }>();
  if (row?.last_reset_message_id === input.messageId)
    return { access, reply: success, request: false };
  const scope = [access.connectionId, access.contact, access.generation];
  if (
    text === "cancelar borrado" ||
    (row?.reset_token_hash && isMainMenuCommand(input.text))
  ) {
    await repo.db
      .prepare(
        "UPDATE whatsapp_channel_contacts SET reset_token_hash=NULL,reset_expires_at=NULL,reset_attempts=0 WHERE connection_id=? AND contact=? AND generation=?",
      )
      .bind(...scope)
      .run();
    if (text === "cancelar borrado")
      return {
        access,
        reply: "Borrado cancelado. Tus datos se conservan.",
        request: false,
      };
    return null;
  }
  if (text === request) {
    const code = Array.from(
      crypto.getRandomValues(new Uint8Array(10)),
      (b) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[b & 31],
    ).join("");
    await repo.db
      .prepare(
        "UPDATE whatsapp_channel_contacts SET reset_token_hash=?,reset_expires_at=?,reset_attempts=0 WHERE connection_id=? AND contact=? AND generation=?",
      )
      .bind(
        await hash(code),
        new Date(Date.now() + 300000).toISOString(),
        ...scope,
      )
      .run();
    return {
      access,
      request: true,
      reply: `Borraré los borradores y el contexto de conversación de tu número en Savia, y cancelaré las confirmaciones pendientes. Las cotizaciones ejecutadas y sus registros se conservan.\n\nPara confirmar escribe BORRAR ${code}. Para cancelar escribe CANCELAR BORRADO. El código vence en 5 minutos.`,
    };
  }
  if (row?.reset_token_hash && /^(si|confirmo|confirmar)$/.test(text))
    return {
      access,
      request: false,
      reply:
        "Para borrar los borradores y el contexto, escribe BORRAR seguido del código del mensaje anterior. También puedes escribir CANCELAR BORRADO.",
    };
  if (!/^borrar(?:\s|$)/.test(text)) return null;
  const now = new Date().toISOString();
  if (
    !row?.reset_token_hash ||
    !row.reset_expires_at ||
    row.reset_expires_at <= now
  )
    return { access, reply: invalid, request: false };
  const code = /^borrar ([a-z2-7]{10})$/.exec(text)?.[1]?.toUpperCase();
  if (!code || (await hash(code)) !== row.reset_token_hash) {
    await repo.db
      .prepare(
        "UPDATE whatsapp_channel_contacts SET reset_token_hash=CASE WHEN reset_attempts>=4 THEN NULL ELSE reset_token_hash END,reset_expires_at=CASE WHEN reset_attempts>=4 THEN NULL ELSE reset_expires_at END,reset_attempts=reset_attempts+1 WHERE connection_id=? AND contact=? AND generation=? AND reset_token_hash=?",
      )
      .bind(...scope, row.reset_token_hash)
      .run();
    return { access, reply: invalid, request: false };
  }
  const generation = crypto.randomUUID();
  const accepted = await repo.db
    .prepare(
      "SELECT received_at FROM whatsapp_inbox WHERE message_id=? AND connection_id=? AND normalized_contact=?",
    )
    .bind(input.messageId, access.connectionId, access.contact)
    .first<{ received_at: string }>();
  if (!accepted) throw new Error("CHANNEL_RESET_INPUT_REQUIRED");
  const guard =
    "EXISTS (SELECT 1 FROM whatsapp_channel_contacts c WHERE c.connection_id=? AND c.contact=? AND c.generation=? AND c.last_reset_message_id=?)";
  const marker = [
    access.connectionId,
    access.contact,
    generation,
    input.messageId,
  ];
  const pendingHistory = await repo.db
    .prepare(
      "SELECT id,result_json FROM whatsapp_channel_actions WHERE connection_id=? AND contact=? AND delivery_state='history_pending'",
    )
    .bind(access.connectionId, access.contact)
    .all<{ id: string; result_json: string }>();
  const statements = [
    repo.db
      .prepare(
        "UPDATE whatsapp_channel_contacts SET generation=?,employee_id=NULL,selection_revision=selection_revision+1,menu_json=NULL,buffered_text=NULL,draft_json=NULL,reset_token_hash=NULL,reset_expires_at=NULL,reset_attempts=0,last_reset_message_id=? WHERE connection_id=? AND contact=? AND generation=? AND reset_token_hash=? AND reset_expires_at>? AND NOT EXISTS (SELECT 1 FROM whatsapp_channel_actions a WHERE a.connection_id=whatsapp_channel_contacts.connection_id AND a.contact=whatsapp_channel_contacts.contact AND (a.status IN ('queued','dispatching') OR a.delivery_state='sending'))",
      )
      .bind(generation, input.messageId, ...scope, row.reset_token_hash, now),
    repo.db
      .prepare(
        `DELETE FROM whatsapp_channel_history WHERE connection_id=? AND contact=? AND ${guard}`,
      )
      .bind(access.connectionId, access.contact, ...marker),
    repo.db
      .prepare(
        `DELETE FROM whatsapp_channel_actions WHERE connection_id=? AND contact=? AND status IN ('pending','cancelled','expired') AND NOT EXISTS (SELECT 1 FROM whatsapp_channel_dispatches d WHERE d.action_id=whatsapp_channel_actions.id) AND ${guard}`,
      )
      .bind(access.connectionId, access.contact, ...marker),
    repo.db
      .prepare(
        `UPDATE whatsapp_channel_actions SET delivery_state='revoked' WHERE connection_id=? AND contact=? AND generation<>? AND (delivery_state IS NULL OR delivery_state='history_pending') AND ${guard}`,
      )
      .bind(access.connectionId, access.contact, generation, ...marker),
    repo.db
      .prepare(
        `UPDATE whatsapp_inbox SET message_text='[Conversation reset]',reply_text=NULL,input_payload=NULL,reply_payload=NULL,routing_snapshot=NULL,state=CASE WHEN state='pending' THEN 'failed' ELSE state END,failure_code=CASE WHEN state='pending' THEN 'conversation_reset' ELSE failure_code END WHERE connection_id=? AND normalized_contact=? AND (received_at<? OR (received_at=? AND message_id<?)) AND ${guard}`,
      )
      .bind(
        access.connectionId,
        access.contact,
        accepted.received_at,
        accepted.received_at,
        input.messageId,
        ...marker,
      ),
    repo.db
      .prepare(
        `UPDATE whatsapp_inbox SET message_text='[Conversation reset]',input_payload=NULL WHERE message_id=? AND connection_id=? AND ${guard}`,
      )
      .bind(input.messageId, access.connectionId, ...marker),
    ...pendingHistory.results.map((saved) => {
      const {
        deliveryText: _text,
        deliveryAt: _at,
        ...outcome
      } = JSON.parse(saved.result_json);
      return repo.db
        .prepare(
          `UPDATE whatsapp_channel_actions SET result_json=? WHERE id=? AND ${guard}`,
        )
        .bind(JSON.stringify(outcome), saved.id, ...marker);
    }),
  ];
  const result = await repo.db.batch(statements);
  if (result[0].meta.changes !== 1)
    return { access, reply: busy, request: false };
  return {
    access: await repo.getAccess(access),
    reply: success,
    request: false,
  };
}
