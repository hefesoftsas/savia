import type {
  WhatsappAssistantBinding,
  WhatsappInboundDependencies,
} from "./inbound-contracts";
import { WhatsappInboundRepository } from "./inbound-repository";

const MAX_REPLY_LENGTH = 4096;
const DEFAULT_BATCH_SIZE = 10;

function sameBinding(
  left: WhatsappAssistantBinding,
  right: WhatsappAssistantBinding,
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.connectionId === right.connectionId &&
    left.employeeId === right.employeeId &&
    left.ownerPrincipalId === right.ownerPrincipalId
  );
}

export async function processWhatsappInbox(
  repository: WhatsappInboundRepository,
  dependencies: WhatsappInboundDependencies,
  limit = DEFAULT_BATCH_SIZE,
): Promise<{ processed: number; failed: number }> {
  const now = new Date().toISOString();
  const candidates = await repository.candidates(limit, now);
  let processed = 0;
  let failed = 0;

  for (const messageId of candidates) {
    const token = crypto.randomUUID();
    const item = await repository.claim(
      messageId,
      token,
      new Date().toISOString(),
    );
    if (!item) continue;

    if (!(await repository.isWithinReplyWindow(item.messageId))) {
      await repository.fail(item.messageId, token, "inbound_message_expired");
      failed++;
      continue;
    }

    let binding = await repository.resolve(item.phoneNumberId, item.wabaId);
    if (
      !binding ||
      binding.tenantId !== item.tenantId ||
      binding.connectionId !== item.connectionId ||
      !binding.allowedContacts.includes(item.normalizedContact)
    ) {
      await repository.fail(
        item.messageId,
        token,
        "assistant_binding_unavailable",
      );
      failed++;
      continue;
    }

    const history = await repository.getHistory(
      item.connectionId,
      item.normalizedContact,
    );
    let reply: string;
    try {
      const generated = await dependencies.generate(
        binding,
        history,
        item.text,
      );
      reply = typeof generated === "string" ? generated.trim() : "";
      if (!reply || reply.length > MAX_REPLY_LENGTH)
        throw new Error("Generated reply is empty or too long");
    } catch {
      await repository.retryGeneration(item.messageId, token, item.attempts);
      failed++;
      continue;
    }

    if (!(await repository.isWithinReplyWindow(item.messageId))) {
      await repository.fail(item.messageId, token, "inbound_message_expired");
      failed++;
      continue;
    }

    const current = await repository.resolve(item.phoneNumberId, item.wabaId);
    if (
      !current ||
      !sameBinding(binding, current) ||
      !current.allowedContacts.includes(item.normalizedContact)
    ) {
      await repository.fail(item.messageId, token, "assistant_binding_changed");
      failed++;
      continue;
    }
    binding = current;

    const startedAt = new Date().toISOString();
    if (
      !(await repository.beginResponse(item.messageId, token, reply, startedAt))
    )
      continue;

    // A responding row is never reclaimed for generation or sending. This final
    // check prevents a setting or membership revocation just before dispatch.
    const beforeSend = await repository.resolve(
      item.phoneNumberId,
      item.wabaId,
    );
    if (!(await repository.isWithinReplyWindow(item.messageId))) {
      await repository.fail(item.messageId, token, "inbound_message_expired");
      failed++;
      continue;
    }
    if (
      !beforeSend ||
      !sameBinding(binding, beforeSend) ||
      !beforeSend.allowedContacts.includes(item.normalizedContact)
    ) {
      await repository.fail(item.messageId, token, "assistant_binding_changed");
      failed++;
      continue;
    }

    try {
      const outboundId = await dependencies.send(
        beforeSend,
        reply,
        item.contactPhone,
      );
      if (!outboundId.trim())
        throw new Error("The provider returned no message id");
      if (await repository.complete(item.messageId, token, outboundId))
        processed++;
      else failed++;
    } catch {
      // The request may have reached Meta even if its response was lost. Keep
      // the saved reply and stop here; an automatic retry could send twice.
      await repository.fail(item.messageId, token, "outbound_send_uncertain");
      failed++;
    }
  }

  return { processed, failed };
}
