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

it("starts a fresh quote cycle from an explicit new-quote request without calling the model", async () => {
  const s = await setup();
  await env.DB.prepare(
    "UPDATE assistant_virtual_employees SET allowed_collections=? WHERE id=?",
  )
    .bind('["cotizaciones","cotizaciones_detalle"]', s.employeeId)
    .run();
  await env.DB.prepare(
    "UPDATE whatsapp_inbox SET state='failed',failure_code='superseded' WHERE message_id=?",
  )
    .bind(s.input.messageId)
    .run();
  const input = {
    ...s.input,
    messageId: crypto.randomUUID(),
    text: "Hagamos una nueva cotización",
  };
  await s.repository.receive(input);
  const complete = vi.fn(async () => "model should not run");
  const routed = createRoutedWhatsappGenerator(s.repo, complete);
  const send = vi.fn(async (_binding, reply) => {
    expect(reply).toContain("Consultar seguros");
    expect(await s.contact()).toMatchObject({
      generation: s.access.generation,
      draft_json: "private draft",
    });
    return "wamid.explicit-new-quote";
  });
  const binding = (await s.repository.resolve(s.phoneNumberId, s.wabaId))!;
  const firstReply = await routed.generate(binding, [], input.text, input);
  const retryReply = await routed.generate(binding, [], input.text, input);
  expect(retryReply).toEqual(firstReply);
  expect(complete).not.toHaveBeenCalled();

  expect(
    await processWhatsappInbox(s.repository, { ...routed, send }),
  ).toMatchObject({ processed: 1, failed: 0 });

  expect(complete).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledOnce();
  expect(await s.contact()).toMatchObject({
    employee_id: null,
    draft_json: null,
  });
  expect((await s.contact())?.generation).not.toBe(s.access.generation);
});

it("does not claim a new quote cycle when a confirmed action is still queued", async () => {
  const s = await setup();
  await env.DB.prepare(
    "UPDATE assistant_virtual_employees SET allowed_collections=? WHERE id=?",
  )
    .bind('["cotizaciones","cotizaciones_detalle"]', s.employeeId)
    .run();
  await env.DB.prepare(
    "UPDATE whatsapp_inbox SET state='failed',failure_code='superseded' WHERE message_id=?",
  )
    .bind(s.input.messageId)
    .run();
  const input = {
    ...s.input,
    messageId: crypto.randomUUID(),
    text: "Hagamos una nueva cotización",
  };
  await s.repository.receive(input);
  const session = (await s.repo.getSession(s.access))!;
  await env.DB.prepare(
    `INSERT INTO whatsapp_channel_actions
      (id,connection_id,tenant_id,contact,generation,employee_id,selection_revision,
       action_json,token_hash,status,expires_at,created_at)
     VALUES(?,?,?,?,?,?,?,'{}','queued','queued',?,?)`,
  )
    .bind(
      crypto.randomUUID(),
      s.connectionId,
      s.tenantId,
      s.access.contact,
      s.access.generation,
      s.employeeId,
      session.selectionRevision,
      new Date(Date.now() + 60_000).toISOString(),
      new Date().toISOString(),
    )
    .run();
  await env.DB.prepare(
    `INSERT INTO whatsapp_channel_actions
      (id,connection_id,tenant_id,contact,generation,employee_id,selection_revision,
       action_json,token_hash,status,expires_at,created_at,result_json,delivery_state)
     VALUES(?,?,?,?,?,?,?,'{}','undelivered','completed',?,?, '{}','history_pending')`,
  )
    .bind(
      crypto.randomUUID(),
      s.connectionId,
      s.tenantId,
      s.access.contact,
      s.access.generation,
      s.employeeId,
      session.selectionRevision,
      new Date(Date.now() + 60_000).toISOString(),
      new Date().toISOString(),
    )
    .run();
  const complete = vi.fn(async () => "model should not run");
  const routed = createRoutedWhatsappGenerator(s.repo, complete);
  const send = vi.fn(async (_binding, reply) => {
    expect(reply).not.toContain("Consultar seguros");
    expect(reply).toMatch(/proces|espera|menú/i);
    return "wamid.new-quote-busy";
  });

  expect(
    await processWhatsappInbox(s.repository, { ...routed, send }),
  ).toMatchObject({ processed: 1 });

  expect(complete).not.toHaveBeenCalled();
  expect(await s.contact()).toMatchObject({
    generation: s.access.generation,
    employee_id: s.employeeId,
    draft_json: "private draft",
  });
});

