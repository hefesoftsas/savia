import { env } from "cloudflare:workers";
import { listDurableObjectIds, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setupChannelFixture } from "./whatsapp-channel-fixture";
import {
  wakeWhatsappScope,
  wakeWhatsappInput,
  isWhatsappRecoveryTick,
} from "../src/whatsapp/queue";
import type { WhatsappDispatcher } from "../src/whatsapp/dispatcher";

// Keep native alarms in the future while explicitly exercising their handlers.
// Only Date is faked; promises and test wait helpers retain real timing.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function fixture() {
  const f = await setupChannelFixture();
  const scope = { connectionId: f.connectionId, contact: "573001234567" };
  const stub = env.WHATSAPP_DISPATCHER.get(
    env.WHATSAPP_DISPATCHER.idFromName(crypto.randomUUID()),
  );
  return { ...f, scope, stub };
}
async function wake(
  stub: DurableObjectStub,
  scope: { connectionId: string; contact: string },
) {
  return stub.fetch("https://whatsapp-dispatch.internal/wake", {
    method: "POST",
    body: JSON.stringify(scope),
  });
}

it("coalesces duplicate wakes without postponing the durable alarm", async () => {
  const f = await fixture();
  expect((await wake(f.stub, f.scope)).status).toBe(202);
  const first = await runInDurableObject(f.stub, async (_instance, ctx) =>
    ctx.storage.getAlarm(),
  );
  expect(first).toBeGreaterThanOrEqual(Date.now() - 1000);
  expect((await wake(f.stub, f.scope)).status).toBe(202);
  expect(
    await runInDurableObject(f.stub, async (_instance, ctx) =>
      ctx.storage.getAlarm(),
    ),
  ).toBe(first);
  expect(
    (await wake(f.stub, { ...f.scope, contact: "573009999999" })).status,
  ).toBe(409);
});

it("turns off its alarm after the conversation becomes empty", async () => {
  const f = await fixture();
  await wake(f.stub, f.scope);
  await runInDurableObject(
    f.stub,
    async (instance: WhatsappDispatcher, ctx) => {
      vi.spyOn(instance as any, "processBatch").mockResolvedValue(true);
      await instance.alarm();
      expect(await ctx.storage.getAlarm()).toBeNull();
    },
  );
});

it("retains a wake received during processing even if the earlier due query found no work", async () => {
  const f = await fixture();
  await wake(f.stub, f.scope);
  await runInDurableObject(
    f.stub,
    async (instance: WhatsappDispatcher, ctx) => {
      vi.spyOn(instance as any, "processBatch").mockImplementation(async () => {
        await instance.fetch(
          new Request("https://whatsapp-dispatch.internal/wake", {
            method: "POST",
            body: JSON.stringify(f.scope),
          }),
        );
        return true;
      });
      await instance.alarm();
      expect(await ctx.storage.getAlarm()).not.toBeNull();
    },
  );
});

it("keeps a durable retry scheduled when batch processing fails", async () => {
  const f = await fixture();
  await wake(f.stub, f.scope);
  await runInDurableObject(
    f.stub,
    async (instance: WhatsappDispatcher, ctx) => {
      vi.spyOn(instance as any, "processBatch").mockRejectedValue(
        new Error("database unavailable"),
      );
      await expect(instance.alarm()).resolves.toBeUndefined();
      expect(await ctx.storage.getAlarm()).toBeGreaterThan(Date.now());
    },
  );
});

it("uses the same coordinator for repeated persisted input, and ignores unpersisted input", async () => {
  const f = await fixture();
  const input = {
    messageId: crypto.randomUUID(),
    phoneNumberId: f.phoneNumberId,
    wabaId: f.wabaId,
    contactPhone: f.scope.contact,
    text: "hello",
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
  const before = await listDurableObjectIds(env.WHATSAPP_DISPATCHER);
  await wakeWhatsappInput(env.DB, env.WHATSAPP_DISPATCHER, input);
  expect(await listDurableObjectIds(env.WHATSAPP_DISPATCHER)).toHaveLength(
    before.length,
  );
  expect(await f.repository.receive(input)).toBe(true);
  await wakeWhatsappInput(env.DB, env.WHATSAPP_DISPATCHER, input);
  const first = await listDurableObjectIds(env.WHATSAPP_DISPATCHER);
  expect(first).toHaveLength(before.length + 1);
  await wakeWhatsappInput(env.DB, env.WHATSAPP_DISPATCHER, input);
  await wakeWhatsappScope(env.WHATSAPP_DISPATCHER, f.scope);
  expect(await listDurableObjectIds(env.WHATSAPP_DISPATCHER)).toHaveLength(
    first.length,
  );
  const id = first.find(
    (id) => !before.some((prior) => prior.toString() === id.toString()),
  )!;
  await runInDurableObject(
    env.WHATSAPP_DISPATCHER.get(id),
    async (_instance, ctx) => {
      expect(await ctx.storage.get("scope")).toEqual(f.scope);
      expect(await ctx.storage.get("revision")).toBe(3);
      expect(await ctx.storage.getAlarm()).not.toBeNull();
    },
  );
});

it("runs WhatsApp recovery every five minutes while other minute jobs can continue", () => {
  expect(isWhatsappRecoveryTick(Date.UTC(2026, 9, 7, 10, 0))).toBe(true);
  expect(isWhatsappRecoveryTick(Date.UTC(2026, 9, 7, 10, 1))).toBe(false);
  expect(isWhatsappRecoveryTick(Date.UTC(2026, 9, 7, 10, 5))).toBe(true);
});

it("schedules an inbox retry at its due time instead of waiting for the recovery cron", async () => {
  const f = await fixture();
  const messageId = crypto.randomUUID();
  const retryAt = new Date(Date.now() + 5_000).toISOString();
  await f.repository.receive({
    messageId,
    phoneNumberId: f.phoneNumberId,
    wabaId: f.wabaId,
    contactPhone: f.scope.contact,
    text: "retry",
    timestamp: String(Math.floor(Date.now() / 1000)),
  });
  await env.DB.prepare(
    "UPDATE whatsapp_inbox SET retry_at=? WHERE message_id=?",
  )
    .bind(retryAt, messageId)
    .run();
  await wake(f.stub, f.scope);
  await runInDurableObject(
    f.stub,
    async (instance: WhatsappDispatcher, ctx) => {
      vi.spyOn(instance as any, "processBatch").mockResolvedValue(false);
      await instance.alarm();
      expect(await ctx.storage.getAlarm()).toBe(Date.parse(retryAt));
    },
  );
});

it("preserves a fresh wake when the running batch fails", async () => {
  const f = await fixture();
  await wake(f.stub, f.scope);
  await runInDurableObject(
    f.stub,
    async (instance: WhatsappDispatcher, ctx) => {
      vi.spyOn(instance as any, "processBatch").mockImplementation(async () => {
        await instance.fetch(
          new Request("https://whatsapp-dispatch.internal/wake", {
            method: "POST",
            body: JSON.stringify(f.scope),
          }),
        );
        throw new Error("batch failed after new message");
      });
      await instance.alarm().catch(() => undefined);
      const alarm = await ctx.storage.getAlarm();
      expect(alarm).toBeGreaterThan(Date.now());
      expect(alarm).toBeLessThanOrEqual(Date.now() + 1000);
    },
  );
});
