import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import { setupChannelFixture } from "./whatsapp-channel-fixture";
import { WhatsappChannelRepository } from "../src/whatsapp/channel-repository";
import { WhatsappChannelActions } from "../src/whatsapp/confirmations";
import { deliverChannelActionResults } from "../src/whatsapp/action-results";
import { createRoutedWhatsappGenerator } from "../src/whatsapp/channel-runtime";
import type { ActionOutcome } from "../src/whatsapp/channel-contracts";
import type {
  WhatsappAssistantBinding,
  WhatsappInboundDependencies,
} from "../src/whatsapp/inbound-contracts";

async function setup(outcome: ActionOutcome, ageMs = 0) {
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
  const actionId = crypto.randomUUID();
  await new WhatsappChannelActions(repo, "test-secret").prepare(
    {
      id: actionId,
      session,
      revision: 1,
      domain: "insurance",
      command: "quote-auto",
      input: { private: "private-applicant-data" },
    },
    "Test quote",
    true,
  );
  await env.DB.prepare(
    "UPDATE whatsapp_channel_actions SET status=?,result_json=? WHERE id=?",
  )
    .bind(outcome.state, JSON.stringify(outcome), actionId)
    .run();
  await s.repository.receive({
    phoneNumberId: s.phoneNumberId,
    wabaId: s.wabaId,
    messageId: `inbound-${actionId}`,
    contactPhone: access.contact,
    text: "Confirmar",
    timestamp: new Date(Date.now() - ageMs).toISOString(),
  });
  const binding = (await s.repository.resolve(s.phoneNumberId, s.wabaId))!;
  const resolve = vi.fn(async () => binding);
  const send = vi.fn(
    async (_binding: WhatsappAssistantBinding, _text: string, _phone: string) =>
      `wamid.result.${actionId}`,
  );
  const deliver = () => deliverChannelActionResults(repo, resolve, send);
  const history = () =>
    env.DB.prepare(
      "SELECT * FROM whatsapp_channel_history WHERE connection_id=?",
    )
      .bind(s.connectionId)
      .all<{
        assistant_text: string;
        contact: string;
        generation: string;
        employee_id: string;
      }>();
  return {
    ...s,
    repo,
    session,
    actionId,
    binding,
    resolve,
    send,
    deliver,
    history,
  };
}

const partial: ActionOutcome = {
  state: "uncertain",
  message: "Una solicitud requiere revisión.",
  result: {
    reference: "COT-partial",
    pricedOffers: 1,
    uncertainOffers: 1,
    lowestPriceOffers: [{ product: "Verified product", premium: 1000000 }],
  },
};

it("delivers partial results once and supplies them to the next employee turn", async () => {
  const s = await setup(partial);
  await Promise.all([s.deliver(), s.deliver()]);
  await s.deliver();
  expect(s.send).toHaveBeenCalledTimes(1);
  const sentText = s.send.mock.calls[0]?.[1];
  expect(sentText).toContain("Verified product");
  const history = (await s.history()).results;
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({
    assistant_text: sentText,
    contact: s.session.access.contact,
    generation: s.session.access.generation,
    employee_id: s.employeeId,
  });
  expect(JSON.stringify(history)).not.toContain("private-applicant-data");
  const complete = vi.fn<WhatsappInboundDependencies["generate"]>(
    async () => "Estas son las ofertas recibidas.",
  );
  const routed = createRoutedWhatsappGenerator(s.repo, complete);
  const input = {
    phoneNumberId: s.phoneNumberId,
    wabaId: s.wabaId,
    messageId: `followup-${s.actionId}`,
    contactPhone: s.session.access.contact,
    text: "¿Qué resultado recibiste?",
    timestamp: new Date().toISOString(),
  };
  await s.repository.receive(input);
  await routed.generate(s.binding, [], input.text, input);
  expect(complete.mock.calls[0]?.[1]).toContainEqual({
    role: "assistant",
    content: sentText?.replace("Test employee · Asistente virtual\n\n", ""),
  });
});

