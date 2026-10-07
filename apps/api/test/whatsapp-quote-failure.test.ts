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
  const logs: string[] = [];
  const logSpy = vi
    .spyOn(console, "info")
    .mockImplementation((entry) => logs.push(String(entry)));
  const send = vi.fn(async (_binding, reply) => {
    expect(reply).toContain("Consultar seguros");
    expect(await s.contact()).toMatchObject({
      generation: s.access.generation,
      draft_json: "private draft",
    });
    return "wamid.quote-failure";
  });
  await processWhatsappInbox(s.repository, { ...s.routed, send });
  logSpy.mockRestore();
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
  const events = logs.map(
    (entry) => JSON.parse(entry) as Record<string, unknown>,
  );
  const applied = events.find(
    (event) =>
      event.event === "whatsapp_quote_lifecycle_reset" &&
      event.stage === "after_reply" &&
      event.outcome === "applied",
  );
  expect(applied).toMatchObject({
    message_id: s.input.messageId,
    generation: s.access.generation,
    reset_applied: true,
  });
  expect(applied?.selection_revision).toEqual(expect.any(Number));
  expect(applied?.duration_ms).toEqual(expect.any(Number));
  expect(Number(applied?.duration_ms)).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(events)).not.toContain(s.access.contact);
  expect(JSON.stringify(events)).not.toContain("private draft");
});

it("logs a skipped lifecycle reset when the source selection changed before acknowledgement persistence", async () => {
  const s = await setup();
  const logs: string[] = [];
  const logSpy = vi
    .spyOn(console, "info")
    .mockImplementation((entry) => logs.push(String(entry)));
  await processWhatsappInbox(s.repository, {
    ...s.routed,
    send: async () => {
      await env.DB.prepare(
        "UPDATE whatsapp_channel_contacts SET selection_revision=selection_revision+1 WHERE connection_id=? AND contact=?",
      )
        .bind(s.connectionId, s.access.contact)
        .run();
      return "wamid.quote-failure-stale-selection";
    },
  });
  logSpy.mockRestore();

  expect(await s.contact()).toMatchObject({
    generation: s.access.generation,
    employee_id: s.employeeId,
    draft_json: "private draft",
  });
  const event = logs
    .map((entry) => JSON.parse(entry) as Record<string, unknown>)
    .find(
      (entry) =>
        entry.event === "whatsapp_quote_lifecycle_reset" &&
        entry.stage === "after_reply",
    );
  expect(event).toMatchObject({
    message_id: s.input.messageId,
    outcome: "skipped",
    reset_applied: false,
  });
  expect(event?.duration_ms).toEqual(expect.any(Number));
  expect(Number(event?.duration_ms)).toBeGreaterThanOrEqual(0);
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
