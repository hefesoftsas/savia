import { PersonalActionPayloadCipher } from "../assistant/personal-action-payload";
import { WhatsappChannelRepository } from "./channel-repository";
import type { ChannelAction, EmployeeSession } from "./channel-contracts";
import type { NativeReply } from "./native";

async function hash(value: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export class WhatsappChannelActions {
  private readonly cipher: PersonalActionPayloadCipher;
  constructor(
    readonly repository: WhatsappChannelRepository,
    secret: string,
  ) {
    if (!secret.trim()) throw new Error("CHANNEL_ACTIONS_UNAVAILABLE");
    this.cipher = new PersonalActionPayloadCipher(secret);
  }

  async prepare(
    action: ChannelAction,
    summary: string,
    buttons: boolean,
  ): Promise<NativeReply | string> {
    const { access } = action.session;
    const current = await this.repository.getSession(access);
    if (
      current?.employeeId !== action.session.employeeId ||
      current.selectionRevision !== action.session.selectionRevision ||
      current.access.generation !== access.generation
    )
      throw new Error("CHANNEL_ACTION_REVOKED");
    const count = await this.repository.db
      .prepare(
        "SELECT COUNT(*) AS total FROM whatsapp_channel_actions WHERE connection_id=? AND contact=? AND created_at>?",
      )
      .bind(
        access.connectionId,
        access.contact,
        new Date(Date.now() - 600000).toISOString(),
      )
      .first<{ total: number }>();
    if ((count?.total ?? 0) >= 10)
      throw new Error("CHANNEL_ACTION_RATE_LIMITED");
    if (summary.length > 3500) throw new Error("CHANNEL_PREVIEW_TOO_LARGE");
    buttons = buttons && summary.length <= 500;
    const bytes = crypto.getRandomValues(new Uint8Array(buttons ? 16 : 10));
    const token = buttons
      ? Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
      : Array.from(
          bytes,
          (b) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[b & 31],
        ).join("");
    const payload = await this.cipher.seal({
      actionId: action.id,
      principalId: access.principalId ?? access.contact,
      payload: action.input,
    });
    const sealed = { ...action, input: { sealedPayload: payload } };
    const expires = new Date(Date.now() + 300000).toISOString();
    await this.repository.db.batch([
      this.repository.db
        .prepare(
          "UPDATE whatsapp_channel_actions SET status='cancelled' WHERE connection_id=? AND contact=? AND status='pending'",
        )
        .bind(access.connectionId, access.contact),
      this.repository.db
        .prepare(
          "INSERT INTO whatsapp_channel_actions(id,connection_id,tenant_id,contact,generation,employee_id,selection_revision,action_json,token_hash,status,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,'pending',?,?)",
        )
        .bind(
          action.id,
          access.connectionId,
          access.tenantId,
          access.contact,
          access.generation,
          action.session.employeeId,
          action.session.selectionRevision,
          JSON.stringify(sealed),
          await hash(token),
          expires,
          new Date().toISOString(),
        ),
    ]);
    const text = `${summary}\n\nRevisa los datos y confirma para ejecutar. Escribe menú o inicio para elegir otra tarea. Esta confirmación vence en 5 minutos.`;
    return buttons
      ? {
          kind: "buttons",
          text: text.slice(0, 1024),
          options: [
            {
              id: `confirm:${action.id}:${token}`,
              title:
                action.domain === "insurance"
                  ? "Confirmar y cotizar"
                  : "Confirmar",
            },
            { id: `cancel:${action.id}:${token}`, title: "Cancelar" },
          ],
        }
      : `${text}\n\nPara confirmar escribe CONFIRMAR ${token}. Para cancelar escribe CANCELAR.`;
  }

  async consume(
    session: EmployeeSession,
    choice: string,
  ): Promise<{ state: "queued" | "cancelled"; jobId: string } | null> {
    const isButton = /^(confirm|cancel):[a-f\d-]{36}:[a-f\d]{32}$/.test(choice);
    const isText = /^CONFIRMAR [A-Z2-7]{10}$/.test(choice.trim());
    const cancel =
      choice.trim().toUpperCase() === "CANCELAR" ||
      choice.startsWith("cancel:");
    if (!isButton && !isText && !cancel) return null;
    const current = await this.repository.getSession(session.access);
    if (
      !current ||
      current.access.generation !== session.access.generation ||
      current.employeeId !== session.employeeId ||
      current.selectionRevision !== session.selectionRevision
    )
      return null;
    const row = await this.repository.db
      .prepare(
        "SELECT id,token_hash,expires_at FROM whatsapp_channel_actions WHERE connection_id=? AND contact=? AND generation=? AND employee_id=? AND selection_revision=? AND status='pending' ORDER BY created_at DESC LIMIT 1",
      )
      .bind(
        session.access.connectionId,
        session.access.contact,
        session.access.generation,
        session.employeeId,
        session.selectionRevision,
      )
      .first<{ id: string; token_hash: string; expires_at: string }>();
    if (!row) return null;
    if (row.expires_at <= new Date().toISOString()) {
      await this.repository.db
        .prepare(
          "UPDATE whatsapp_channel_actions SET status='expired' WHERE id=? AND status='pending'",
        )
        .bind(row.id)
        .run();
      return null;
    }
    const parts = choice.split(":");
    if (isButton && parts[1] !== row.id) return null;
    const token = isButton ? parts[2] : choice.trim().slice(10);
    if (!(cancel && !isButton) && (await hash(token)) !== row.token_hash) {
      await this.repository.db
        .prepare(
          "UPDATE whatsapp_channel_actions SET attempts=attempts+1,status=CASE WHEN attempts>=4 THEN 'cancelled' ELSE status END WHERE id=? AND status='pending'",
        )
        .bind(row.id)
        .run();
      return null;
    }
    const status = cancel ? "cancelled" : "queued";
    const result = await this.repository.db
      .prepare(
        "UPDATE whatsapp_channel_actions SET status=? WHERE id=? AND status='pending' AND expires_at>? AND generation=? AND selection_revision=?",
      )
      .bind(
        status,
        row.id,
        new Date().toISOString(),
        session.access.generation,
        session.selectionRevision,
      )
      .run();
    return result.meta.changes === 1 ? { state: status, jobId: row.id } : null;
  }

  async open(serialized: string): Promise<ChannelAction> {
    const action = JSON.parse(serialized) as ChannelAction;
    const input = await this.cipher.unseal({
      actionId: action.id,
      principalId:
        action.session.access.principalId ?? action.session.access.contact,
      storedInput: action.input,
    });
    return { ...action, input };
  }
}
