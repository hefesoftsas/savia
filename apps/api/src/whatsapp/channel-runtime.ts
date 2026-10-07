import type {
  WhatsappAssistantBinding,
  WhatsappInboundDependencies,
  WhatsappInboundInput,
  WhatsappChatMessage,
} from "./inbound-contracts";
import type { ChannelMenu, EmployeeSession } from "./channel-contracts";
import { WhatsappChannelRepository } from "./channel-repository";
import { routeEmployeeInput } from "./employee-router";
import { nativeReplyText, type NativeReply } from "./native";
import { handleConversationReset, redactResetCode } from "./conversation-reset";

import { buildTaskMenu } from "./task-menu";
import { humanSupportRecoveryReply } from "./human-support";

type Snapshot = {
  generation: string;
  session: EmployeeSession | null;
  text: string;
  configurationRevision?: string;
  employeeName?: string;
  reply?: NativeReply | string;
  control?: "conversation-reset";
  quoteReset?: { generation: string; menu: ChannelMenu };
};

/** Stage a fresh menu; the acknowledged reply applies the session reset. */
export async function prepareFailedQuoteReply(
  repository: WhatsappChannelRepository,
  binding: WhatsappAssistantBinding,
  input: WhatsappInboundInput,
): Promise<string> {
  const session = binding.channelSession;
  const settings = await repository.settings(
    binding.tenantId,
    binding.connectionId,
  );
  const failure = humanSupportRecoveryReply(
    settings?.config.humanSupportContact,
  );
  if (!session) return failure;
  const prepared = await repository.prepareQuoteLifecycleReset(
    session.access,
    session.selectionRevision,
    session.employeeId,
  );
  if (!prepared) return failure;
  const row = await repository.db
    .prepare(
      "SELECT routing_snapshot FROM whatsapp_inbox WHERE message_id=? AND connection_id=?",
    )
    .bind(input.messageId, binding.connectionId)
    .first<{ routing_snapshot: string | null }>();
  if (!row?.routing_snapshot) return failure;
  const saved = JSON.parse(row.routing_snapshot) as Snapshot;
  if (
    saved.generation !== session.access.generation ||
    saved.session?.selectionRevision !== session.selectionRevision ||
    saved.session?.employeeId !== session.employeeId
  )
    return failure;
  const result = await repository.db
    .prepare(
      "UPDATE whatsapp_inbox SET routing_snapshot=? WHERE message_id=? AND connection_id=? AND routing_snapshot=?",
    )
    .bind(
      JSON.stringify({ ...saved, quoteReset: prepared }),
      input.messageId,
      binding.connectionId,
      row.routing_snapshot,
    )
    .run();
  if (!result.meta.changes) return failure;
  return `${failure}\n\n${buildTaskMenu(prepared.menu, false)}`;
}

