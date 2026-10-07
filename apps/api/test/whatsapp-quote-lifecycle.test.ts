import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { setupChannelFixture } from "./whatsapp-channel-fixture";
import { WhatsappChannelRepository } from "../src/whatsapp/channel-repository";
import { WhatsappChannelActions } from "../src/whatsapp/confirmations";

async function setup() {
  const fixture = await setupChannelFixture();
  const repository = new WhatsappChannelRepository(env.DB);
  await repository.configure(
    fixture.tenantId,
    fixture.connectionId,
    {
      routingEnabled: true,
      tasks: [
        {
          id: "quotes",
          employeeId: fixture.employeeId,
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
    fixture.principal.id,
  );
  const access = await repository.getAccess({
    tenantId: fixture.tenantId,
    connectionId: fixture.connectionId,
    contact: "573001234567",
  });
  const menu = await repository.issueMenu(access);
  const session = (await repository.selectTask(access, "quotes", menu.id))!;
  await env.DB.prepare(
    "UPDATE whatsapp_channel_contacts SET draft_json=?,buffered_text=?,reset_token_hash=?,reset_expires_at=?,reset_attempts=2,last_reset_message_id=? WHERE connection_id=? AND contact=?",
  )
    .bind(
      JSON.stringify({ private: "draft" }),
      "buffered user text",
      "token-hash",
      new Date(Date.now() + 60_000).toISOString(),
      "reset-message",
      fixture.connectionId,
      access.contact,
    )
    .run();
  const actions = new WhatsappChannelActions(repository, "test-secret");
  const terminalId = crypto.randomUUID();
  await actions.prepare(
    {
      id: terminalId,
      session,
      revision: 1,
      domain: "insurance",
      command: "quote-auto",
      input: { private: "executed quote" },
    },
    "Test quote",
    false,
  );
  await env.DB.prepare(
    "UPDATE whatsapp_channel_actions SET status='completed',result_json=?,delivery_state='sent',outbound_message_id=? WHERE id=?",
  )
    .bind(
      JSON.stringify({ state: "completed", result: { reference: "COT" } }),
      "wamid.ack",
      terminalId,
    )
    .run();
  const pendingId = crypto.randomUUID();
  await actions.prepare(
    {
      id: pendingId,
      session,
      revision: 1,
      domain: "insurance",
      command: "quote-auto",
      input: { private: "unexecuted" },
    },
    "Test quote",
    false,
  );
  const contactRow = () =>
    env.DB.prepare(
      "SELECT generation,employee_id,selection_revision,draft_json,buffered_text,menu_json,reset_token_hash,reset_expires_at,reset_attempts,last_reset_message_id FROM whatsapp_channel_contacts WHERE connection_id=? AND contact=?",
    )
      .bind(fixture.connectionId, access.contact)
      .first<Record<string, unknown>>();
  return {
    fixture,
    repository,
    access,
    session,
    terminalId,
    pendingId,
    contactRow,
  };
}

it("resets only the acknowledged quote generation while preserving audit records", async () => {
  const s = await setup();
  const before = await s.contactRow();
  const prepared = await s.repository.prepareQuoteLifecycleReset(
    s.access,
    s.session.selectionRevision,
    s.session.employeeId,
  );
  expect(prepared).toBeTruthy();
  expect(prepared?.menu.tasks).toHaveLength(1);
  await env.DB.prepare(
    "INSERT INTO whatsapp_channel_history(message_id,connection_id,contact,generation,employee_id,user_text,assistant_text,created_at) VALUES(?,?,?,?,?,?,?,?)",
  )
    .bind(
      `action-result:${s.terminalId}`,
      s.access.connectionId,
      s.access.contact,
      s.access.generation,
      s.session.employeeId,
      "[Result of confirmed action]",
      "quote result and menu",
      new Date().toISOString(),
    )
    .run();

  const result = await env.DB.batch(
    s.repository.quoteLifecycleResetStatements(
      s.access,
      s.session.selectionRevision,
      s.session.employeeId,
      prepared!,
      {
        kind: "action-result",
        actionId: s.terminalId,
        outboundMessageId: "wamid.ack",
      },
    ),
  );
  expect(result[0]?.meta.changes).toBe(1);
  const after = await s.contactRow();
  expect(after).toMatchObject({
    generation: prepared?.generation,
    employee_id: null,
    selection_revision: Number(before?.selection_revision) + 1,
    draft_json: null,
    buffered_text: null,
    reset_token_hash: null,
    reset_expires_at: null,
    reset_attempts: 0,
    last_reset_message_id: null,
  });
  expect(JSON.parse(String(after?.menu_json))).toEqual(prepared?.menu);
  expect(
    await env.DB.prepare(
      "SELECT status,delivery_state FROM whatsapp_channel_actions WHERE id=?",
    )
      .bind(s.terminalId)
      .first(),
  ).toEqual({ status: "completed", delivery_state: "sent" });
  expect(
    await env.DB.prepare(
      "SELECT status FROM whatsapp_channel_actions WHERE id=?",
    )
      .bind(s.pendingId)
      .first("status"),
  ).toBe("cancelled");
  expect(
    await env.DB.prepare(
      "SELECT generation FROM whatsapp_channel_history WHERE message_id=?",
    )
      .bind(`action-result:${s.terminalId}`)
      .first("generation"),
  ).toBe(s.access.generation);
});

it("does not reset for a mismatched acknowledgement, stale selection, or live queued work", async () => {
  const s = await setup();
  const prepared = await s.repository.prepareQuoteLifecycleReset(
    s.access,
    s.session.selectionRevision,
    s.session.employeeId,
  );
  expect(prepared).toBeTruthy();
  const result = await env.DB.batch(
    s.repository.quoteLifecycleResetStatements(
      s.access,
      s.session.selectionRevision,
      s.session.employeeId,
      prepared!,
      {
        kind: "action-result",
        actionId: s.terminalId,
        outboundMessageId: "wamid.wrong",
      },
    ),
  );
  expect(result[0]?.meta.changes).toBe(0);
  expect((await s.contactRow())?.generation).toBe(s.access.generation);

  await env.DB.prepare(
    "UPDATE whatsapp_channel_contacts SET selection_revision=selection_revision+1 WHERE connection_id=? AND contact=?",
  )
    .bind(s.fixture.connectionId, s.access.contact)
    .run();
  expect(
    await s.repository.prepareQuoteLifecycleReset(
      s.access,
      s.session.selectionRevision,
      s.session.employeeId,
    ),
  ).toBeNull();

  const current = await s.repository.getAccess({
    tenantId: s.fixture.tenantId,
    connectionId: s.fixture.connectionId,
    contact: s.access.contact,
  });
  const currentMenu = await s.repository.issueMenu(current);
  const currentSession = (await s.repository.selectTask(
    current,
    "quotes",
    currentMenu.id,
  ))!;
  await env.DB.prepare(
    "UPDATE whatsapp_channel_actions SET status='queued' WHERE id=?",
  )
    .bind(s.pendingId)
    .run();
  expect(
    await s.repository.prepareQuoteLifecycleReset(
      current,
      currentSession.selectionRevision,
      currentSession.employeeId,
    ),
  ).toBeNull();
});

it("accepts a completed inbound reply as the reset acknowledgement", async () => {
  const s = await setup();
  const messageId = `quote-failure-${s.fixture.tenantId}`;
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO whatsapp_inbox
     (message_id,phone_number_id,waba_id,contact_phone,normalized_contact,message_text,
      provider_timestamp,tenant_id,connection_id,state,outbound_message_id,received_at,completed_at)
     VALUES(?,?,?,?,?,?, ?,?,?,'completed',?,?,?)`,
  )
    .bind(
      messageId,
      s.fixture.phoneNumberId,
      s.fixture.wabaId,
      s.access.contact,
      s.access.contact,
      "La cotización no pudo completarse",
      now,
      s.fixture.tenantId,
      s.fixture.connectionId,
      `wamid.inbound-reply.${s.fixture.tenantId}`,
      now,
      now,
    )
    .run();
  const prepared = await s.repository.prepareQuoteLifecycleReset(
    s.access,
    s.session.selectionRevision,
    s.session.employeeId,
  );
  expect(prepared).toBeTruthy();
  const result = await env.DB.batch(
    s.repository.quoteLifecycleResetStatements(
      s.access,
      s.session.selectionRevision,
      s.session.employeeId,
      prepared!,
      { kind: "inbound-reply", messageId },
    ),
  );
  expect(result[0]?.meta.changes).toBe(1);
  expect((await s.contactRow())?.generation).toBe(prepared?.generation);
});
