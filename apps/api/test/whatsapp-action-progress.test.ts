import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import type { ChannelAction } from "../src/whatsapp/channel-contracts";
import { WhatsappChannelRepository } from "../src/whatsapp/channel-repository";
import {
  deliverChannelActionProgress,
  enqueueChannelActionProgress,
} from "../src/whatsapp/action-progress";
import { defaultNativeConfiguration } from "../src/whatsapp/native";
import { setupChannelFixture } from "./whatsapp-channel-fixture";

async function actionFixture() {
  const fixture = await setupChannelFixture();
  const repository = new WhatsappChannelRepository(env.DB);
  await env.DB.prepare(
    "UPDATE assistant_virtual_employees SET name='Progress assistant' WHERE id=?",
  )
    .bind(fixture.employeeId)
    .run();
  await fixture.repository.configure({
    ...fixture.settings,
    native: { ...defaultNativeConfiguration },
  });
  await repository.configure(
    fixture.tenantId,
    fixture.connectionId,
    {
      routingEnabled: true,
      tasks: [
        {
          id: "support",
          employeeId: fixture.employeeId,
          title: "Support",
          description: "",
          order: 0,
          audiences: ["external"],
        },
      ],
      staff: [],
      internalCapabilities: [],
      externalCapabilities: [],
    },
    fixture.principal.id,
  );
  const access = await repository.getAccess({
    tenantId: fixture.tenantId,
    connectionId: fixture.connectionId,
    contact: "573001234567",
  });
  const menu = await repository.issueMenu(access);
  const session = (await repository.selectTask(access, "support", menu.id))!;
  await fixture.repository.receive({
    messageId: crypto.randomUUID(),
    phoneNumberId: fixture.phoneNumberId,
    wabaId: fixture.wabaId,
    contactPhone: "+57 300-123-4567",
    text: "Hola",
    timestamp: String(Math.floor(Date.now() / 1000)),
  });
  const action: ChannelAction = {
    id: crypto.randomUUID(),
    session,
    revision: 1,
    domain: "studio",
    command: "create-record",
    input: {},
  };
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO whatsapp_channel_actions
      (id,connection_id,tenant_id,contact,generation,employee_id,selection_revision,
       action_json,token_hash,status,expires_at,created_at,queued_at)
     VALUES(?,?,?,?,?,?,?,'{}','hash','dispatching',?,?,?)`,
  )
    .bind(
      action.id,
      fixture.connectionId,
      fixture.tenantId,
      session.access.contact,
      session.access.generation,
      session.employeeId,
      session.selectionRevision,
      new Date(Date.now() + 60_000).toISOString(),
      now,
      now,
    )
    .run();
  const binding = (await fixture.repository.resolve(
    fixture.phoneNumberId,
    fixture.wabaId,
  ))!;
  const resolve = async () => binding;
  return { fixture, repository, session, action, binding, resolve };
}

it("deduplicates progress events and sends pending updates together within WhatsApp's limit", async () => {
  const { repository, action, resolve } = await actionFixture();
  await enqueueChannelActionProgress(
    repository,
    action,
    "lookup",
    "Buscando vehículo.",
  );
  await enqueueChannelActionProgress(
    repository,
    action,
    "lookup",
    "Duplicado que no debe reemplazar el original.",
  );
  await enqueueChannelActionProgress(
    repository,
    action,
    "quote",
    "Consultando aseguradoras.",
  );
  let sent = "";
  const result = await deliverChannelActionProgress(
    repository,
    resolve,
    async (_binding, text) => {
      sent = text;
      return "outbound-progress-1";
    },
  );

  expect(result).toEqual({ delivered: 1 });
  expect(sent).toContain("Buscando vehículo.");
  expect(sent).toContain("Consultando aseguradoras.");
  expect(sent).not.toContain("Duplicado");
  expect(sent.length).toBeLessThanOrEqual(4096);
  expect(
    await env.DB.prepare(
      "SELECT status FROM whatsapp_channel_action_progress WHERE action_id=? ORDER BY event_key",
    )
      .bind(action.id)
      .all<{ status: string }>(),
  ).toMatchObject({ results: [{ status: "sent" }, { status: "sent" }] });
});

it("leaves later events pending when the next event would exceed 4096 characters", async () => {
  const { repository, action, resolve } = await actionFixture();
  await enqueueChannelActionProgress(repository, action, "a", "x".repeat(4096));
  await enqueueChannelActionProgress(repository, action, "b", "tail update");
  const sent: string[] = [];
  const send = async (_binding: any, text: string) => {
    sent.push(text);
    return `outbound-${sent.length}`;
  };

  await deliverChannelActionProgress(repository, resolve, send);
  await deliverChannelActionProgress(repository, resolve, send);

  expect(sent).toEqual(["x".repeat(4096), "tail update"]);
});

it("releases a claim when binding resolution fails before send, but never retries an ambiguous send", async () => {
  const { repository, action, resolve } = await actionFixture();
  await enqueueChannelActionProgress(repository, action, "event", "Working.");
  await expect(
    deliverChannelActionProgress(
      repository,
      async () => {
        throw new Error("temporary resolve failure");
      },
      async () => "unused",
    ),
  ).resolves.toEqual({ delivered: 0 });
  expect(
    await env.DB.prepare(
      "SELECT status FROM whatsapp_channel_action_progress WHERE action_id=?",
    )
      .bind(action.id)
      .first("status"),
  ).toBe("pending");

  await env.DB.prepare(
    "UPDATE whatsapp_channel_action_progress SET retry_at=? WHERE action_id=?",
  )
    .bind(new Date(Date.now() - 1000).toISOString(), action.id)
    .run();
  let resolveSend!: (id: string) => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolveStarted) => {
    markStarted = resolveStarted;
  });
  const send = vi.fn(
    () =>
      new Promise<string>((resolveSendPromise) => {
        resolveSend = resolveSendPromise;
        markStarted();
      }),
  );
  vi.useFakeTimers();
  const operation = deliverChannelActionProgress(repository, resolve, send);
  await started;
  await vi.advanceTimersByTimeAsync(15_001);
  await expect(operation).resolves.toEqual({ delivered: 0 });
  vi.useRealTimers();
  resolveSend("late-ack");
  await Promise.resolve();
  expect(send).toHaveBeenCalledTimes(1);
  expect(
    await env.DB.prepare(
      "SELECT status FROM whatsapp_channel_action_progress WHERE action_id=?",
    )
      .bind(action.id)
      .first("status"),
  ).toBe("uncertain");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(
    await env.DB.prepare(
      "SELECT status FROM whatsapp_channel_action_progress WHERE action_id=?",
    )
      .bind(action.id)
      .first("status"),
  ).toBe("uncertain");
  await deliverChannelActionProgress(repository, resolve, send);
  expect(send).toHaveBeenCalledTimes(1);
});

it("repairs history after an acknowledged send without resending progress", async () => {
  const { fixture, repository, action, resolve } = await actionFixture();
  await enqueueChannelActionProgress(
    repository,
    action,
    "event",
    "One update.",
  );
  await env.DB.exec(
    "CREATE TRIGGER fail_progress_history BEFORE INSERT ON whatsapp_channel_history BEGIN SELECT RAISE(FAIL,'injected history failure'); END",
  );
  const send = vi.fn(async () => "progress-ack");
  await expect(
    deliverChannelActionProgress(repository, resolve, send),
  ).resolves.toEqual({ delivered: 0 });
  expect(send).toHaveBeenCalledTimes(1);
  expect(
    await env.DB.prepare(
      "SELECT status FROM whatsapp_channel_action_progress WHERE action_id=?",
    )
      .bind(action.id)
      .first("status"),
  ).toBe("history_pending");
  await env.DB.exec("DROP TRIGGER fail_progress_history");
  await env.DB.prepare(
    "UPDATE whatsapp_channel_action_progress SET retry_at=? WHERE action_id=?",
  )
    .bind(new Date(Date.now() - 1000).toISOString(), action.id)
    .run();

  await expect(
    deliverChannelActionProgress(repository, resolve, send),
  ).resolves.toEqual({ delivered: 1 });
  expect(send).toHaveBeenCalledTimes(1);
  expect(
    await env.DB.prepare(
      "SELECT assistant_text FROM whatsapp_channel_history WHERE message_id LIKE 'action-progress:%' AND connection_id=? AND contact=?",
    )
      .bind(fixture.connectionId, action.session.access.contact)
      .first("assistant_text"),
  ).toBe("One update.");
});

it("does not enqueue a late callback after final delivery is claimed", async () => {
  const { repository, action } = await actionFixture();
  await env.DB.prepare(
    "UPDATE whatsapp_channel_actions SET delivery_state='sending' WHERE id=?",
  )
    .bind(action.id)
    .run();

  await enqueueChannelActionProgress(repository, action, "late", "Too late.");

  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM whatsapp_channel_action_progress WHERE action_id=?",
    )
      .bind(action.id)
      .first("count"),
  ).toBe(0);
});

it("delivers queued progress for a completed action before its final result", async () => {
  const { repository, action, resolve } = await actionFixture();
  await env.DB.prepare(
    "UPDATE whatsapp_channel_actions SET status='completed' WHERE id=?",
  )
    .bind(action.id)
    .run();
  await enqueueChannelActionProgress(
    repository,
    action,
    "event",
    "Last progress.",
  );
  const send = vi.fn(async () => "progress-before-result");

  await expect(
    deliverChannelActionProgress(repository, resolve, send),
  ).resolves.toEqual({ delivered: 1 });

  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][1]).toBe("Last progress.");
});

it("rechecks the final-delivery claim immediately before sending progress", async () => {
  const { repository, action, binding } = await actionFixture();
  await enqueueChannelActionProgress(repository, action, "event", "Working.");
  let resolveBinding!: (value: typeof binding) => void;
  let markResolveStarted!: () => void;
  const resolveStarted = new Promise<void>((resolveStartedPromise) => {
    markResolveStarted = resolveStartedPromise;
  });
  const resolve = () =>
    new Promise<typeof binding>((resolvePromise) => {
      resolveBinding = resolvePromise;
      markResolveStarted();
    });
  const send = vi.fn(async () => "should-not-send");
  const operation = deliverChannelActionProgress(repository, resolve, send);
  await resolveStarted;
  await env.DB.prepare(
    "UPDATE whatsapp_channel_actions SET delivery_state='sending' WHERE id=?",
  )
    .bind(action.id)
    .run();
  resolveBinding(binding);

  await expect(operation).resolves.toEqual({ delivered: 0 });
  expect(send).not.toHaveBeenCalled();
  expect(
    await env.DB.prepare(
      "SELECT status FROM whatsapp_channel_action_progress WHERE action_id=?",
    )
      .bind(action.id)
      .first("status"),
  ).toBe("revoked");
});

it("revokes pending progress after the contact generation changes", async () => {
  const { fixture, repository, action, resolve } = await actionFixture();
  await enqueueChannelActionProgress(repository, action, "event", "Working.");
  await env.DB.prepare(
    "UPDATE whatsapp_channel_contacts SET generation=? WHERE connection_id=? AND contact=?",
  )
    .bind(
      crypto.randomUUID(),
      fixture.connectionId,
      action.session.access.contact,
    )
    .run();
  const send = vi.fn(async () => "unexpected");

  await expect(
    deliverChannelActionProgress(repository, resolve, send),
  ).resolves.toEqual({ delivered: 0 });

  expect(send).not.toHaveBeenCalled();
  expect(
    await env.DB.prepare(
      "SELECT status FROM whatsapp_channel_action_progress WHERE action_id=?",
    )
      .bind(action.id)
      .first("status"),
  ).toBe("revoked");
});

it("expires progress when the WhatsApp reply window has closed", async () => {
  const { fixture, repository, action, resolve } = await actionFixture();
  await enqueueChannelActionProgress(repository, action, "event", "Working.");
  await env.DB.prepare(
    "UPDATE whatsapp_inbox SET provider_timestamp=? WHERE connection_id=? AND normalized_contact=?",
  )
    .bind(
      new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      fixture.connectionId,
      action.session.access.contact,
    )
    .run();
  const send = vi.fn(async () => "unexpected");

  await expect(
    deliverChannelActionProgress(repository, resolve, send),
  ).resolves.toEqual({ delivered: 0 });

  expect(send).not.toHaveBeenCalled();
  expect(
    await env.DB.prepare(
      "SELECT status FROM whatsapp_channel_action_progress WHERE action_id=?",
    )
      .bind(action.id)
      .first("status"),
  ).toBe("expired");
});

it("allows only one concurrent flush to claim an action's pending progress", async () => {
  const { repository, action, resolve } = await actionFixture();
  await enqueueChannelActionProgress(repository, action, "event", "Working.");
  let finishSend!: (id: string) => void;
  let markStarted!: () => void;
  const started = new Promise<void>((startedResolve) => {
    markStarted = startedResolve;
  });
  const send = vi.fn(
    () =>
      new Promise<string>((resolveSend) => {
        finishSend = resolveSend;
        markStarted();
      }),
  );
  const first = deliverChannelActionProgress(repository, resolve, send);
  await started;
  const second = await deliverChannelActionProgress(repository, resolve, send);
  finishSend("one-progress-message");

  await expect(first).resolves.toEqual({ delivered: 1 });
  expect(second).toEqual({ delivered: 0 });
  expect(send).toHaveBeenCalledTimes(1);
});
