import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { setupChannelFixture } from "./whatsapp-channel-fixture";
import { nextWhatsappWake, recoverWhatsappScopes } from "../src/whatsapp/queue";

async function pendingMessage() {
  const fixture = await setupChannelFixture();
  const messageId = crypto.randomUUID();
  await fixture.repository.receive({
    messageId,
    phoneNumberId: fixture.phoneNumberId,
    wabaId: fixture.wabaId,
    contactPhone: "+57 300-123-4567",
    text: "hello",
    timestamp: String(Math.floor(Date.now() / 1000)),
  });
  return {
    ...fixture,
    messageId,
    scope: { connectionId: fixture.connectionId, contact: "573001234567" },
  };
}

it("sleeps when a conversation has no unfinished work and isolates other conversations", async () => {
  const first = await pendingMessage();
  const second = await setupChannelFixture();
  expect(
    await nextWhatsappWake(env.DB, {
      connectionId: second.connectionId,
      contact: "573001234567",
    }),
  ).toBeNull();
  expect(await nextWhatsappWake(env.DB, first.scope)).not.toBeNull();
  await env.DB.prepare(
    "UPDATE whatsapp_inbox SET state='completed' WHERE message_id=?",
  )
    .bind(first.messageId)
    .run();
  expect(await nextWhatsappWake(env.DB, first.scope)).toBeNull();
});

it("waits for the first message retry before waking for later messages", async () => {
  const first = await pendingMessage();
  const retryAt = new Date(Date.now() + 60_000).toISOString();
  await env.DB.prepare(
    "UPDATE whatsapp_inbox SET retry_at=?,received_at='2026-01-01T00:00:00.000Z' WHERE message_id=?",
  )
    .bind(retryAt, first.messageId)
    .run();
  await first.repository.receive({
    messageId: crypto.randomUUID(),
    phoneNumberId: first.phoneNumberId,
    wabaId: first.wabaId,
    contactPhone: first.scope.contact,
    text: "later",
    timestamp: String(Math.floor(Date.now() / 1000)),
  });
  expect(await nextWhatsappWake(env.DB, first.scope)).toBe(Date.parse(retryAt));
});

it("recovers an expired generation lease and deduplicates conversation wakeups", async () => {
  const first = await pendingMessage();
  const leaseUntil = new Date(Date.now() - 1000).toISOString();
  await env.DB.prepare(
    "UPDATE whatsapp_inbox SET state='generating',lease_until=? WHERE message_id=?",
  )
    .bind(leaseUntil, first.messageId)
    .run();
  expect(await nextWhatsappWake(env.DB, first.scope)).toBe(
    Date.parse(leaseUntil),
  );
  const scopes = await recoverWhatsappScopes(env.DB);
  expect(
    scopes.filter((scope) => scope.connectionId === first.connectionId),
  ).toEqual([first.scope]);
});

it("limits a scoped inbox batch to its conversation", async () => {
  const first = await pendingMessage();
  const second = await pendingMessage();
  expect(
    await first.repository.candidates(
      10,
      new Date().toISOString(),
      first.scope,
    ),
  ).toEqual([first.messageId]);
  expect(
    await second.repository.candidates(
      10,
      new Date().toISOString(),
      second.scope,
    ),
  ).toEqual([second.messageId]);
});

