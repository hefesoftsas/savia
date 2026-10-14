import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import { setupChannelFixture } from "./whatsapp-channel-fixture";
import { WhatsappChannelRepository } from "../src/whatsapp/channel-repository";
import { createRoutedWhatsappGenerator } from "../src/whatsapp/channel-runtime";
import { processWhatsappInbox } from "../src/whatsapp/inbound-processor";
import { handleConversationReset } from "../src/whatsapp/conversation-reset";
import { ChannelDrafts } from "../src/whatsapp/drafts";
import { WhatsappChannelActions } from "../src/whatsapp/confirmations";
import type { WhatsappInboundDependencies } from "../src/whatsapp/inbound-contracts";

async function setup() {
  const s = await setupChannelFixture();
  const repo = new WhatsappChannelRepository(env.DB);
  await repo.configure(
    s.tenantId,
    s.connectionId,
    {
      routingEnabled: true,
      tasks: [
        {
          id: "quotes",
          employeeId: s.employeeId,
          title: "Consultar seguros",
          description: "",
          order: 0,
          audiences: ["external"],
        },
      ],
      staff: [],
      internalCapabilities: [],
      externalCapabilities: ["insurance"],
    },
    s.principal.id,
  );
  const access = await repo.getAccess({
    tenantId: s.tenantId,
    connectionId: s.connectionId,
    contact: "573001234567",
  });
  const menu = await repo.issueMenu(access);
  const session = (await repo.selectTask(access, "quotes", menu.id))!;
  await new ChannelDrafts(repo, "test-secret").save(session, {
    vehicle: { plate: "PRIVATECAR" },
    applicant: { firstName: "Private applicant" },
  });
  const now = new Date().toISOString();
  for (const contact of [access.contact, "573009999999"])
    await env.DB.prepare(
      "INSERT INTO whatsapp_channel_history(message_id,connection_id,contact,generation,employee_id,user_text,assistant_text,created_at) VALUES(?,?,?,?,?,?,?,?)",
    )
      .bind(
        `history-${s.tenantId}-${contact}`,
        s.connectionId,
        contact,
        access.generation,
        s.employeeId,
        "Private applicant",
        "PRIVATECAR",
        now,
      )
      .run();
  const pendingId = crypto.randomUUID();
  const actions = new WhatsappChannelActions(repo, "test-secret");
  await actions.prepare(
    {
      id: pendingId,
      session,
      revision: 1,
      domain: "insurance",
      command: "quote-auto",
      input: { private: "Private applicant" },
    },
    "Test quote",
    false,
  );
  const completedId = crypto.randomUUID();
  await actions.prepare(
    {
      id: completedId,
      session,
      revision: 1,
      domain: "insurance",
      command: "quote-auto",
      input: { private: "Executed quote data" },
    },
    "Test quote",
    false,
  );
  await env.DB.prepare(
    "UPDATE whatsapp_channel_actions SET status='completed',result_json=?,delivery_state='sent' WHERE id=?",
  )
    .bind(
      JSON.stringify({
        state: "completed",
        result: { reference: "COT-saved", pricedOffers: 1 },
      }),
      completedId,
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO whatsapp_channel_dispatches(action_id,product_id,created_at) VALUES(?,'test-product',?)",
  )
    .bind(completedId, now)
    .run();
  const complete = vi.fn<WhatsappInboundDependencies["generate"]>(
    async () => "Model response",
  );
  const routed = createRoutedWhatsappGenerator(repo, complete);
  let sequence = 0;
  const sent: string[] = [];
  const send: WhatsappInboundDependencies["send"] = async (_binding, text) => {
    sent.push(
      typeof text === "string"
        ? text
        : "text" in text
          ? text.text
          : "Native reply",
    );
    return `wamid.reset.${s.tenantId}.${sequence}`;
  };
  async function inbound(text: string) {
    const messageId = `reset-${s.tenantId}-${++sequence}`;
    await s.repository.receive({
      phoneNumberId: s.phoneNumberId,
      wabaId: s.wabaId,
      messageId,
      contactPhone: access.contact,
      text,
      timestamp: new Date().toISOString(),
    });
    expect(
      await processWhatsappInbox(s.repository, { ...routed, send }),
    ).toMatchObject({ processed: 1, failed: 0 });
    return { reply: sent.at(-1)!, messageId };
  }
  const state = () =>
    env.DB.prepare(
      "SELECT generation,draft_json,reset_token_hash FROM whatsapp_channel_contacts WHERE connection_id=? AND contact=?",
    )
      .bind(s.connectionId, access.contact)
      .first<{
        generation: string;
        draft_json: string | null;
        reset_token_hash: string | null;
      }>();
  const history = () =>
    env.DB.prepare(
      "SELECT contact,user_text FROM whatsapp_channel_history WHERE connection_id=?",
    )
      .bind(s.connectionId)
      .all<{ contact: string; user_text: string }>();
  return {
    ...s,
    repo,
    access,
    session,
    pendingId,
    completedId,
    complete,
    inbound,
    state,
    history,
    routed,
  };
}

