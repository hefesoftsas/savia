import test from "node:test";
import assert from "node:assert/strict";
import { backupCapability, handleBackupControl } from "./control.mjs";
const SECRET = "s".repeat(64);
const request = (action, secret = SECRET) =>
  new Request(`https://app/api/_internal/backup-gate/${action}`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    body: JSON.stringify({ owner: "owner", ttlMs: 120000 }),
  });
function environment(overrides = {}) {
  const calls = [];
  const gate = {
    idFromName: () => ({ toString: () => "same-gate" }),
    get: () => ({
      fetch: async (r) => {
        calls.push(r);
        return Response.json({
          owner: "owner",
          expiresAt: Date.now() + 120000,
          active: 0,
          drained: true,
        });
      },
    }),
  };
  const peer = {
    fetch: async () =>
      Response.json({ version: 1, required: true, gateId: "same-gate" }),
  };
  return {
    env: {
      BACKUP_GATE: gate,
      SAVIA_BACKUP_GATE_REQUIRED: "true",
      SAVIA_BACKUP_CONTROL_SECRET: SECRET,
      AUTH: peer,
      SAVIA_REQUEST: peer,
      CONNECTOR_GATEWAY: peer,
      ...overrides,
    },
    calls,
  };
}
test("rejects missing credentials before contacting coordinator", async () => {
  const { env, calls } = environment();
  assert.equal(
    (await handleBackupControl(request("acquire", "wrong"), env)).status,
    401,
  );
  assert.equal(calls.length, 0);
});
test("refuses acquisition if any writer has old code or a different namespace", async () => {
  const { env, calls } = environment({
    AUTH: {
      fetch: async () =>
        Response.json({ version: 1, required: true, gateId: "other" }),
    },
  });
  assert.equal(
    (await handleBackupControl(request("acquire"), env)).status,
    503,
  );
  assert.equal(calls.length, 0);
});
test("checks all peers then acquires private coordinator", async () => {
  const { env, calls } = environment();
  assert.equal(
    (await handleBackupControl(request("acquire"), env)).status,
    200,
  );
  assert.equal(new URL(calls[0].url).pathname, "/acquire");
});
test("fails closed when independent Flows persistence is enabled", async () => {
  const { env, calls } = environment({ SAVIA_FLOWS_EXECUTION_ENABLED: "true" });
  assert.equal(
    (await handleBackupControl(request("acquire"), env)).status,
    503,
  );
  assert.equal(calls.length, 0);
});
test("allows release even if peer readiness later fails", async () => {
  const { env, calls } = environment({ AUTH: undefined });
  assert.equal(
    (await handleBackupControl(request("release"), env)).status,
    200,
  );
  assert.equal(calls.length, 1);
});
test("capability identifies guarded runtime without starting database work", () => {
  const { env } = environment();
  assert.equal(
    backupCapability(
      new Request("https://private/_internal/savia-backup-capability"),
      env,
    ).status,
    200,
  );
  assert.equal(
    backupCapability(new Request("https://private/other"), env),
    null,
  );
});
