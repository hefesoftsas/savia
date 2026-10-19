// Synthetic code used only by the isolated lifecycle fixture.
import { WorkflowEntrypoint } from "cloudflare:workers";

export class FixtureWorkflow extends WorkflowEntrypoint {
  async run() {
    return "synthetic";
  }
}
export class FixtureStore {
  constructor(state) {
    this.state = state;
  }
  async fetch(request) {
    if (request.method === "PUT") {
      await this.state.storage.put("value", await request.text());
    }
    return Response.json({ value: await this.state.storage.get("value") });
  }
}

export default {
  async fetch(request, env) {
    if (
      !env.FIXTURE_ACCESS ||
      request.headers.get("x-fixture-access") !== env.FIXTURE_ACCESS ||
      env.RETIRED === "true"
    ) {
      return new Response("Isolated lifecycle fixture", { status: 503 });
    }
    if (env.COORDINATOR) return env.COORDINATOR.fetch(request);
    if (!env.STORE) return new Response("No fixture data", { status: 503 });
    const id = env.STORE.idFromName("synthetic-persistence");
    const store = env.STORE.get(id);
    if (request.method === "PUT") {
      const value = await request.text();
      await store.fetch("https://fixture.internal/value", {
        method: "PUT",
        body: value,
      });
      await env.DATA.put("synthetic", value);
      await env.KV.put("synthetic", value);
      await env.DB.prepare(
        "CREATE TABLE IF NOT EXISTS fixture (id INTEGER PRIMARY KEY, value TEXT)",
      ).run();
      await env.DB.prepare(
        "INSERT OR REPLACE INTO fixture (id, value) VALUES (1, ?)",
      )
        .bind(value)
        .run();
      return Response.json({ written: true });
    }
    return Response.json({
      durableObject: await (
        await store.fetch("https://fixture.internal/value")
      ).json(),
      r2: await (await env.DATA.get("synthetic"))?.text(),
      kv: await env.KV.get("synthetic"),
      d1: await env.DB.prepare("SELECT value FROM fixture WHERE id = 1").first(
        "value",
      ),
      release: env.RELEASE ?? "baseline",
    });
  },
  scheduled() {},
  queue(batch) {
    batch.ackAll();
  },
};