it("requires explicit confirmation and clears scoped conversation data without deleting executed quotes", async () => {
  const s = await setup();
  const prompt = await s.inbound("Borrar mis datos y empezar de nuevo");
  expect(s.complete).not.toHaveBeenCalled();
  const command = prompt.reply.match(/BORRAR [A-Z2-7]{10}/)?.[0];
  expect(command).toBeTruthy();
  expect((await s.state())?.draft_json).toBeTruthy();
  expect((await s.state())?.generation).toBe(s.access.generation);
  await s.inbound("Sí");
  expect((await s.state())?.draft_json).toBeTruthy();
  const confirmed = await s.inbound(command!.toLowerCase());
  expect(confirmed.reply).toContain("borrados");
  const fresh = await s.state();
  expect(fresh?.generation).not.toBe(s.access.generation);
  expect(fresh?.draft_json).toBeNull();
  expect(fresh?.reset_token_hash).toBeNull();
  expect((await s.history()).results).toEqual([
    { contact: "573009999999", user_text: "Private applicant" },
  ]);
  expect(
    await env.DB.prepare(
      "SELECT status FROM whatsapp_channel_actions WHERE id=?",
    )
      .bind(s.completedId)
      .first("status"),
  ).toBe("completed");
  expect(
    await env.DB.prepare(
      "SELECT product_id FROM whatsapp_channel_dispatches WHERE action_id=?",
    )
      .bind(s.completedId)
      .first("product_id"),
  ).toBe("test-product");
  expect(
    await env.DB.prepare("SELECT id FROM whatsapp_channel_actions WHERE id=?")
      .bind(s.pendingId)
      .first(),
  ).toBeNull();
  const stored = await env.DB.prepare(
    "SELECT message_text,reply_text,input_payload,reply_payload,routing_snapshot FROM whatsapp_inbox WHERE connection_id=?",
  )
    .bind(s.connectionId)
    .all();
  expect(JSON.stringify(stored.results)).not.toContain(command!.slice(7));
  const binding = (await s.repository.resolve(s.phoneNumberId, s.wabaId))!;
  const replay = await s.routed.generate(binding, [], command!, {
    phoneNumberId: s.phoneNumberId,
    wabaId: s.wabaId,
    messageId: confirmed.messageId,
    contactPhone: s.access.contact,
    text: command!,
    timestamp: new Date().toISOString(),
  });
  expect(replay).toBe(confirmed.reply);
  expect((await s.state())?.generation).toBe(fresh?.generation);
  expect(
    await s.repository.getHistory({
      connectionId: s.connectionId,
      phoneNumberId: s.phoneNumberId,
      wabaId: s.wabaId,
      normalizedContact: s.access.contact,
      assignedEmployeeId: s.employeeId,
      assignedOwnerPrincipalId: s.principal.id,
    }),
  ).toEqual([]);
  await s.inbound("1");
  const context = s.complete.mock.calls.at(-1)?.[1];
  expect(JSON.stringify(context)).not.toContain("PRIVATECAR");
  expect(JSON.stringify(context)).not.toContain("Private applicant");
});

it("handles cancellation, expired codes and malformed confirmations without executing a reset", async () => {
  const s = await setup();
  let prompt = await s.inbound("Borrar mis datos y empezar de nuevo");
  let command = prompt.reply.match(/BORRAR [A-Z2-7]{10}/)![0];
  await s.inbound("CANCELAR BORRADO");
  await s.inbound(command);
  expect((await s.state())?.draft_json).toBeTruthy();
  prompt = await s.inbound("Borrar mis datos y empezar de nuevo");
  command = prompt.reply.match(/BORRAR [A-Z2-7]{10}/)![0];
  await env.DB.prepare(
    "UPDATE whatsapp_channel_contacts SET reset_expires_at=? WHERE connection_id=?",
  )
    .bind(new Date(Date.now() - 1000).toISOString(), s.connectionId)
    .run();
  expect((await s.inbound(command)).reply).toContain("vigente");
  await s.inbound("BORRAR incorrecto");
  expect(s.complete).not.toHaveBeenCalled();
  expect((await s.state())?.draft_json).toBeTruthy();
});

it("invalidates reset confirmation after five wrong attempts and after an access change", async () => {
  const s = await setup();
  const prompt = await s.inbound("Borrar mis datos y empezar de nuevo");
  const command = prompt.reply.match(/BORRAR [A-Z2-7]{10}/)![0];
  for (let i = 0; i < 5; i++) await s.inbound("BORRAR AAAAAAAAAA");
  expect((await s.state())?.reset_token_hash).toBeNull();
  await s.inbound(command);
  expect((await s.state())?.draft_json).toBeTruthy();
  await s.inbound("Borrar mis datos y empezar de nuevo");
  await env.DB.prepare(
    "UPDATE whatsapp_channel_contacts SET access_fingerprint=NULL WHERE connection_id=?",
  )
    .bind(s.connectionId)
    .run();
  await s.repo.getAccess(s.access);
  expect((await s.state())?.reset_token_hash).toBeNull();
});