it("does not add uncertain deliveries to history or retry their sends", async () => {
  const s = await setup(partial);
  s.send.mockRejectedValueOnce(new Error("Meta acknowledgement lost"));
  await s.deliver();
  await s.deliver();
  expect(s.send).toHaveBeenCalledTimes(1);
  expect((await s.history()).results).toHaveLength(0);
  expect(
    await env.DB.prepare(
      "SELECT delivery_state FROM whatsapp_channel_actions WHERE id=?",
    )
      .bind(s.actionId)
      .first("delivery_state"),
  ).toBe("uncertain");
});

it("recovers an acknowledged send's failed history write without sending again", async () => {
  const s = await setup(partial);
  const batch = vi.spyOn(env.DB, "batch");
  batch.mockRejectedValueOnce(new Error("Transient history write failure"));
  await s.deliver();
  batch.mockRestore();
  expect(s.send).toHaveBeenCalledTimes(1);
  expect((await s.history()).results).toHaveLength(0);
  expect(
    await env.DB.prepare(
      "SELECT delivery_state,outbound_message_id FROM whatsapp_channel_actions WHERE id=?",
    )
      .bind(s.actionId)
      .first(),
  ).toMatchObject({
    delivery_state: "history_pending",
    outbound_message_id: `wamid.result.${s.actionId}`,
  });
  // Persistence-only recovery does not need a fresh messaging window.
  await env.DB.prepare(
    "UPDATE whatsapp_inbox SET provider_timestamp=? WHERE connection_id=?",
  )
    .bind(
      new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      s.connectionId,
    )
    .run();
  await s.deliver();
  await s.deliver();
  expect(s.send).toHaveBeenCalledTimes(1);
  const history = (await s.history()).results;
  expect(history).toHaveLength(1);
  expect(history[0]?.assistant_text).toBe(s.send.mock.calls[0]?.[1]);
});

it("retries preparation failures that occurred before attempting a send", async () => {
  const s = await setup(partial);
  s.resolve
    .mockResolvedValueOnce(s.binding)
    .mockRejectedValueOnce(new Error("Temporary binding lookup failure"));
  await s.deliver();
  expect(s.send).not.toHaveBeenCalled();
  await s.deliver();
  expect(s.send).toHaveBeenCalledTimes(1);
  expect((await s.history()).results).toHaveLength(1);
});

it("does not release another processor's delivery claim after a pre-claim failure", async () => {
  const s = await setup(partial);
  s.resolve.mockImplementationOnce(async () => {
    // Another processor claimed this row after the initial pending scan.
    await env.DB.prepare(
      "UPDATE whatsapp_channel_actions SET delivery_state='sending' WHERE id=?",
    )
      .bind(s.actionId)
      .run();
    throw new Error("Binding lookup failed before claiming delivery");
  });
  await s.deliver();
  expect(s.send).not.toHaveBeenCalled();
  expect(
    await env.DB.prepare(
      "SELECT delivery_state FROM whatsapp_channel_actions WHERE id=?",
    )
      .bind(s.actionId)
      .first("delivery_state"),
  ).toBe("sending");
});

it("does not send or record results outside the reply window", async () => {
  const s = await setup(partial, 25 * 60 * 60 * 1000);
  await s.deliver();
  expect(s.send).not.toHaveBeenCalled();
  expect((await s.history()).results).toHaveLength(0);
});

it("does not send or record results after contact access is revoked", async () => {
  const s = await setup(partial);
  await s.repo.configure(
    s.tenantId,
    s.connectionId,
    {
      routingEnabled: true,
      tasks: [],
      staff: [],
      internalCapabilities: [],
      externalCapabilities: [],
    },
    s.principal.id,
  );
  await s.deliver();
  expect(s.send).not.toHaveBeenCalled();
  expect((await s.history()).results).toHaveLength(0);
});
