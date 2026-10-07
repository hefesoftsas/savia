import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import { setupChannelFixture } from "./whatsapp-channel-fixture";
import { WhatsappChannelRepository } from "../src/whatsapp/channel-repository";
import {
  createRoutedWhatsappGenerator,
  prepareFailedQuoteReply,
} from "../src/whatsapp/channel-runtime";
import { processWhatsappInbox } from "../src/whatsapp/inbound-processor";

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
  await repo.selectTask(access, "quotes", menu.id);
  await env.DB.prepare(
    "UPDATE whatsapp_channel_contacts SET draft_json=? WHERE connection_id=? AND contact=?",
  )
    .bind("private draft", s.connectionId, access.contact)
    .run();
  const input = {
    messageId: crypto.randomUUID(),
    phoneNumberId: s.phoneNumberId,
    wabaId: s.wabaId,
    contactPhone: access.contact,
    text: "Una nueva",
    timestamp: new Date().toISOString(),
  };
  await s.repository.receive(input);
  const generate = vi.fn((binding, _history, _text, inbound) =>
    prepareFailedQuoteReply(repo, binding, inbound!),
  );
  const routed = createRoutedWhatsappGenerator(repo, generate);
  const contact = () =>
    env.DB.prepare(
      "SELECT generation,employee_id,draft_json FROM whatsapp_channel_contacts WHERE connection_id=? AND contact=?",
    )
      .bind(s.connectionId, access.contact)
      .first();
  return { ...s, repo, access, input, routed, generate, contact };
}

it("closes fatal quote preparation only after delivery and starts the next task without prior context", async () => {
  const s = await setup();
  const send = vi.fn(async (_binding, reply) => {
    expect(reply).toContain("Consultar seguros");
    expect(await s.contact()).toMatchObject({
      generation: s.access.generation,
      draft_json: "private draft",
    });
    return "wamid.quote-failure";
  });
  await processWhatsappInbox(s.repository, { ...s.routed, send });
  expect(send).toHaveBeenCalledOnce();
  expect(await s.contact()).toMatchObject({
    employee_id: null,
    draft_json: null,
  });
  expect((await s.contact())?.generation).not.toBe(s.access.generation);
  await s.repository.receive({
    ...s.input,
    messageId: crypto.randomUUID(),
    text: "1",
  });
  const next = vi.fn().mockResolvedValue("Start fresh");
  const routed = createRoutedWhatsappGenerator(s.repo, next);
  await processWhatsappInbox(s.repository, {
    ...routed,
    send: async () => "wamid.fresh",
  });
  expect(next).toHaveBeenCalledOnce();
  expect(next.mock.calls[0][1]).toEqual([]);
});

it("keeps the draft when the failure menu has no acknowledged delivery", async () => {
  const s = await setup();
  await processWhatsappInbox(s.repository, {
    ...s.routed,
    send: async () => {
      throw new Error("transport uncertain");
    },
  });
  expect(await s.contact()).toMatchObject({
    generation: s.access.generation,
    employee_id: s.employeeId,
    draft_json: "private draft",
  });
});

it("returns to the menu when model retries are exhausted", async () => {
  const s = await setup();
  await env.DB.prepare(
    "UPDATE whatsapp_inbox SET generation_attempts=2 WHERE message_id=?",
  )
    .bind(s.input.messageId)
    .run();
  const routed = createRoutedWhatsappGenerator(s.repo, async () => {
    throw new Error("model timeout");
  });
  const send = vi.fn().mockResolvedValue("wamid.recovery");
  expect(
    await processWhatsappInbox(s.repository, { ...routed, send }),
  ).toMatchObject({ processed: 1 });
  expect(send.mock.calls[0][1]).toContain("Consultar seguros");
  expect(await s.contact()).toMatchObject({
    employee_id: null,
    draft_json: null,
  });
});
