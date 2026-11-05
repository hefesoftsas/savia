import test from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.mjs";

const revision = "a".repeat(40);
const base = "http://127.0.0.1";
test("initialization probe only invokes the bound Auth release with the supplied bridge credential", async () => {
  const requests = [];
  const env = {
    AUTH_REVISION: revision,
    PROBE_NONCE: "session-nonce",
    AUTH: {
      fetch: async (request) => {
        requests.push(request);
        return Response.json({ status: "ready", revision });
      },
    },
  };
  const ready = await worker.fetch(new Request(`${base}/ready`), env);
  assert.deepEqual(await ready.json(), { nonce: "session-nonce" });
  assert.equal(requests.length, 0);
  for (const request of [
    new Request(`${base}/initialize`),
    new Request(`${base}/initialize`, { method: "POST" }),
    new Request(`${base}/initialize`, {
      method: "POST",
      headers: { "x-savia-bridge-key": "credential" },
    }),
  ]) {
    assert.ok((await worker.fetch(request, env)).status >= 400);
  }
  assert.equal(requests.length, 0);
  const response = await worker.fetch(
    new Request(`${base}/initialize`, {
      method: "POST",
      headers: {
        "x-savia-bridge-key": "credential",
        "x-savia-probe-nonce": "session-nonce",
      },
    }),
    env,
  );
  assert.equal(response.status, 200);
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    "https://savia-auth.internal/_internal/deployment/initialize",
  );
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].headers.get("x-savia-bridge-key"), "credential");
  assert.deepEqual(await requests[0].json(), { revision });
});

test("probe never reports another release or a failed initialization as ready", async () => {
  for (const upstream of [
    Response.json({ status: "ready", revision: "b".repeat(40) }),
    Response.json({ status: "pending", revision }),
    new Response("private details", { status: 500 }),
  ]) {
    const response = await worker.fetch(
      new Request(`${base}/initialize`, {
        method: "POST",
        headers: {
          "x-savia-bridge-key": "credential",
          "x-savia-probe-nonce": "nonce",
        },
      }),
      {
        AUTH_REVISION: revision,
        PROBE_NONCE: "nonce",
        AUTH: { fetch: async () => upstream },
      },
    );
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /private details|credential/);
  }
});

test("probe returns allowlisted failure categories and upstream status without private details", async () => {
  const cases = [
    {
      response: new Response("credential private", { status: 403 }),
      category: "AUTH_BRIDGE_REJECTED",
      status: 403,
    },
    {
      response: new Response("revision private", { status: 409 }),
      category: "REVISION_MISMATCH",
      status: 409,
    },
    {
      response: new Response("initialization private", { status: 503 }),
      category: "INITIALIZATION_FAILED",
      status: 503,
    },
    {
      response: new Response("upstream private", { status: 400 }),
      category: "UPSTREAM_REJECTED",
      status: 400,
    },
    {
      response: Response.json({ status: "ready", revision: "b".repeat(40) }),
      category: "READINESS_MISMATCH",
      status: 200,
    },
    {
      fetch: async () => {
        throw new Error("credential transport private");
      },
      category: "TRANSPORT_FAILED",
    },
  ];
  for (const { response: upstream, fetch, category, status } of cases) {
    const response = await worker.fetch(
      new Request(`${base}/initialize`, {
        method: "POST",
        headers: {
          "x-savia-bridge-key": "credential",
          "x-savia-probe-nonce": "nonce",
        },
      }),
      {
        AUTH_REVISION: revision,
        PROBE_NONCE: "nonce",
        AUTH: { fetch: fetch ?? (async () => upstream) },
      },
    );
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.deepEqual(body, {
      error: category,
      ...(status === undefined ? {} : { upstreamStatus: status }),
    });
    assert.doesNotMatch(JSON.stringify(body), /private|credential/);
  }
});
