import { it, expect } from "vitest";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = require(
  require.resolve("miniflare", {
    paths: [dirname(require.resolve("wrangler"))],
  }),
);
it("managed step replay needs a native-write receipt; event resumption works", async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "probe",
          modules: true,
          scriptPath: resolve("test/fixtures/managed-workflow.mjs"),
          compatibilityDate: "2026-09-01",
          d1Databases: { DB: "workflow-probe" },
          workflows: { FLOW: { name: "probe", className: "ManagedProbe" } },
        },
      ],
    }),
  );
  try {
    const db = await mf.getD1Database("DB");
    await db.prepare("CREATE TABLE probe(writes INTEGER)").run();
    await db.prepare("INSERT INTO probe VALUES (0)").run();
    const bindings = await mf.getBindings();
    const run = await bindings.FLOW.create({ id: "replay-probe" });
    await expect
      .poll(
        async () =>
          (await db.prepare("SELECT writes FROM probe").first()).writes,
        { timeout: 30000 },
      )
      .toBe(2);
    await run.sendEvent({ type: "resume", payload: {} });
    await expect
      .poll(async () => (await run.status()).status, { timeout: 30000 })
      .toBe("complete");
  } finally {
    await mf.dispose();
  }
}, 120000);