async function actionRow(
  scope: { connectionId: string; contact: string },
  tenantId: number,
  state: string,
  leaseUntil: string | null = null,
) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO whatsapp_channel_actions
    (id,connection_id,tenant_id,contact,generation,employee_id,selection_revision,action_json,token_hash,status,expires_at,created_at,queued_at,lease_until)
    VALUES(?,?,?,?,?,'test-employee',0,'{}','hash',?,?,?,?,?)`,
  )
    .bind(
      id,
      scope.connectionId,
      tenantId,
      scope.contact,
      "generation",
      state,
      new Date(Date.now() + 60_000).toISOString(),
      new Date().toISOString(),
      new Date().toISOString(),
      leaseUntil,
    )
    .run();
  return id;
}

it("recovers pending progress even after final action delivery and sleeps once it is sent", async () => {
  const fixture = await setupChannelFixture();
  const scope = { connectionId: fixture.connectionId, contact: "573001234567" };
  const actionId = await actionRow(scope, fixture.tenantId, "completed");
  await env.DB.prepare(
    "UPDATE whatsapp_channel_actions SET delivery_state='sent' WHERE id=?",
  )
    .bind(actionId)
    .run();
  const createdAt = new Date(Date.now() - 1000).toISOString();
  await env.DB.prepare(
    "INSERT INTO whatsapp_channel_action_progress(id,action_id,event_key,progress_text,status,created_at) VALUES(?,?,?,'Available offer','pending',?)",
  )
    .bind(crypto.randomUUID(), actionId, "product", createdAt)
    .run();
  expect(await nextWhatsappWake(env.DB, scope)).toBe(Date.parse(createdAt));
  expect(await recoverWhatsappScopes(env.DB)).toContainEqual(scope);
  await env.DB.prepare(
    "UPDATE whatsapp_channel_action_progress SET status='sent' WHERE action_id=?",
  )
    .bind(actionId)
    .run();
  expect(await nextWhatsappWake(env.DB, scope)).toBeNull();
});

it("honors progress retry backoff while the final result waits", async () => {
  const fixture = await setupChannelFixture();
  const scope = { connectionId: fixture.connectionId, contact: "573001234567" };
  const actionId = await actionRow(scope, fixture.tenantId, "completed");
  const retryAt = new Date(Date.now() + 30000).toISOString();
  await env.DB.prepare(
    "INSERT INTO whatsapp_channel_action_progress(id,action_id,event_key,progress_text,status,created_at,retry_at) VALUES(?,?,?,'Product price','pending',?,?)",
  )
    .bind(
      crypto.randomUUID(),
      actionId,
      "product",
      new Date().toISOString(),
      retryAt,
    )
    .run();
  expect(await nextWhatsappWake(env.DB, scope)).toBe(Date.parse(retryAt));
});

it("waits for a running action lease instead of repeatedly waking for a blocked action", async () => {
  const fixture = await setupChannelFixture();
  const scope = { connectionId: fixture.connectionId, contact: "573001234567" };
  const lease = new Date(Date.now() + 120_000).toISOString();
  await actionRow(scope, fixture.tenantId, "dispatching", lease);
  await actionRow(scope, fixture.tenantId, "queued");
  expect(await nextWhatsappWake(env.DB, scope)).toBe(Date.parse(lease));
});

it("schedules completed action delivery but ignores already delivered history", async () => {
  const fixture = await setupChannelFixture();
  const scope = { connectionId: fixture.connectionId, contact: "573001234567" };
  const id = await actionRow(scope, fixture.tenantId, "completed");
  expect(await nextWhatsappWake(env.DB, scope)).not.toBeNull();
  await env.DB.prepare(
    "UPDATE whatsapp_channel_actions SET delivery_state='sent' WHERE id=?",
  )
    .bind(id)
    .run();
  expect(await nextWhatsappWake(env.DB, scope)).toBeNull();
});

it("dispatches only its conversation and leaves other queued actions untouched", async () => {
  const { processChannelActions } = await import("../src/whatsapp/action-jobs");
  const { WhatsappChannelActions } =
    await import("../src/whatsapp/confirmations");
  const { WhatsappChannelRepository } =
    await import("../src/whatsapp/channel-repository");
  const first = await setupChannelFixture();
  const second = await setupChannelFixture();
  const scope = { connectionId: first.connectionId, contact: "573001234567" };
  const firstId = await actionRow(scope, first.tenantId, "queued");
  const secondId = await actionRow(
    { ...scope, connectionId: second.connectionId },
    second.tenantId,
    "queued",
  );
  await processChannelActions(
    new WhatsappChannelActions(
      new WhatsappChannelRepository(env.DB),
      "test-secret",
    ),
    async () => {
      throw new Error("Unsealed fixture must never execute");
    },
    1,
    undefined,
    scope,
  );
  expect(
    await env.DB.prepare(
      "SELECT status FROM whatsapp_channel_actions WHERE id=?",
    )
      .bind(firstId)
      .first("status"),
  ).toBe("uncertain");
  expect(
    await env.DB.prepare(
      "SELECT status FROM whatsapp_channel_actions WHERE id=?",
    )
      .bind(secondId)
      .first("status"),
  ).toBe("queued");
});

it("keeps interrupted result delivery recoverable until its lease is classified", async () => {
  const fixture = await setupChannelFixture();
  const scope = { connectionId: fixture.connectionId, contact: "573001234567" };
  const lease = new Date(Date.now() + 60_000).toISOString();
  const id = await actionRow(scope, fixture.tenantId, "completed", lease);
  await env.DB.prepare(
    "UPDATE whatsapp_channel_actions SET delivery_state='sending' WHERE id=?",
  )
    .bind(id)
    .run();
  expect(await nextWhatsappWake(env.DB, scope)).toBe(Date.parse(lease));
  expect(await recoverWhatsappScopes(env.DB)).toContainEqual(scope);
});
