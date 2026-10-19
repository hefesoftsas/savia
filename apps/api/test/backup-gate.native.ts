import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it, vi } from "vitest";
import { guardStorageEnvironment } from "../../../packages/backup-gate/index.mjs";
import type { WhatsappDispatcher } from "../src/whatsapp/dispatcher";

it("guards native D1 batches/sessions and R2 mutations with a SQLite Durable Object", async () => {
  const namespace = (env as unknown as { BACKUP_GATE: DurableObjectNamespace })
    .BACKUP_GATE;
  const guarded = guardStorageEnvironment({
    ...env,
    BACKUP_GATE: namespace,
    SAVIA_BACKUP_GATE_REQUIRED: "true",
  });
  const stub = namespace.get(namespace.idFromName("production-backup-v1"));
  const call = async (action: string, body: object) =>
    stub.fetch(
      new Request(`https://gate.internal/${action}`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
  await guarded.DB.exec("CREATE TABLE gate_smoke (id TEXT PRIMARY KEY)");
  const statement = guarded.DB.prepare(
    "INSERT INTO gate_smoke VALUES (?)",
  ).bind("before");
  await guarded.DB.batch([statement]);
  await guarded.DOCUMENTS.put("gate-smoke", "before");
  const owner = crypto.randomUUID();
  const acquired = await call("acquire", { owner, ttlMs: 30000 });
  expect(acquired.status).toBe(200);
  expect(await acquired.json()).toMatchObject({
    drained: true,
    active: 0,
    owner,
  });
  try {
    await expect(
      guarded.DB.prepare("INSERT INTO gate_smoke VALUES ('blocked')").run(),
    ).rejects.toThrow(/gate/);
    await expect(
      guarded.DB.withSession()
        .prepare("INSERT INTO gate_smoke VALUES ('blocked-session')")
        .run(),
    ).rejects.toThrow(/gate/);
    await expect(
      guarded.DOCUMENTS.put("gate-smoke", "blocked"),
    ).rejects.toThrow(/gate/);
    await expect(guarded.DOCUMENTS.delete("gate-smoke")).rejects.toThrow(
      /gate/,
    );
    expect(await (await env.DOCUMENTS.get("gate-smoke"))?.text()).toBe(
      "before",
    );
    expect(
      (
        await env.DB.prepare("SELECT COUNT(*) AS n FROM gate_smoke").first<{
          n: number;
        }>()
      )?.n,
    ).toBe(1);
  } finally {
    expect((await call("release", { owner })).status).toBe(200);
  }
  await guarded.DB.withSession()
    .prepare("INSERT INTO gate_smoke VALUES ('after')")
    .run();
  await guarded.DOCUMENTS.delete("gate-smoke");
  expect(
    (
      await env.DB.prepare("SELECT COUNT(*) AS n FROM gate_smoke").first<{
        n: number;
      }>()
    )?.n,
  ).toBe(2);
});

it("records dispatcher alarm writes with invocation provenance and drains the gate", async () => {
  const nativeEnv = env as unknown as {
    BACKUP_GATE: DurableObjectNamespace;
    DB: D1Database;
    WHATSAPP_DISPATCHER: DurableObjectNamespace;
  };
  await nativeEnv.DB.exec(
    "CREATE TABLE IF NOT EXISTS backup_gate_dispatcher_smoke (value TEXT)",
  );
  await nativeEnv.DB.exec(
    "CREATE TABLE IF NOT EXISTS whatsapp_inbox (connection_id TEXT, normalized_contact TEXT, state TEXT, retry_at TEXT, received_at TEXT, lease_until TEXT, message_id TEXT)",
  );
  await nativeEnv.DB.exec(
    "CREATE TABLE IF NOT EXISTS whatsapp_channel_actions (connection_id TEXT, contact TEXT, status TEXT, delivery_state TEXT, queued_at TEXT, created_at TEXT, lease_until TEXT, id TEXT)",
  );
  await nativeEnv.DB.exec(
    "CREATE TABLE IF NOT EXISTS whatsapp_channel_action_progress (status TEXT, lease_until TEXT, created_at TEXT, retry_at TEXT, action_id TEXT)",
  );

  const stub = nativeEnv.WHATSAPP_DISPATCHER.get(
    nativeEnv.WHATSAPP_DISPATCHER.idFromName(crypto.randomUUID()),
  );
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  try {
    await runInDurableObject(
      stub,
      async (instance: WhatsappDispatcher, ctx) => {
        await ctx.storage.put("scope", {
          connectionId: "gate-native-test",
          contact: "573001234567",
        });
        await ctx.storage.put("revision", 1);
        const processBatch = vi
          .spyOn(instance as any, "processBatch")
          .mockImplementation(async () => {
            await (instance as any).env.DB.prepare(
              "INSERT INTO backup_gate_dispatcher_smoke VALUES (?)",
            )
              .bind(crypto.randomUUID())
              .run();
            return false;
          });
        try {
          await instance.alarm();
        } finally {
          processBatch.mockRestore();
        }
      },
    );

    const events = info.mock.calls.map(([line]) => JSON.parse(String(line)));
    const intent = events.find(
      (event) =>
        event.event === "backup_gate_operation" && event.phase === "intent",
    );
    const settled = events.find(
      (event) =>
        event.event === "backup_gate_operation" &&
        event.phase === "storage_settled",
    );
    expect(intent).toMatchObject({
      outcome: "pending",
      writer: "api.whatsapp_dispatcher.alarm",
      storageKind: "d1",
      binding: "DB",
      method: "run",
    });
    expect(intent.requestId).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,
    );
    expect(intent.permit).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,
    );
    expect(settled).toMatchObject({
      permit: intent.permit,
      requestId: intent.requestId,
      outcome: "fulfilled",
    });

    const status = await nativeEnv.BACKUP_GATE.get(
      nativeEnv.BACKUP_GATE.idFromName("production-backup-v1"),
    ).fetch(
      new Request("https://gate.internal/status", {
        method: "POST",
        body: JSON.stringify({ owner: "dispatcher-native-test" }),
      }),
    );
    expect(await status.json()).toMatchObject({ active: 0, drained: true });
    expect(
      (
        await nativeEnv.DB.prepare(
          "SELECT COUNT(*) AS count FROM backup_gate_dispatcher_smoke",
        ).first<{ count: number }>()
      )?.count,
    ).toBeGreaterThan(0);
  } finally {
    info.mockRestore();
  }
});
