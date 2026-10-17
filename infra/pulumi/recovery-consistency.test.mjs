import assert from "node:assert/strict";
import test from "node:test";
import {
  captureRecoveryBoundary,
  RecoveryConsistencyError,
  startD1RecoveryMonitor,
  verifyRecoveryBoundary,
} from "./recovery-consistency.mjs";

const accountId = "a".repeat(32);
const id = "11111111-1111-4111-8111-111111111111";
const objects = [
  { key: "document", size: 4, etag: "abcd", customMetadata: { tenant: "1" } },
];
function fixture() {
  const state = {
    bookmark: "00000001",
    name: "savia-agencies",
    objects,
    fail: false,
    calls: [],
  };
  const options = {
    accountId,
    token: "redacted",
    databases: { "savia-agencies": id },
    buckets: ["savia-documents"],
    listObjects: async () => state.objects,
    fetchImpl: async (url, options) => {
      state.calls.push([url, options.method ?? "GET"]);
      return {
        ok: !state.fail,
        status: state.fail ? 403 : 200,
        json: async () => ({
          success: !state.fail,
          result: url.endsWith("/bookmark")
            ? { bookmark: state.bookmark }
            : { uuid: id, name: state.name },
        }),
      };
    },
  };
  return { state, options };
}

function fakeTimer() {
  let callback;
  const state = { interval: null, cleared: 0, handle: Symbol("monitor") };
  return {
    state,
    setIntervalImpl(next, interval) {
      callback = next;
      state.interval = interval;
      return state.handle;
    },
    clearIntervalImpl(handle) {
      assert.equal(handle, state.handle);
      state.cleared += 1;
    },
    tick() {
      callback?.();
    },
  };
}

const turn = () => new Promise((resolve) => setImmediate(resolve));

test("accepts only unchanged D1 bookmarks and R2 inventories across the entire capture", async () => {
  const { state, options } = fixture();
  const boundary = await captureRecoveryBoundary(options);
  const proof = await verifyRecoveryBoundary(boundary, options);
  assert.equal(proof.version, 1);
  assert.equal(proof.d1["savia-agencies"].bookmark, "00000001");
  assert.match(proof.r2["savia-documents"], /^[a-f0-9]{64}$/);
  assert.ok(state.calls.every(([, method]) => method === "GET"));
  assert.ok(!JSON.stringify(proof).includes("redacted"));
});

test("refuses concurrent D1 writes, identity mismatches, denied or missing bookmarks", async () => {
  for (const change of [
    { bookmark: "00000002" },
    { name: "savia-agencies-preview" },
    { fail: true },
    { bookmark: "" },
  ]) {
    const { state, options } = fixture();
    const boundary = await captureRecoveryBoundary(options);
    Object.assign(state, change);
    await assert.rejects(verifyRecoveryBoundary(boundary, options));
  }
});

test("refuses added, deleted, overwritten and metadata-only R2 changes", async () => {
  for (const replacement of [
    [],
    [...objects, { key: "other", size: 0, etag: "other" }],
    [{ ...objects[0], etag: "changed" }],
    [{ ...objects[0], customMetadata: { tenant: "2" } }],
  ]) {
    const { state, options } = fixture();
    const boundary = await captureRecoveryBoundary(options);
    state.objects = replacement;
    await assert.rejects(
      verifyRecoveryBoundary(boundary, options),
      /R2.*changed/,
    );
  }
});

test("normalizes object order but fails closed on incomplete or repeated R2 identities", async () => {
  const { state, options } = fixture();
  state.objects = [...objects, { key: "second", size: 0, etag: "defg" }];
  const boundary = await captureRecoveryBoundary(options);
  state.objects = [...state.objects].reverse();
  await verifyRecoveryBoundary(boundary, options);
  for (const bad of [[{ key: "x", size: 0 }], [objects[0], objects[0]]]) {
    state.objects = bad;
    await assert.rejects(captureRecoveryBoundary(options), /R2/);
  }
});

test("rejects invalid account or database IDs before any API call", async () => {
  const { state, options } = fixture();
  await assert.rejects(
    captureRecoveryBoundary({ ...options, accountId: "placeholder" }),
  );
  await assert.rejects(
    captureRecoveryBoundary({
      ...options,
      databases: { "savia-agencies": "placeholder" },
    }),
  );
  assert.equal(state.calls.length, 0);
});

test("classifies only capture drift as retryable, never identity or credential failures", async () => {
  const { isRecoveryConsistencyDrift } =
    await import("./recovery-consistency.mjs");
  assert.equal(typeof isRecoveryConsistencyDrift, "function");
  for (const change of [{ bookmark: "after-write" }, { objects: [] }]) {
    const { state, options } = fixture();
    const boundary = await captureRecoveryBoundary(options);
    Object.assign(state, change);
    await assert.rejects(verifyRecoveryBoundary(boundary, options), (error) => {
      assert.equal(error.code, "RECOVERY_CONSISTENCY_DRIFT");
      assert.equal(isRecoveryConsistencyDrift(error), true);
      return true;
    });
  }
  for (const change of [
    { name: "wrong-database" },
    { fail: true },
    { bookmark: "" },
  ]) {
    const { state, options } = fixture();
    const boundary = await captureRecoveryBoundary(options);
    Object.assign(state, change);
    await assert.rejects(verifyRecoveryBoundary(boundary, options), (error) => {
      assert.equal(isRecoveryConsistencyDrift(error), false);
      return true;
    });
  }
  assert.equal(
    isRecoveryConsistencyDrift(new Error("D1 changed during backup")),
    false,
  );
});

