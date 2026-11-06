import assert from "node:assert/strict";
import test from "node:test";
import worker from "./worker.mjs";

test("probe only requests the fixed deployed preview health endpoint", async () => {
  let calls = 0;
  const env = {
    PREVIEW: {
      fetch: async (url) => {
        calls++;
        assert.equal(url, "https://savia-preview.hefesoft.com/health");
        return Response.json({ status: "ok", database: "ok" });
      },
    },
  };
  const good = await worker.fetch(new Request("http://localhost/health"), env);
  assert.equal(good.status, 200);
  assert.deepEqual(await good.json(), { status: "ok", database: "ok" });
  for (const request of [
    new Request("http://localhost/v1/tenants"),
    new Request("http://localhost/health", { method: "POST" }),
  ]) {
    assert.equal((await worker.fetch(request, env)).status, 404);
  }
  assert.equal(calls, 1);
});

test("probe fails closed on unhealthy, malformed, or unavailable services", async () => {
  for (const fetch of [
    async () => Response.json({ status: "ok", database: "error" }),
    async () => new Response("challenge"),
    async () => new Response("unavailable", { status: 503 }),
    async () => {
      throw new Error("private diagnostic");
    },
  ]) {
    const result = await worker.fetch(new Request("http://localhost/health"), {
      PREVIEW: { fetch },
    });
    assert.equal(result.status, 503);
    assert.equal(await result.text(), "Preview health verification failed");
  }
});
