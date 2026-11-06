import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { guardStorageEnvironment } from "../../../packages/backup-gate/index.mjs";

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
    expect(
      await guarded.DB.withSession()
        .prepare("SELECT id FROM gate_smoke WHERE id = ?")
        .bind("before")
        .first(),
    ).toEqual({ id: "before" });
    await expect(
      guarded.DB.prepare(
        "UPDATE gate_smoke SET id = 'changed' RETURNING id",
      ).first(),
    ).rejects.toThrow(/gate/);
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
