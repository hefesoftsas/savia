import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { compile, start, call, directory } from "./runtime.mjs";
import { fixtures, benchmarks, corpus } from "./fixtures.mjs";

const sizes = await compile();
const quick = await start("quickjs");
const dynamic = await start("dynamic");
const checks = [];
const payload = { body: "", values: {} };
async function reject(name, code, extra = {}) {
  console.log(`Checking ${name}`);
  const started = performance.now();
  const result = await call(quick, { code, payload, ...extra });
  assert.equal(result.ok, false, name);
  // Every rejected execution must leave the next guest usable.
  assert.equal(
    (await call(quick, { code: 'bru.setVar("ok",1)', payload })).result
      .variables.ok,
    "1",
  );
  checks.push({
    name,
    status: "passed",
    elapsedMs: performance.now() - started,
    reason: result.error,
  });
}
try {
  for (const fixture of fixtures) {
    const expected = await call(dynamic, fixture);
    assert.equal(expected.ok, true, `baseline: ${fixture.name}`);
    assert.deepEqual(await call(quick, fixture), expected, fixture.name);
    assert.deepEqual(
      await call(dynamic, { ...fixture, cached: true }),
      expected,
      `cached: ${fixture.name}`,
    );
  }
  checks.push({
    name: "catalog-success-parity",
    count: fixtures.length,
    status: "passed",
  });
  console.log(`Catalog success parity: ${fixtures.length}`);
  let rejections = 0;
  for (const fixture of fixtures) {
    const invalid = {
      ...fixture,
      payload: { ...fixture.payload, values: {}, response: "invalid response" },
    };
    const expected = await call(dynamic, invalid);
    assert.equal(expected.ok, false, `negative baseline: ${fixture.name}`);
    assert.equal(
      (await call(quick, invalid)).ok,
      false,
      `negative quickjs: ${fixture.name}`,
    );
    rejections++;
  }
  checks.push({
    name: "catalog-rejection-parity",
    count: rejections,
    status: "passed",
  });
  for (const fixture of benchmarks)
    assert.deepEqual(
      await call(quick, fixture),
      await call(dynamic, fixture),
      fixture.name,
    );
  const globals = await call(quick, {
    code: "req.setBody(JSON.stringify([typeof process,typeof require,typeof fetch,typeof WebSocket,typeof Deno,typeof Bun,typeof caches,typeof crypto,typeof setTimeout]));",
    payload,
  });
  assert.deepEqual(JSON.parse(globals.result.body), Array(9).fill("undefined"));
  checks.push({ name: "no-host-globals", status: "passed" });
  await reject("network", 'await fetch("https://example.invalid")');
  await reject("module-import", 'await import("node:fs")');
  await reject("syntax", "const = ;");
  await reject("throw", 'throw new Error("synthetic")');
  await reject("infinite-loop", "while(true) {}");
  await reject(
    "infinite-promise-jobs",
    "await new Promise(()=>{function loop(){Promise.resolve().then(loop)}loop()})",
  );
  await reject("unresolved-promise", "await new Promise(()=>{})");
  await reject("stack-exhaustion", "function f(){return f()} f()");
  await reject(
    "memory-exhaustion",
    'const a=[];while(true)a.push("x".repeat(100000));',
  );
  await reject("input-limit", " ".repeat(1_100_000) + "1");
  await reject("output-limit", 'req.setBody("x".repeat(1_100_000))');
  await reject(
    "serialization-getter-loop",
    'Object.defineProperty(variables,"x",{enumerable:true,get(){while(true){}}});',
  );
  // Catastrophic RegExp is measured separately with an external watchdog:
  // QuickJS's interrupt callback does not reliably preempt this native operation.
  await call(quick, {
    code: 'globalThis.probeSecret="synthetic";Object.prototype.probePollution=1',
    payload,
  });
  const isolation = await call(quick, {
    code: 'req.setBody(typeof globalThis.probeSecret+":"+typeof ({}).probePollution)',
    payload,
  });
  assert.equal(isolation.result.body, "undefined:undefined");
  checks.push({ name: "cross-request-isolation", status: "passed" });
  const concurrent = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      call(quick, {
        code: 'bru.setVar("id",bru.getVar("id"))',
        payload: { body: "", values: { id: String(i) } },
      }),
    ),
  );
  assert.deepEqual(
    concurrent.map((x) => x.result.variables.id),
    Array.from({ length: 20 }, (_, i) => String(i)),
  );
  checks.push({
    name: "concurrent-payload-isolation",
    count: 20,
    status: "passed",
  });
  const stickyCode =
    'if(bru.getVar("write"))globalThis.sticky=bru.getVar("write");req.setBody(globalThis.sticky??"");';
  const sticky = (write, cached) => ({
    code: stickyCode,
    cached,
    payload: { body: "", values: write ? { write } : {} },
  });
  await call(dynamic, sticky("tenant-a-synthetic", true));
  const cachedRead = await call(dynamic, sticky("", true));
  await call(dynamic, sticky("tenant-a-synthetic", false));
  const uncachedRead = await call(dynamic, sticky("", false));
  assert.equal(cachedRead.result.body, "tenant-a-synthetic");
  assert.equal(uncachedRead.result.body, "");
  checks.push({
    name: "cached-dynamic-global-state",
    status: "behavior-difference",
    finding:
      "get() with the same ID/code retains guest globals across invocations; load() does not. A global content-hash-only ID must not be shipped for multi-tenant hooks.",
  });
  const result = {
    measuredAt: new Date().toISOString(),
    corpus,
    sizes,
    checks,
  };
  await writeFile(
    `${directory}/verification.json`,
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await quick.dispose();
  await dynamic.dispose();
}
