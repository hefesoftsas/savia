import assert from "node:assert/strict";
import test from "node:test";
import worker from "./worker.mjs";

const SESSION_TOKEN = "s".repeat(43);
const MAINTENANCE_JWT = "signed-maintenance-token";

function request(path, { method = "POST", token = SESSION_TOKEN } = {}) {
  return new Request(`http://127.0.0.1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-savia-flows-maintenance": MAINTENANCE_JWT,
    },
    ...(method === "POST"
      ? { body: JSON.stringify({ action: "status" }) }
      : {}),
  });
}

test("maintenance session forwards only the fixed preview path and preserves signed context", async () => {
  const calls = [];
  const env = {
    SESSION_TOKEN,
    SAVIA_HOST: {
      fetch: async (forwarded) => {
        calls.push(forwarded);
        return Response.json({ ok: true });
      },
    },
  };
  const response = await worker.fetch(
    request("/api/public/savia-flows/maintenance"),
    env,
  );
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://savia-preview.hefesoft.com/api/public/savia-flows/maintenance",
  );
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.get("authorization"), null);
  assert.equal(
    calls[0].headers.get("x-savia-flows-maintenance"),
    MAINTENANCE_JWT,
  );
  assert.deepEqual(await calls[0].json(), { action: "status" });
});

test("health and maintenance requests require the per-session bearer token", async () => {
  let calls = 0;
  const env = {
    SESSION_TOKEN,
    SAVIA_HOST: { fetch: async () => (calls++, Response.json({ ok: true })) },
  };
  for (const path of [
    "/__session/health",
    "/api/public/savia-flows/maintenance",
  ]) {
    const response = await worker.fetch(request(path, { token: "wrong" }), env);
    assert.equal(response.status, 401);
  }
  assert.equal(calls, 0);
});

test("a missing or undersized session token never authenticates", async () => {
  for (const session of [undefined, "", "short"]) {
    const response = await worker.fetch(
      request("/__session/health", { method: "GET", token: "undefined" }),
      { SESSION_TOKEN: session },
    );
    assert.equal(response.status, 401);
  }
});

test("transport refuses other methods, routes, and query strings", async () => {
  let calls = 0;
  const env = {
    SESSION_TOKEN,
    SAVIA_HOST: { fetch: async () => (calls++, Response.json({ ok: true })) },
  };
  const cases = [
    request("/api/public/savia-flows/maintenance/other"),
    request("/api/public/savia-flows/maintenance?target=production"),
    request("/other"),
    request("/__session/health", { method: "POST" }),
  ];
  for (const candidate of cases) {
    assert.equal((await worker.fetch(candidate, env)).status, 404);
  }
  assert.equal(calls, 0);
});

test("authenticated health startup does not use the service binding", async () => {
  let calls = 0;
  const response = await worker.fetch(
    request("/__session/health", { method: "GET" }),
    {
      SESSION_TOKEN,
      SAVIA_HOST: { fetch: async () => (calls++, Response.json({})) },
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ready: true });
  assert.equal(calls, 0);
});
