import type {
  WhatsappAssistantBinding,
  WhatsappInboundDependencies,
  WhatsappInboundInput,
  WhatsappChatMessage,
} from "./inbound-contracts";
import type { EmployeeSession } from "./channel-contracts";
import { WhatsappChannelRepository } from "./channel-repository";
import { routeEmployeeInput } from "./employee-router";
import { nativeReplyText, type NativeReply } from "./native";

type Snapshot = {
  generation: string;
  session: EmployeeSession | null;
  text: string;
  reply?: NativeReply | string;
};
export function createRoutedWhatsappGenerator(
  repository: WhatsappChannelRepository,
  complete: WhatsappInboundDependencies["generate"],
) {
  const snapshot = async (messageId: string) => {
    const row = await repository.db
      .prepare("SELECT routing_snapshot FROM whatsapp_inbox WHERE message_id=?")
      .bind(messageId)
      .first<{ routing_snapshot: string | null }>();
    return row?.routing_snapshot
      ? (JSON.parse(row.routing_snapshot) as Snapshot)
      : null;
  };
  return {
    async generate(
      binding: WhatsappAssistantBinding,
      history: WhatsappChatMessage[],
      text: string,
      input?: WhatsappInboundInput,
    ): Promise<string | NativeReply> {
      const settings = await repository.settings(
        binding.tenantId,
        binding.connectionId,
      );
      if (!settings?.config.routingEnabled)
        return complete(binding, history, text, input);
      if (!input) throw new Error("CHANNEL_INPUT_REQUIRED");
      const access = await repository.getAccess({
        tenantId: binding.tenantId,
        connectionId: binding.connectionId,
        contact: input.contactPhone.replace(/\D/g, ""),
      });
      let saved = await snapshot(input.messageId);
      if (saved && saved.generation !== access.generation)
        throw new Error("CHANNEL_ACCESS_REVOKED");
      if (!saved) {
        const route = await routeEmployeeInput(
          access,
          input,
          repository,
          Boolean(binding.native?.listMessages),
        );
        saved =
          route.kind === "reply"
            ? {
                generation: access.generation,
                session: null,
                text,
                reply: route.reply,
              }
            : {
                generation: access.generation,
                session: route.session,
                text: route.text,
              };
        await repository.db
          .prepare(
            "UPDATE whatsapp_inbox SET routing_snapshot=? WHERE message_id=? AND connection_id=?",
          )
          .bind(JSON.stringify(saved), input.messageId, binding.connectionId)
          .run();
      }
      if (saved.reply) return saved.reply;
      if (!saved.session) throw new Error("CHANNEL_SELECTION_REQUIRED");
      const rows = await repository.db
        .prepare(
          "SELECT user_text,assistant_text FROM whatsapp_channel_history WHERE connection_id=? AND contact=? AND generation=? AND employee_id=? ORDER BY created_at DESC,message_id DESC LIMIT 20",
        )
        .bind(
          access.connectionId,
          access.contact,
          access.generation,
          saved.session.employeeId,
        )
        .all<{ user_text: string; assistant_text: string }>();
      const employee = await repository.db
        .prepare(
          "SELECT name FROM assistant_virtual_employees WHERE id=? AND agency_id=? AND status='active'",
        )
        .bind(saved.session.employeeId, access.tenantId)
        .first<{ name: string }>();
      if (!employee) throw new Error("CHANNEL_EMPLOYEE_UNAVAILABLE");
      const scopedHistory = rows.results.reverse().flatMap((r) => [
        { role: "user" as const, content: r.user_text },
        { role: "assistant" as const, content: r.assistant_text },
      ]);
      const reply = await complete(
        {
          ...binding,
          employeeId: saved.session.employeeId,
          channelSession: saved.session,
        },
        scopedHistory,
        saved.text,
        { ...input, text: saved.text },
      );
      const label = `${employee.name} · Asistente virtual\n\n`;
      if (typeof reply === "string") return (label + reply).slice(0, 4096);
      if ("text" in reply)
        return {
          ...reply,
          text: (label + reply.text).slice(
            0,
            reply.kind === "text" ? 4096 : 1024,
          ),
        };
      if (reply.kind === "media")
        return {
          ...reply,
          caption: (label + (reply.caption ?? "")).slice(0, 1024),
        };
      return reply;
    },
    async authorizeReply(
      binding: WhatsappAssistantBinding,
      input: WhatsappInboundInput,
    ) {
      const saved = await snapshot(input.messageId);
      if (!saved)
        return !(
          await repository.settings(binding.tenantId, binding.connectionId)
        )?.config.routingEnabled;
      try {
        const access = await repository.getAccess({
          tenantId: binding.tenantId,
          connectionId: binding.connectionId,
          contact: input.contactPhone.replace(/\D/g, ""),
        });
        if (access.generation !== saved.generation) return false;
        if (!saved.session) return true;
        const current = await repository.getSession(access);
        return (
          current?.employeeId === saved.session.employeeId &&
          current.selectionRevision === saved.session.selectionRevision
        );
      } catch {
        return false;
      }
    },
    async afterReply(
      binding: WhatsappAssistantBinding,
      input: WhatsappInboundInput,
      reply: string | NativeReply,
    ) {
      const saved = await snapshot(input.messageId);
      if (!saved?.session) return;
      await repository.db
        .prepare(
          "INSERT INTO whatsapp_channel_history(message_id,connection_id,contact,generation,employee_id,user_text,assistant_text,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(message_id) DO NOTHING",
        )
        .bind(
          input.messageId,
          binding.connectionId,
          saved.session.access.contact,
          saved.generation,
          saved.session.employeeId,
          saved.text,
          typeof reply === "string"
            ? reply
            : nativeReplyText(reply, binding.native),
          new Date().toISOString(),
        )
        .run();
    },
  };
}
