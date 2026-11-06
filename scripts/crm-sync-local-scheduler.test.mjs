import { test } from "node:test";
import assert from "node:assert/strict";
import { tickCrmSync } from "./crm-sync-local-scheduler.mjs";
test("uses only the local development scheduled endpoint", async () => {
  let target;
  await tickCrmSync(async (url, options) => {
    target = url;
    assert.ok(options.signal);
    assert.equal(options.redirect, "error");
    return new Response("ok");
  });
  assert.equal(target, "http://127.0.0.1:8790/__scheduled");
});
test("reports failure so later periodic invocation can recover", async () => {
  await assert.rejects(
    () => tickCrmSync(async () => new Response("", { status: 503 })),
    /503/,
  );
});
