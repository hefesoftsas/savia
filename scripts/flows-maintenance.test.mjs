import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildMaintenanceJwt,
  parseMaintenanceArgs,
  runMaintenance,
  validateMaintenanceEnvironment,
} from "./flows-maintenance.mjs";

const SECRET = "a-test-flows-bridge-secret-with-32-bytes";
const ORIGIN = "https://savia-preview.hefesoft.com";
const ENV = {
  SAVIA_DEPLOY_ENVIRONMENT: "preview",
  SAVIA_PUBLIC_ORIGIN: ORIGIN,
  SAVIA_FLOWS_BRIDGE_SECRET: SECRET,
};

const completeManifest = {
  version: 3,
  coverage: {
    version: 3,
    kinds: [
      "database",
      "mailbox",
      "workflow-agent",
      "agent-runner",
      "email-agent-runner",
    ],
    storage: {
      database: ["sqlite"],
      mailbox: ["sqlite"],
      "workflow-agent": ["sqlite", "kv"],
      "agent-runner": ["sqlite"],
      "email-agent-runner": ["kv"],
    },
  },
  id: "550e8400-e29b-41d4-a716-446655440000",
  createdAt: "2026-10-12T12:00:00.000Z",
  executionEnabled: false,
  complete: true,
  objects: [
    {
      kind: "database",
      name: "db-id",
      pages: [
        {
          key: "__savia_backups/550e8400-e29b-41d4-a716-446655440000/0/0.json",
          sha256: "a".repeat(64),
        },
        {
          key: "__savia_backups/550e8400-e29b-41d4-a716-446655440000/0/1.json",
          sha256: "b".repeat(64),
        },
      ],
    },
    {
      kind: "mailbox",
      name: "mailbox:tenant:0",
      pages: [
        {
          key: "__savia_backups/550e8400-e29b-41d4-a716-446655440000/1/0.json",
          sha256: "c".repeat(64),
        },
      ],
    },
  ],
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("Flows maintenance CLI", () => {
  it("parses explicit backup, restore, and status actions", () => {
    assert.deepEqual(
      parseMaintenanceArgs([
        "--action",
        "backup",
        "--snapshot-file",
        "/tmp/backup.json",
        "--snapshot-id",
        completeManifest.id,
        "--drain-timeout-seconds",
        "600",
        "--apply",
      ]),
      {
        action: "backup",
        snapshotFile: "/tmp/backup.json",
        snapshotId: completeManifest.id,
        drainTimeoutSeconds: 600,
        apply: true,
      },
    );
    assert.equal(
      parseMaintenanceArgs(["--action", "status", "--apply"]).action,
      "status",
    );
    assert.equal(
      parseMaintenanceArgs([
        "--action",
        "backup",
        "--snapshot-file",
        "/tmp/backup.json",
      ]).drainTimeoutSeconds,
      1200,
    );
    assert.throws(
      () =>
        parseMaintenanceArgs([
          "--action",
          "backup",
          "--snapshot-file",
          "/tmp/backup.json",
          "--drain-timeout-seconds",
          "1201",
        ]),
      /between 1 and 1200/,
    );
    assert.throws(() => parseMaintenanceArgs(["--action", "purge", "--apply"]));
    assert.throws(() =>
      parseMaintenanceArgs(["--action", "backup", "--apply"]),
    );
    assert.throws(() =>
      parseMaintenanceArgs([
        "--action",
        "restore",
        "--snapshot-file",
        "backup.json",
        "--snapshot-id",
        "not-a-uuid",
        "--apply",
      ]),
    );
  });

  it("builds a fresh HS256 JWT with the endpoint's issuer, audience, and 60-second lifetime", () => {
    const token = buildMaintenanceJwt(SECRET, 1_800_000_000_000);
    const [header, payload, signature] = token.split(".");
    assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), {
      alg: "HS256",
      typ: "JWT",
    });
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    assert.deepEqual(claims, {
      iss: "savia",
      aud: "savia-flows-maintenance",
      iat: 1_800_000_000,
      exp: 1_800_000_060,
    });
    const expected = createHmac("sha256", SECRET)
      .update(`${header}.${payload}`)
      .digest("base64url");
    assert.equal(signature, expected);
    assert.throws(() => buildMaintenanceJwt("short", 1_800_000_000_000), /32/);
  });

  it("accepts only the environment's exact HTTPS public origin", () => {
    const validated = validateMaintenanceEnvironment(ENV);
    assert.equal(validated.environment, "preview");
    assert.equal(validated.origin, ORIGIN);
    assert.equal(validated.bridgeSecret, SECRET);
    for (const value of [
      "http://savia-preview.hefesoft.com",
      `${ORIGIN}/path`,
      `${ORIGIN}?tenant=one`,
      "https://user:password@savia-preview.hefesoft.com",
      "https://savia.app.hefesoft.com",
    ]) {
      assert.throws(() =>
        validateMaintenanceEnvironment({ ...ENV, SAVIA_PUBLIC_ORIGIN: value }),
      );
    }
    assert.throws(() =>
      validateMaintenanceEnvironment({
        ...ENV,
        SAVIA_DEPLOY_ENVIRONMENT: "staging",
      }),
    );
  });

  it("makes dry-run plans without validating credentials or making a request", async () => {
    let calls = 0;
    const result = await runMaintenance({
      argv: ["--action", "status"],
      env: {},
      fetchImpl: async () => {
        calls++;
        return jsonResponse({});
      },
      log: () => {},
    });
    assert.equal(result.dryRun, true);
    assert.equal(calls, 0);
  });

  it("reports active runs from status without waiting or changing service state", async () => {
    let calls = 0;
    const result = await runMaintenance({
      argv: ["--action", "status", "--apply"],
      env: ENV,
      fetchImpl: async (_url, options) => {
        calls++;
        assert.deepEqual(JSON.parse(options.body), { action: "status" });
        return jsonResponse({
          executionEnabled: false,
          maintenance: true,
          activeRuns: 2,
        });
      },
      log: () => {},
    });
    assert.equal(calls, 1);
    assert.equal(result.status.activeRuns, 2);
  });

  it("rejects a malformed active run count rather than treating it as quiescent", async () => {
    await assert.rejects(
      runMaintenance({
        argv: ["--action", "status", "--apply"],
        env: ENV,
        fetchImpl: async () =>
          jsonResponse({
            executionEnabled: false,
            maintenance: true,
            activeRuns: "0",
          }),
        log: () => {},
      }),
      /invalid active run count/,
    );
  });

  it("stops backup before starting when the endpoint is not paused in maintenance mode", async () => {
    const calls = [];
    await assert.rejects(
      runMaintenance({
        argv: [
          "--action",
          "backup",
          "--snapshot-file",
          "/tmp/flows.json",
          "--apply",
        ],
        env: ENV,
        fetchImpl: async (_url, options) => {
          calls.push(JSON.parse(options.body));
          return jsonResponse({ executionEnabled: true, maintenance: true });
        },
        log: () => {},
      }),
      /paused.*maintenance/i,
    );
    assert.deepEqual(calls, [{ action: "status" }]);
  });

  it("waits for active run leases to drain before starting a backup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "flows-maintenance-drain-"));
    const snapshotFile = join(directory, "snapshot.json");
    const calls = [];
    const sleeps = [];
    let timestamp = 0;
    let statusCount = 0;
    const emptySnapshot = { ...completeManifest, objects: [] };
    let requestedSnapshotId;
    const fetchImpl = async (_url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body.action);
      if (body.action === "status") {
        statusCount++;
        return jsonResponse({
          executionEnabled: false,
          maintenance: true,
          activeRuns: statusCount < 3 ? 2 - statusCount + 1 : 0,
        });
      }
      if (body.action === "start") {
        requestedSnapshotId = body.snapshotId;
        return jsonResponse({
          ...emptySnapshot,
          id: requestedSnapshotId,
          complete: false,
        });
      }
      if (body.action === "finish") {
        assert.equal(body.snapshotId, requestedSnapshotId);
        return jsonResponse({ ...emptySnapshot, id: requestedSnapshotId });
      }
      throw new Error(`Unexpected action ${body.action}`);
    };
    const result = await runMaintenance({
      argv: ["--action", "backup", "--snapshot-file", snapshotFile, "--apply"],
      env: ENV,
      fetchImpl,
      now: () => timestamp,
      sleepImpl: async (milliseconds) => {
        sleeps.push(milliseconds);
        timestamp += milliseconds;
      },
      log: () => {},
    });
    assert.equal(result.manifest.id, requestedSnapshotId);
    assert.deepEqual(sleeps, [5000, 5000]);
    assert.deepEqual(calls, ["status", "status", "status", "start", "finish"]);
  });

  it("generates a snapshot ID for automatic backups and uses the server echo", async (t) => {
    const directory = await mkdtemp(
      join(tmpdir(), "flows-maintenance-auto-id-"),
    );
    const snapshotFile = join(directory, "snapshot.json");
    t.after(() => rm(directory, { recursive: true, force: true }));
    const startBodies = [];
    const finishBodies = [];
    const fetchImpl = async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.action === "status") {
        return jsonResponse({
          executionEnabled: false,
          maintenance: true,
          activeRuns: 0,
        });
      }
      if (body.action === "start") {
        startBodies.push(body);
        if (!body.snapshotId) {
          return jsonResponse({ error: "snapshotId is required" }, 400);
        }
        assert.match(
          body.snapshotId,
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
        return jsonResponse({
          ...completeManifest,
          id: body.snapshotId,
          complete: false,
          objects: [],
        });
      }
      if (body.action === "finish") {
        finishBodies.push(body);
        return jsonResponse({
          ...completeManifest,
          id: startBodies[0]?.snapshotId,
          objects: [],
        });
      }
      throw new Error(`Unexpected action ${body.action}`);
    };

    const result = await runMaintenance({
      argv: ["--action", "backup", "--snapshot-file", snapshotFile, "--apply"],
      env: ENV,
      fetchImpl,
      log: () => {},
    });

    assert.equal(startBodies.length, 1);
    assert.equal(finishBodies.length, 1);
    assert.equal(finishBodies[0].snapshotId, startBodies[0].snapshotId);
    assert.equal(result.manifest.id, startBodies[0].snapshotId);
    assert.equal(
      JSON.parse(await readFile(snapshotFile, "utf8")).id,
      startBodies[0].snapshotId,
    );
  });

  it("times out without starting a backup and reports that Flows remains paused", async () => {
    const calls = [];
    const sleeps = [];
    let timestamp = 0;
    await assert.rejects(
      runMaintenance({
        argv: [
          "--action",
          "backup",
          "--snapshot-file",
          "/tmp/flows-timeout.json",
          "--drain-timeout-seconds",
          "10",
          "--apply",
        ],
        env: ENV,
        fetchImpl: async (_url, options) => {
          const body = JSON.parse(options.body);
          calls.push(body.action);
          return jsonResponse({
            executionEnabled: false,
            maintenance: true,
            activeRuns: 1,
          });
        },
        now: () => timestamp,
        sleepImpl: async (milliseconds) => {
          sleeps.push(milliseconds);
          timestamp += milliseconds;
        },
        log: () => {},
      }),
      /remains paused with 1 active run.*rerun/,
    );
    assert.deepEqual(calls, ["status", "status", "status"]);
    assert.deepEqual(sleeps, [5000, 5000]);
  });

  it("does not persist a manifest unless the server marks the finished snapshot complete", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "flows-maintenance-incomplete-"),
    );
    const snapshotFile = join(directory, "snapshot.json");
    const started = {
      version: 3,
      coverage: completeManifest.coverage,
      id: completeManifest.id,
      createdAt: completeManifest.createdAt,
      executionEnabled: false,
      complete: false,
      objects: [],
    };
    const fetchImpl = async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.action === "status") {
        return jsonResponse({
          executionEnabled: false,
          maintenance: true,
          activeRuns: 0,
        });
      }
      if (body.action === "start") {
        return jsonResponse({ ...started, id: body.snapshotId });
      }
      if (body.action === "finish") return jsonResponse(started);
      throw new Error(`Unexpected action ${body.action}`);
    };
    await assert.rejects(
      runMaintenance({
        argv: [
          "--action",
          "backup",
          "--snapshot-file",
          snapshotFile,
          "--apply",
        ],
        env: ENV,
        fetchImpl,
        log: () => {},
      }),
      /complete with execution disabled/,
    );
    await assert.rejects(readFile(snapshotFile), { code: "ENOENT" });
  });

  it("exports every target page sequentially and writes only the completed manifest with mode 0600", async () => {
    const directory = await mkdtemp(join(tmpdir(), "flows-maintenance-"));
    const snapshotFile = join(directory, "snapshot.json");
    const calls = [];
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const startManifest = {
      version: 3,
      coverage: completeManifest.coverage,
      id: completeManifest.id,
      createdAt: completeManifest.createdAt,
      executionEnabled: false,
      complete: false,
      objects: [
        { kind: "database", name: "db-id", pages: [] },
        { kind: "mailbox", name: "mailbox:tenant:0", pages: [] },
      ],
    };
    const fetchImpl = async (url, options) => {
      activeRequests++;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      assert.equal(url, `${ORIGIN}/api/public/savia-flows/maintenance`);
      assert.equal(options.method, "POST");
      assert.equal(options.headers["content-type"], "application/json");
      const jwt = options.headers["x-savia-flows-maintenance"];
      assert.equal(jwt.split(".").length, 3);
      assert.equal(
        JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()).aud,
        "savia-flows-maintenance",
      );
      const body = JSON.parse(options.body);
      calls.push(body);
      let response;
      if (body.action === "status") {
        response = {
          executionEnabled: false,
          maintenance: true,
          activeRuns: 0,
        };
      } else if (body.action === "start") {
        response = startManifest;
      } else if (body.action === "export") {
        response = {
          page: body.page,
          done: body.target === 0 ? body.page === 1 : true,
        };
      } else if (body.action === "finish") {
        response = completeManifest;
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
      activeRequests--;
      return jsonResponse(response);
    };

    const result = await runMaintenance({
      argv: [
        "--action",
        "backup",
        "--snapshot-file",
        snapshotFile,
        "--snapshot-id",
        completeManifest.id,
        "--apply",
      ],
      env: ENV,
      fetchImpl,
      log: () => {},
    });
    assert.equal(result.manifest.id, completeManifest.id);
    assert.equal(maxActiveRequests, 1);
    assert.deepEqual(
      calls
        .filter(({ action }) => action === "export")
        .map(({ target, page }) => [target, page]),
      [
        [0, 0],
        [0, 1],
        [1, 0],
      ],
    );
    assert.deepEqual(
      JSON.parse(await readFile(snapshotFile, "utf8")),
      completeManifest,
    );
    assert.equal((await stat(snapshotFile)).mode & 0o777, 0o600);
  });

  it("restores from the remote inspected manifest's page inventory, not the local page list", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "flows-maintenance-restore-"),
    );
    const snapshotFile = join(directory, "snapshot.json");
    await writeFile(
      snapshotFile,
      JSON.stringify({ ...completeManifest, objects: [] }),
      { mode: 0o600 },
    );
    const calls = [];
    const sleeps = [];
    let timestamp = 0;
    let statuses = 0;
    const fetchImpl = async (_url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      if (body.action === "status") {
        statuses++;
        return jsonResponse({
          executionEnabled: false,
          maintenance: true,
          activeRuns: statuses === 1 ? 1 : 0,
        });
      }
      if (body.action === "inspect") return jsonResponse(completeManifest);
      if (body.action === "restore") return jsonResponse({ restored: true });
      throw new Error(`Unexpected action ${body.action}`);
    };
    await runMaintenance({
      argv: ["--action", "restore", "--snapshot-file", snapshotFile, "--apply"],
      env: ENV,
      fetchImpl,
      now: () => timestamp,
      sleepImpl: async (milliseconds) => {
        sleeps.push(milliseconds);
        timestamp += milliseconds;
      },
      log: () => {},
    });
    assert.deepEqual(
      calls
        .filter(({ action }) => action === "restore")
        .map(({ target, page }) => [target, page]),
      [
        [0, 0],
        [0, 1],
        [1, 0],
      ],
    );
    assert.equal(
      calls.some(({ action }) => action === "enable"),
      false,
    );
    assert.deepEqual(sleeps, [5000]);
  });

  it("reports HTTP failures without exposing response bodies or bridge secrets", async () => {
    await assert.rejects(
      runMaintenance({
        argv: ["--action", "status", "--apply"],
        env: ENV,
        fetchImpl: async () => jsonResponse({ error: `bad ${SECRET}` }, 403),
        log: () => {},
      }),
      (error) => {
        assert.match(error.message, /HTTP 403/);
        assert.equal(error.message.includes(SECRET), false);
        return true;
      },
    );
  });
});
