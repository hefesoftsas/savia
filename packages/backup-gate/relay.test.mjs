import assert from "node:assert/strict";
import test from "node:test";
import worker from "../../apps/backup-coordinator/src/index.ts";
import { handleBackupControl } from "./control.mjs";

const CONTROL_SECRET = "s".repeat(64);

function makeAgencyEnvironment() {
  const gateCalls = [];
  const gate = {
    idFromName: () => ({ toString: () => "same-gate" }),
    get: () => ({
      fetch: async (request) => {
        gateCalls.push(request);
        return Response.json({
          owner: "snapshot",
          expiresAt: Date.now() + 120_000,
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
    gateCalls,
    environment: {
      SAVIA_BACKUP_GATE_REQUIRED: "true",
      SAVIA_BACKUP_CONTROL_SECRET: CONTROL_SECRET,
      BACKUP_GATE: gate,
      AUTH: peer,
      SAVIA_REQUEST: peer,
      CONNECTOR_GATEWAY: peer,
    },
  };
}

test("relays each allowlisted POST action to the agency controller", async () => {
  const { environment, gateCalls } = makeAgencyEnvironment();
  const forwarded = [];
  for (const action of ["acquire", "status", "renew", "release"]) {
    const response = await worker.fetch(
      new Request(
        `https://savia-backup-coordinator.jose-douglas-dev.workers.dev/api/_internal/backup-gate/${action}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${CONTROL_SECRET}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ owner: "snapshot", ttlMs: 120_000 }),
        },
      ),
      {
        AGENCIES: {
          fetch: async (request) => {
            forwarded.push(request.clone());
            return handleBackupControl(request, environment);
          },
        },
      },
    );
    assert.equal(response.status, 200);
  }

  assert.equal(forwarded.length, 4);
  assert.equal(
    forwarded[0].url,
    "https://agencies.internal/api/_internal/backup-gate/acquire",
  );
  assert.equal(forwarded[0].method, "POST");
  assert.equal(
    forwarded[0].headers.get("authorization"),
    `Bearer ${CONTROL_SECRET}`,
  );
  assert.deepEqual(await forwarded[0].json(), {
    owner: "snapshot",
    ttlMs: 120_000,
  });
  assert.equal(gateCalls.length, 4);
});

test("delegates authorization to the agency controller and propagates 401", async () => {
  const { environment, gateCalls } = makeAgencyEnvironment();
  const forwarded = [];
  const service = {
    fetch: async (request) => {
      forwarded.push(request);
      return handleBackupControl(request, environment);
    },
  };

  for (const headers of [
    { "content-type": "application/json" },
    { authorization: "Bearer wrong", "content-type": "application/json" },
  ]) {
    const response = await worker.fetch(
      new Request(
        "https://savia-backup-coordinator.jose-douglas-dev.workers.dev/api/_internal/backup-gate/status",
        { method: "POST", headers, body: "{}" },
      ),
      { AGENCIES: service },
    );
    assert.equal(response.status, 401);
  }

  assert.equal(forwarded.length, 2);
  assert.ok(
    forwarded.every(
      (request) =>
        request.url ===
        "https://agencies.internal/api/_internal/backup-gate/status",
    ),
  );
  assert.equal(gateCalls.length, 0);
});

test("returns 404 for every non-allowlisted method or application path", async () => {
  let calls = 0;
  const environment = {
    AGENCIES: { fetch: async () => (calls++, new Response()) },
  };
  const requests = [
    new Request("https://coordinator.test/api/_internal/backup-gate/acquire", {
      method: "GET",
    }),
    new Request("https://coordinator.test/api/_internal/backup-gate/enter", {
      method: "POST",
    }),
    new Request("https://coordinator.test/api/_internal/backup-gate/acquire/", {
      method: "POST",
    }),
    new Request("https://coordinator.test/health", { method: "POST" }),
    new Request(
      "https://coordinator.test/api/_internal/backup-gate/acquire?other=1",
      { method: "POST" },
    ),
  ];

  for (const request of requests)
    assert.equal((await worker.fetch(request, environment)).status, 404);
  assert.equal(calls, 0);
});

test("fails closed if the agency service binding is unavailable", async () => {
  const response = await worker.fetch(
    new Request("https://coordinator.test/api/_internal/backup-gate/status", {
      method: "POST",
    }),
    {},
  );

  assert.equal(response.status, 503);
});
