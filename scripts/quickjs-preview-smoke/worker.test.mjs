import assert from "node:assert/strict";
import test from "node:test";
import worker, { createSmokeWorker } from "./worker.mjs";

function executeWith(resultFor) {
  const calls = [];
  return {
    calls,
    env: {
      HOOK_SERVICE: {
        fetch: async (request) => {
          calls.push(request);
          const body = await request.json();
          return resultFor(body, calls.length);
        },
      },
    },
  };
}

test("health route executes the fixed request transformation and token flow", async () => {
  const { env, calls } = executeWith(async ({ code, payload }) => {
    assert.match(code, /req\.setBody\(body/);
    assert.deepEqual(payload, {
      body: "quickjs-smoke",
      values: { marker: "transformed" },
    });
    return Response.json({
      body: "quickjs-smoke:transformed",
      variables: { smokeToken: "synthetic-token" },
    });
  });
  const response = await worker.fetch(
    new Request("http://localhost/health"),
    env,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { outcome: "health-passed" });
  assert.equal(calls.length, 1);
});

test("isolation route writes guest global state then checks a fresh invocation", async () => {
  const { env, calls } = executeWith(async ({ code }) => {
    if (calls.length === 1) {
      assert.match(code, /globalThis\.__saviaQuickJsSmokeLeak/);
      return Response.json({ body: "written", variables: {} });
    }
    assert.match(code, /globalThis\.__saviaQuickJsSmokeLeak !== undefined/);
    return Response.json({ body: "isolated", variables: {} });
  });
  const response = await worker.fetch(
    new Request("http://localhost/isolation"),
    env,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { outcome: "isolation-passed" });
  assert.equal(calls.length, 2);
});

test("CPU route accepts timed platform termination only after healthy recovery", async () => {
  let now = 0;
  const { env, calls } = executeWith(async ({ code }) => {
    if (calls.length === 1) {
      assert.match(code, /\^\(a\+\)\+\$/);
      assert.match(code, /"a"\.repeat\(32\) \+ "!"/);
      now = 30_000;
      return Response.json(
        { code: 1102, message: "Worker exceeded CPU time limit" },
        { status: 500 },
      );
    }
    return Response.json({
      body: "quickjs-smoke:transformed",
      variables: { smokeToken: "synthetic-token" },
    });
  });
  const probe = createSmokeWorker({ now: () => now });
  const response = await probe.fetch(new Request("http://localhost/cpu"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    outcome: "platform-terminated",
    elapsedMs: 30_000,
    recovered: true,
  });
  assert.equal(calls.length, 2);
});

test("CPU route rejects fast runtime interruption and fails if guest returns", async () => {
  const interrupted = executeWith(async (_request, call) =>
    call === 1
      ? Response.json({ error: "rejected" }, { status: 422 })
      : Response.json({
          body: "quickjs-smoke:transformed",
          variables: { smokeToken: "synthetic-token" },
        }),
  );
  const early = await createSmokeWorker({ now: () => 100 }).fetch(
    new Request("http://localhost/cpu"),
    interrupted.env,
  );
  assert.equal(early.status, 503);
  assert.deepEqual(await early.json(), {
    outcome: "runtime-rejected",
    elapsedMs: 0,
    recovered: true,
  });

  const completed = executeWith(async (_request, call) =>
    call === 1
      ? Response.json({ body: "unexpected", variables: {} })
      : Response.json({
          body: "quickjs-smoke:transformed",
          variables: { smokeToken: "synthetic-token" },
        }),
  );
  let clockReads = 0;
  const returned = await createSmokeWorker({
    now: () => (clockReads++ === 0 ? 0 : 30_000),
  }).fetch(new Request("http://localhost/cpu"), completed.env);
  assert.equal(returned.status, 503);
  assert.deepEqual(await returned.json(), {
    outcome: "unexpected-completion",
    elapsedMs: 30_000,
    recovered: true,
  });
});

test("CPU route rejects generic 503 and network failures even at 30 seconds", async () => {
  for (const failCpuCall of [
    async () =>
      Response.json({ error: "upstream unavailable" }, { status: 503 }),
    async () => {
      throw new Error("network timeout");
    },
  ]) {
    let now = 0;
    const { env } = executeWith(async (_request, call) => {
      if (call === 1) {
        now = 30_000;
        return failCpuCall();
      }
      return Response.json({
        body: "quickjs-smoke:transformed",
        variables: { smokeToken: "synthetic-token" },
      });
    });
    const response = await createSmokeWorker({ now: () => now }).fetch(
      new Request("http://localhost/cpu"),
      env,
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      outcome: "termination-unverified",
      elapsedMs: 30_000,
      recovered: true,
    });
  }
});

test("smoke worker exposes only fixed GET routes", async () => {
  let calls = 0;
  const env = {
    HOOK_SERVICE: {
      fetch: async () => {
        calls++;
        return Response.json({
          body: "quickjs-smoke:transformed",
          variables: { smokeToken: "synthetic-token" },
        });
      },
    },
  };
  for (const request of [
    new Request("http://localhost/execute", { method: "POST" }),
    new Request("http://localhost/health", { method: "POST" }),
    new Request("http://localhost/health?code=alert(1)"),
    new Request("http://localhost/unlisted"),
  ]) {
    assert.equal((await worker.fetch(request, env)).status, 404);
  }
  assert.equal(calls, 0);
});
