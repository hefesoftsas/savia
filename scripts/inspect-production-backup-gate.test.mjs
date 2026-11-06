import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inspectProductionBackupGate } from "./inspect-production-backup-gate.mjs";

const secret = "backup-control-secret-".repeat(3);

test("inspects outstanding permits through authenticated POST status only", async () => {
  const calls = [];
  let output = "";
  const result = await inspectProductionBackupGate({
    env: { SAVIA_BACKUP_CONTROL_SECRET: secret },
    writeOutput: (value) => (output += value),
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json({
        owner: "hidden-owner",
        expiresAt: 123,
        active: 2,
        drained: false,
        permits: [
          { permit: "private-permit-1", createdAt: 1_700_000_000_000 },
          { permit: "private-permit-2", createdAt: 1_700_000_001_000 },
        ],
      });
    },
  });

  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(
    call.url,
    "https://savia-backup-coordinator.jose-douglas-dev.workers.dev/api/_internal/backup-gate/status",
  );
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.redirect, "error");
  assert.ok(call.init.signal instanceof AbortSignal);
  assert.equal(call.init.headers.Authorization, `Bearer ${secret}`);
  assert.deepEqual(JSON.parse(call.init.body), {
    owner: "production-backup-gate-diagnostic",
    includePermits: true,
  });
  assert.deepEqual(result, {
    status: "ok",
    activePermits: 2,
    createdAt: ["2023-11-14T22:13:20.000Z", "2023-11-14T22:13:21.000Z"],
  });
  assert.equal(output, `${JSON.stringify(result, null, 2)}\n`);
  for (const sensitive of [
    secret,
    "hidden-owner",
    "private-permit-1",
    "private-permit-2",
  ])
    assert.equal(output.includes(sensitive), false);
});

test("returns sanitized errors without exposing provider response bodies or secret", async () => {
  let output = "";
  const result = await inspectProductionBackupGate({
    env: { SAVIA_BACKUP_CONTROL_SECRET: secret },
    writeOutput: (value) => (output += value),
    fetchImpl: async () =>
      new Response(
        `provider detail ${secret} https://user:pass@example.invalid`,
        {
          status: 503,
        },
      ),
  });
  assert.deepEqual(result, { status: "error", error: "http_503" });
  assert.equal(output, '{\n  "status": "error",\n  "error": "http_503"\n}\n');
  assert.equal(output.includes(secret), false);
  assert.equal(output.includes("provider detail"), false);
  assert.equal(output.includes("user:pass"), false);
});

test("fails safely for missing credentials, network errors, malformed status, and inconsistent permits", async () => {
  const outcomes = [
    await inspectProductionBackupGate({
      env: {},
      writeOutput: () => {},
      fetchImpl: async () => assert.fail("must not call"),
    }),
    await inspectProductionBackupGate({
      env: { SAVIA_BACKUP_CONTROL_SECRET: secret },
      writeOutput: () => {},
      fetchImpl: async () => {
        throw new Error(`network ${secret}`);
      },
    }),
    await inspectProductionBackupGate({
      env: { SAVIA_BACKUP_CONTROL_SECRET: secret },
      writeOutput: () => {},
      fetchImpl: async () => new Response("not json", { status: 200 }),
    }),
    await inspectProductionBackupGate({
      env: { SAVIA_BACKUP_CONTROL_SECRET: secret },
      writeOutput: () => {},
      fetchImpl: async () =>
        Response.json({
          active: 2,
          permits: [{ permit: "secret-id", createdAt: 1 }],
        }),
    }),
  ];
  assert.deepEqual(outcomes, [
    { status: "error", error: "missing_secret" },
    { status: "error", error: "request_failed" },
    { status: "error", error: "invalid_response" },
    { status: "error", error: "invalid_response" },
  ]);
});

test("never calls acquire, renew, release, enter, or leave endpoints", async () => {
  const paths = [];
  await inspectProductionBackupGate({
    env: { SAVIA_BACKUP_CONTROL_SECRET: secret },
    writeOutput: () => {},
    fetchImpl: async (url) => {
      paths.push(new URL(url).pathname);
      return Response.json({ active: 0, permits: [] });
    },
  });
  assert.deepEqual(paths, ["/api/_internal/backup-gate/status"]);
});

test("rejects an oversized coordinator response without printing its contents", async () => {
  let output = "";
  const result = await inspectProductionBackupGate({
    env: { SAVIA_BACKUP_CONTROL_SECRET: secret },
    writeOutput: (value) => (output += value),
    fetchImpl: async () => new Response("x".repeat(128 * 1024 + 1)),
  });
  assert.deepEqual(result, { status: "error", error: "invalid_response" });
  assert.equal(
    output,
    '{\n  "status": "error",\n  "error": "invalid_response"\n}\n',
  );
});

test("workflow is a gated, main-only, serialized production-backup diagnostic", async () => {
  const source = await readFile(
    new URL(
      "../.github/workflows/inspect-production-backup-gate.yml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /workflow_dispatch:/);
  assert.doesNotMatch(source, /schedule:/);
  assert.match(source, /group: savia-production/);
  assert.match(source, /cancel-in-progress: false/);
  assert.match(source, /vars\.PRODUCTION_OPERATIONS_ENABLED == 'true'/);
  assert.match(source, /github\.ref == 'refs\/heads\/main'/);
  assert.match(source, /environment: production-backup/);
  assert.match(
    source,
    /SAVIA_BACKUP_CONTROL_SECRET: \$\{\{ secrets\.SAVIA_BACKUP_CONTROL_SECRET \}\}/,
  );
  assert.match(source, /node scripts\/inspect-production-backup-gate\.mjs/);
  assert.match(source, /expired lease/);
});