function stripLeadingEmployeeHeaders(value: string, employeeName: string) {
  const header = `${employeeName} · Asistente virtual`;
  let result = value;
  while (result) {
    const lineEnd = result.indexOf("\n");
    const line = (lineEnd === -1 ? result : result.slice(0, lineEnd)).replace(
      /\r$/,
      "",
    );
    if (line.toLocaleLowerCase() !== header.toLocaleLowerCase()) break;
    if (lineEnd === -1) return "";
    result = result.slice(lineEnd + 1);
    while (result.startsWith("\n") || result.startsWith("\r\n"))
      result = result.startsWith("\r\n") ? result.slice(2) : result.slice(1);
  }
  return result;
}

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
      let access = await repository.getAccess({
        tenantId: binding.tenantId,
        connectionId: binding.connectionId,
        contact: input.contactPhone.replace(/\D/g, ""),
      });
      let saved = await snapshot(input.messageId);
      if (saved && saved.generation !== access.generation)
        throw new Error("CHANNEL_ACCESS_REVOKED");
      if (
        saved?.control === "conversation-reset" &&
        !/^borrar mis datos y empezar de nuevo$/i.test(text.trim())
      )
        return saved.reply!;
      const reset = await handleConversationReset(repository, access, input);
      if (reset) {
        access = reset.access;
        saved = {
          generation: access.generation,
          session: null,
          text: "[Conversation reset]",
          configurationRevision: settings.revision,
          reply: redactResetCode(reset.reply),
          control: "conversation-reset",
        };
        await repository.db
          .prepare(
            "UPDATE whatsapp_inbox SET message_text=?,input_payload=NULL,routing_snapshot=? WHERE message_id=? AND connection_id=?",
          )
          .bind(
            reset.request
              ? "Borrar mis datos y empezar de nuevo"
              : "[Conversation reset]",
            JSON.stringify(saved),
            input.messageId,
            binding.connectionId,
          )
          .run();
        return reset.reply;
      }
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
                configurationRevision: (await repository.menu(access))
                  ?.revision,
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
      saved.employeeName = employee.name;
      await repository.db
        .prepare(
          "UPDATE whatsapp_inbox SET routing_snapshot=? WHERE message_id=? AND connection_id=?",
        )
        .bind(JSON.stringify(saved), input.messageId, binding.connectionId)
        .run();
      const scopedHistory = rows.results.reverse().flatMap((r) => [
        { role: "user" as const, content: r.user_text },
        {
          role: "assistant" as const,
          content: stripLeadingEmployeeHeaders(r.assistant_text, employee.name),
        },
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
      const choice =
        input.native?.kind === "choice" ? input.native.id : input.text.trim();
      const label = `${employee.name} · Asistente virtual\n\n`;
      const labeledReply: NativeReply | string =
        typeof reply === "string"
          ? (label + stripLeadingEmployeeHeaders(reply, employee.name)).slice(
              0,
              4096,
            )
          : "text" in reply
            ? {
                ...reply,
                text: (
                  label + stripLeadingEmployeeHeaders(reply.text, employee.name)
                ).slice(0, reply.kind === "text" ? 4096 : 1024),
              }
            : reply.kind === "media"
              ? {
                  ...reply,
                  caption: (
                    label +
                    stripLeadingEmployeeHeaders(
                      reply.caption ?? "",
                      employee.name,
                    )
                  ).slice(0, 1024),
                }
              : reply;
      if (/^(confirm:|cancel:|CONFIRMAR |CANCELAR$)/i.test(choice)) {
        saved.quoteReset = (await snapshot(input.messageId))?.quoteReset;
        saved.text = "[Action confirmation]";
        saved.reply = labeledReply;
        await repository.db
          .prepare(
            "UPDATE whatsapp_inbox SET message_text='[Action confirmation]',input_payload=NULL,routing_snapshot=? WHERE message_id=?",
          )
          .bind(JSON.stringify(saved), input.messageId)
          .run();
      }
      return labeledReply;
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
        if (!saved.session) {
          if (!saved.reply) return true;
          const currentSettings = await repository.settings(
            binding.tenantId,
            binding.connectionId,
          );
          if (
            !currentSettings?.config.routingEnabled ||
            !saved.configurationRevision ||
            currentSettings.revision !== saved.configurationRevision
          )
            return false;
          if (saved.control === "conversation-reset") return true;
          const menu = await repository.menu(access);
          if (!menu || menu.revision !== saved.configurationRevision)
            return false;
          const currentTasks = await repository.listTasks(
            access,
            currentSettings,
          );
          const menuTaskIds = menu.tasks.map((task) => task.id).sort();
          const currentTaskIds = currentTasks.map((task) => task.id).sort();
          return (
            menuTaskIds.length === currentTaskIds.length &&
            menuTaskIds.every((id, index) => id === currentTaskIds[index])
          );
        }
        const current = await repository.getSession(access);
        return (
          current?.employeeId === saved.session.employeeId &&
          current.selectionRevision === saved.session.selectionRevision
        );
      } catch {
        return false;
      }
    },
    async recoveryReply(
      binding: WhatsappAssistantBinding,
      input: WhatsappInboundInput,
    ) {
      const saved = await snapshot(input.messageId);
      if (
        saved?.session?.access.capabilities.some(
          (capability) => capability === "insurance" || capability === "*",
        )
      )
        return prepareFailedQuoteReply(
          repository,
          { ...binding, channelSession: saved.session },
          input,
        );
      const settings = await repository.settings(
        binding.tenantId,
        binding.connectionId,
      );
      return humanSupportRecoveryReply(settings?.config.humanSupportContact);
    },
    async afterReply(
      binding: WhatsappAssistantBinding,
      input: WhatsappInboundInput,
      reply: string | NativeReply,
    ) {
      const saved = await snapshot(input.messageId);
      if (!saved?.session) return;
      const assistantText =
        typeof reply === "string"
          ? reply
          : reply.kind === "media" && saved.employeeName
            ? nativeReplyText(
                {
                  ...reply,
                  caption: reply.caption
                    ? stripLeadingEmployeeHeaders(
                        reply.caption,
                        saved.employeeName,
                      ) || undefined
                    : undefined,
                },
                binding.native,
              )
            : nativeReplyText(reply, binding.native);
      const historyStatement = repository.db
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
          assistantText.replace(
            /CONFIRMAR [A-Z2-7]{10}/gi,
            "[Confirmación pendiente]",
          ),
          new Date().toISOString(),
        );
      await repository.db.batch([
        historyStatement,
        ...(saved.quoteReset
          ? repository.quoteLifecycleResetStatements(
              saved.session.access,
              saved.session.selectionRevision,
              saved.session.employeeId,
              saved.quoteReset,
              { kind: "inbound-reply", messageId: input.messageId },
            )
          : []),
      ]);
    },
  };
}