it("refuses to clear data while a confirmed operation is queued", async () => {
  const s = await setup();
  const prompt = await s.inbound("Borrar mis datos y empezar de nuevo");
  const command = prompt.reply.match(/BORRAR [A-Z2-7]{10}/)![0];
  await env.DB.prepare(
    "UPDATE whatsapp_channel_actions SET status='queued' WHERE id=?",
  )
    .bind(s.pendingId)
    .run();
  expect((await s.inbound(command)).reply).toContain("procesamiento");
  expect((await s.state())?.generation).toBe(s.access.generation);
  expect((await s.state())?.draft_json).toBeTruthy();
});

it("scrubs old inbox data and repair text while preserving newer accepted messages", async () => {
  const s = await setup();
  const prompt = await s.inbound("Borrar mis datos y empezar de nuevo");
  const command = prompt.reply.match(/BORRAR [A-Z2-7]{10}/)![0];
  await env.DB.prepare(
    "UPDATE whatsapp_channel_actions SET delivery_state='history_pending',result_json=? WHERE id=?",
  )
    .bind(
      JSON.stringify({
        state: "completed",
        result: { reference: "COT-saved" },
        deliveryText: "Private applicant",
        deliveryAt: new Date().toISOString(),
      }),
      s.completedId,
    )
    .run();
  const confirmId = `confirm-${s.tenantId}`;
  const newerId = `newer-${s.tenantId}`;
  for (const [messageId, text] of [
    [confirmId, command],
    [newerId, "New vehicle"],
  ]) {
    await s.repository.receive({
      phoneNumberId: s.phoneNumberId,
      wabaId: s.wabaId,
      messageId,
      contactPhone: s.access.contact,
      text,
      timestamp: new Date().toISOString(),
    });
  }
  const acceptedAt = new Date().toISOString();
  // Same timestamp: the inbox's message ID tie-breaker orders the newer input last.
  await env.DB.prepare(
    "UPDATE whatsapp_inbox SET received_at=? WHERE message_id IN (?,?)",
  )
    .bind(acceptedAt, confirmId, newerId)
    .run();
  await env.DB.prepare(
    "UPDATE whatsapp_inbox SET message_text='Private applicant',reply_text='PRIVATECAR',input_payload=?,routing_snapshot=? WHERE message_id=?",
  )
    .bind(
      JSON.stringify({ text: "Private applicant" }),
      JSON.stringify({ text: "PRIVATECAR" }),
      prompt.messageId,
    )
    .run();
  const binding = (await s.repository.resolve(s.phoneNumberId, s.wabaId))!;
  const reply = await s.routed.generate(binding, [], command, {
    phoneNumberId: s.phoneNumberId,
    wabaId: s.wabaId,
    messageId: confirmId,
    contactPhone: s.access.contact,
    text: command,
    timestamp: acceptedAt,
  });
  expect(reply).toContain("borrados");
  const old = await env.DB.prepare(
    "SELECT message_text,reply_text,input_payload,routing_snapshot FROM whatsapp_inbox WHERE message_id=?",
  )
    .bind(prompt.messageId)
    .first();
  expect(old).toEqual({
    message_text: "[Conversation reset]",
    reply_text: null,
    input_payload: null,
    routing_snapshot: null,
  });
  expect(
    await env.DB.prepare(
      "SELECT message_text FROM whatsapp_inbox WHERE message_id=?",
    )
      .bind(newerId)
      .first("message_text"),
  ).toBe("New vehicle");
  const action = await env.DB.prepare(
    "SELECT delivery_state,result_json FROM whatsapp_channel_actions WHERE id=?",
  )
    .bind(s.completedId)
    .first<{ delivery_state: string; result_json: string }>();
  expect(action?.delivery_state).toBe("revoked");
  expect(JSON.parse(action!.result_json)).toEqual({
    state: "completed",
    result: { reference: "COT-saved" },
  });
  // These rows bypassed the inbox processor to inspect the exact reset boundary.
  await env.DB.prepare(
    "UPDATE whatsapp_inbox SET state='completed' WHERE message_id IN (?,?)",
  )
    .bind(confirmId, newerId)
    .run();
});

it("does not accept another contact's reset code", async () => {
  const s = await setup();
  const prompt = await s.inbound("Borrar mis datos y empezar de nuevo");
  const command = prompt.reply.match(/BORRAR [A-Z2-7]{10}/)![0];
  const other = await s.repo.getAccess({
    ...s.access,
    contact: "573009999999",
  });
  const rejected = await handleConversationReset(s.repo, other, {
    phoneNumberId: s.phoneNumberId,
    wabaId: s.wabaId,
    messageId: "cross-contact",
    contactPhone: other.contact,
    text: command,
    timestamp: new Date().toISOString(),
  });
  expect(rejected?.reply).toContain("vigente");
  expect((await s.state())?.generation).toBe(s.access.generation);
  expect((await s.state())?.draft_json).toBeTruthy();
});