it("does not reset when the selected employee cannot create insurance quotes", async () => {
  const s = await setup();
  await env.DB.prepare(
    "UPDATE whatsapp_inbox SET state='failed',failure_code='superseded' WHERE message_id=?",
  )
    .bind(s.input.messageId)
    .run();
  const input = {
    ...s.input,
    messageId: crypto.randomUUID(),
    text: "Hagamos una nueva",
  };
  await s.repository.receive(input);
  const complete = vi.fn(async () => "Normal assistant response");
  const routed = createRoutedWhatsappGenerator(s.repo, complete);

  const reply = await routed.generate(
    (await s.repository.resolve(s.phoneNumberId, s.wabaId))!,
    [],
    input.text,
    input,
  );

  expect(reply).toContain("Normal assistant response");
  expect(complete).toHaveBeenCalledOnce();
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

it("commits the reset with inbox completion even when post-reply history fails", async () => {
  const s = await setup();
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(
      await processWhatsappInbox(s.repository, {
        ...s.routed,
        afterReply: async () => {
          throw new Error("history unavailable");
        },
        send: async () => "wamid.atomic-reset",
      }),
    ).toMatchObject({ processed: 1 });
    expect(await s.contact()).toMatchObject({
      employee_id: null,
      draft_json: null,
    });
  } finally {
    error.mockRestore();
  }
});

it("rolls back inbox completion and the reset together when persistence fails", async () => {
  const s = await setup();
  const binding = (await s.repository.resolve(s.phoneNumberId, s.wabaId))!;
  await s.routed.generate(binding, [], s.input.text, s.input);
  await env.DB.prepare(
    "UPDATE whatsapp_inbox SET state='responding',lease_token='atomic-token' WHERE message_id=?",
  )
    .bind(s.input.messageId)
    .run();
  const statements = await s.routed.completionStatements(binding, s.input);
  expect(statements).toHaveLength(2);
  await expect(
    s.repository.complete(s.input.messageId, "atomic-token", "wamid.rollback", [
      ...statements,
      env.DB.prepare("INSERT INTO missing_atomic_test_table VALUES(1)"),
    ]),
  ).rejects.toThrow();
  expect(await s.contact()).toMatchObject({
    generation: s.access.generation,
    employee_id: s.employeeId,
    draft_json: "private draft",
  });
  expect(
    await env.DB.prepare(
      "SELECT state,outbound_message_id FROM whatsapp_inbox WHERE message_id=?",
    )
      .bind(s.input.messageId)
      .first(),
  ).toMatchObject({ state: "responding", outbound_message_id: null });
});

it("does not dispatch when atomic completion preparation fails", async () => {
  const s = await setup();
  const send = vi.fn().mockResolvedValue("must-not-send");
  expect(
    await processWhatsappInbox(s.repository, {
      ...s.routed,
      completionStatements: async () => {
        throw new Error("snapshot unavailable");
      },
      send,
    }),
  ).toMatchObject({ processed: 0, failed: 1 });
  expect(send).not.toHaveBeenCalled();
  expect(await s.contact()).toMatchObject({
    generation: s.access.generation,
    draft_json: "private draft",
  });
  expect(
    await env.DB.prepare("SELECT state FROM whatsapp_inbox WHERE message_id=?")
      .bind(s.input.messageId)
      .first(),
  ).toMatchObject({ state: "pending" });
});