test("monitors every boundary bookmark on interval without an eager request", async () => {
  const { state, options } = fixture();
  const timer = fakeTimer();
  const boundary = await captureRecoveryBoundary(options);
  boundary.d1["savia-auth"] = {
    id: "22222222-2222-4222-8222-222222222222",
    bookmark: state.bookmark,
  };
  const monitor = startD1RecoveryMonitor(boundary, {
    accountId,
    token: "redacted",
    fetchImpl: options.fetchImpl,
    setIntervalImpl: timer.setIntervalImpl,
    clearIntervalImpl: timer.clearIntervalImpl,
  });

  assert.equal(state.calls.length, 2);
  assert.equal(timer.state.interval, 10_000);
  boundary.d1["savia-agencies"].bookmark = "mutated-after-start";
  timer.tick();
  await turn();
  assert.equal(state.calls.length, 4);
  await monitor();
  await monitor();
  assert.equal(timer.state.cleared, 1);
});

test("fails closed with typed retryable drift when an interval sees a new bookmark", async () => {
  const { state, options } = fixture();
  const timer = fakeTimer();
  const boundary = await captureRecoveryBoundary(options);
  const monitor = startD1RecoveryMonitor(boundary, {
    accountId,
    token: "redacted",
    fetchImpl: options.fetchImpl,
    setIntervalImpl: timer.setIntervalImpl,
    clearIntervalImpl: timer.clearIntervalImpl,
  });

  state.bookmark = "00000002";
  timer.tick();
  await turn();
  await assert.rejects(monitor(), (error) => {
    assert.ok(error instanceof RecoveryConsistencyError);
    assert.equal(error.code, "RECOVERY_CONSISTENCY_DRIFT");
    assert.match(error.message, /savia-agencies changed during backup/);
    return true;
  });
  assert.equal(timer.state.cleared, 1);
});

test("stores interval API failures for stop and clears the timer", async () => {
  const { state, options } = fixture();
  const timer = fakeTimer();
  const boundary = await captureRecoveryBoundary(options);
  const monitor = startD1RecoveryMonitor(boundary, {
    accountId,
    token: "redacted",
    fetchImpl: options.fetchImpl,
    setIntervalImpl: timer.setIntervalImpl,
    clearIntervalImpl: timer.clearIntervalImpl,
  });

  state.fail = true;
  timer.tick();
  await turn();
  const stop = monitor();
  assert.equal(monitor(), stop);
  await assert.rejects(stop, /D1 recovery verification failed/);
  assert.equal(timer.state.cleared, 1);
});

test("does not overlap polls and stop waits for an in-flight read", async () => {
  const timer = fakeTimer();
  const boundary = {
    version: 1,
    accountId,
    d1: { "savia-agencies": { id, bookmark: "00000001" } },
    r2: {},
  };
  let calls = 0;
  let resolveFetch;
  const monitor = startD1RecoveryMonitor(boundary, {
    accountId,
    token: "redacted",
    fetchImpl: () => {
      calls += 1;
      return new Promise((resolve) => {
        resolveFetch = resolve;
      });
    },
    setIntervalImpl: timer.setIntervalImpl,
    clearIntervalImpl: timer.clearIntervalImpl,
  });

  timer.tick();
  timer.tick();
  assert.equal(calls, 1);
  let stopped = false;
  const stop = monitor();
  assert.equal(monitor(), stop);
  const firstStop = stop.then(() => {
    stopped = true;
  });
  const secondStop = stop.then(() => {
    stopped = true;
  });
  assert.equal(timer.state.cleared, 1);
  await turn();
  assert.equal(stopped, false);
  resolveFetch({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      result: { bookmark: "00000001" },
    }),
  });
  await Promise.all([firstStop, secondStop]);
  assert.equal(stopped, true);
  assert.equal(calls, 1);
});

test("rejects invalid monitor options before starting its timer", async () => {
  const { options } = fixture();
  const boundary = await captureRecoveryBoundary(options);
  const timer = fakeTimer();
  for (const invalid of [
    { intervalMs: 0 },
    { intervalMs: 1.5 },
    { token: "" },
    { setIntervalImpl: null },
    { clearIntervalImpl: null },
  ]) {
    assert.throws(() =>
      startD1RecoveryMonitor(boundary, {
        accountId,
        token: "redacted",
        setIntervalImpl: timer.setIntervalImpl,
        clearIntervalImpl: timer.clearIntervalImpl,
        ...invalid,
      }),
    );
  }
  assert.equal(timer.state.cleared, 0);
});
