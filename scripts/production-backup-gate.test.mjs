import test from "node:test";
import assert from "node:assert/strict";
import {
  runGatedProductionBackup,
  withProductionBackupGate,
} from "./production-backup-gate.mjs";
const env = {
  SAVIA_BACKUP_CONTROL_URL:
    "https://savia.hefesoft.com/api/_internal/backup-gate",
  SAVIA_BACKUP_CONTROL_SECRET: "s".repeat(64),
};

test("release backup validates production apply arguments before acquiring the gate", async () => {
  let gateCalls = 0;
  const options = {
    withGate: async (capture) => {
      gateCalls += 1;
      return capture();
    },
    captureBackup: async () => "captured",
    env,
  };

  await assert.rejects(
    runGatedProductionBackup(["--stack", "preview", "--apply"], options),
    /production/i,
  );
  await assert.rejects(
    runGatedProductionBackup(["--stack", "production", "--dry-run"], options),
    /--apply/i,
  );
  assert.equal(gateCalls, 0);
});

test("release backup captures under the writer gate with validated production plan", async () => {
  const calls = [];
  const options = {
    env,
    withGate: async (capture, settings) => {
      calls.push(["gate", settings.env]);
      return capture();
    },
    captureBackup: async (plan, settings) => {
      calls.push(["capture", plan, settings.env]);
      return "captured";
    },
  };

  assert.equal(
    await runGatedProductionBackup(
      ["--stack", "production", "--apply", "--out-dir", "/tmp/release-backup"],
      options,
    ),
    "captured",
  );
  assert.deepEqual(calls, [
    ["gate", env],
    [
      "capture",
      {
        stack: "production",
        dryRun: false,
        skipR2: false,
        outDir: "/tmp/release-backup",
        confirmQuiescent: null,
        flowsSnapshot: null,
        r2Concurrency: 4,
      },
      env,
    ],
  ]);
});
function fixture(options = {}) {
  const actions = [];
  let owner;
  let active = options.active ?? 0;
  let renewal;
  let stopped = false;
  let captured = false;
  const settings = {
    env,
    now: () => 1000,
    sleep: async () => {
      active = 0;
    },
    setIntervalImpl: (fn) => {
      renewal = fn;
      return 1;
    },
    clearIntervalImpl: () => {
      stopped = true;
    },
    fetchImpl: async (url, init) => {
      const action = url.split("/").at(-1);
      actions.push(action);
      const body = JSON.parse(init.body);
      owner ??= body.owner;
      if (options.fail === action)
        return Response.json({ error: "unavailable" }, { status: 503 });
      return Response.json({
        owner: options.foreign && action === "status" ? "other" : owner,
        expiresAt: 100000,
        active,
        drained: active === 0,
      });
    },
  };
  return {
    settings,
    actions,
    renew: () => renewal(),
    get stopped() {
      return stopped;
    },
    capture: async () => {
      captured = true;
      return 7;
    },
    get captured() {
      return captured;
    },
  };
}
test("drains writers before capture and always releases", async () => {
  const f = fixture({ active: 1 });
  assert.equal(await withProductionBackupGate(f.capture, f.settings), 7);
  assert.deepEqual(f.actions, ["acquire", "status", "status", "release"]);
  assert.ok(f.stopped);
});
test("never captures when acquiring barrier fails", async () => {
  const f = fixture({ fail: "acquire" });
  await assert.rejects(withProductionBackupGate(f.capture, f.settings));
  assert.equal(f.captured, false);
  assert.ok(f.actions.includes("release"));
});
test("rejects lease ownership loss and releases only own owner token", async () => {
  const f = fixture({ foreign: true });
  await assert.rejects(
    withProductionBackupGate(f.capture, f.settings),
    /lease/i,
  );
  assert.ok(f.actions.includes("release"));
});
test("capture failure reopens barrier", async () => {
  const f = fixture();
  await assert.rejects(
    withProductionBackupGate(async () => {
      throw new Error("capture failed");
    }, f.settings),
    /capture failed/,
  );
  assert.equal(f.actions.at(-1), "release");
});
test("renewal failure invalidates otherwise successful capture", async () => {
  const f = fixture({ fail: "renew" });
  await assert.rejects(
    withProductionBackupGate(async () => {
      await f.renew();
      return 7;
    }, f.settings),
    /lease|barrier/i,
  );
  assert.equal(f.actions.at(-1), "release");
});
test("drain timeout never starts capture", async () => {
  const f = fixture({ active: 1 });
  let now = 1000;
  f.settings.now = () => now;
  f.settings.sleep = async () => {
    now += 10000;
  };
  f.settings.drainTimeoutMs = 100;
  await assert.rejects(
    withProductionBackupGate(f.capture, f.settings),
    /drain/i,
  );
  assert.equal(f.captured, false);
});
test("rejects insecure controller endpoints and missing credentials before network", async () => {
  const f = fixture();
  await assert.rejects(
    withProductionBackupGate(f.capture, {
      ...f.settings,
      env: {
        ...env,
        SAVIA_BACKUP_CONTROL_URL: "http://unsafe/api/_internal/backup-gate",
      },
    }),
    /HTTPS/,
  );
  assert.equal(f.actions.length, 0);
});

test("real coordinator drains a concurrent D1 operation before controller capture and reopens storage", async () => {
  const { BackupCoordinator, guardStorageEnvironment } =
    await import("../packages/backup-gate/index.mjs");
  const { handleBackupControl, backupCapability } =
    await import("../packages/backup-gate/control.mjs");
  const values = new Map();
  const coordinator = new BackupCoordinator(
    {
      storage: {
        get: async (key) => structuredClone(values.get(key)),
        put: async (key, value) => {
          values.set(key, structuredClone(value));
        },
      },
    },
    {},
  );
  const namespace = {
    idFromName: () => ({ toString: () => "integration-gate" }),
    get: () => ({ fetch: (request) => coordinator.fetch(request) }),
  };
  const writerEnv = {
    BACKUP_GATE: namespace,
    SAVIA_BACKUP_GATE_REQUIRED: "true",
  };
  const peer = {
    fetch: (request) => Promise.resolve(backupCapability(request, writerEnv)),
  };
  const controllerEnv = {
    ...writerEnv,
    SAVIA_BACKUP_CONTROL_SECRET: env.SAVIA_BACKUP_CONTROL_SECRET,
    AUTH: peer,
    SAVIA_REQUEST: peer,
    CONNECTOR_GATEWAY: peer,
  };
  let finish;
  let started;
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  const running = new Promise((resolve) => {
    finish = resolve;
  });
  let hold = true;
  const db = {
    prepare: () => ({
      run: async () => {
        started();
        if (hold) await running;
        return { success: true };
      },
    }),
    batch: async () => [],
    exec: async () => ({}),
  };
  const guarded = guardStorageEnvironment({ ...writerEnv, DB: db });
  const write = guarded.DB.prepare("UPDATE sessions").run();
  await entered;
  let captured = false;
  const result = await withProductionBackupGate(
    async () => {
      captured = true;
      await assert.rejects(guarded.DB.prepare("UPDATE sessions").run(), /gate/);
      return "consistent snapshot";
    },
    {
      env,
      fetchImpl: (url, init) =>
        handleBackupControl(new Request(url, init), controllerEnv),
      sleep: async () => {
        assert.equal(captured, false);
        await assert.rejects(
          guarded.DB.prepare("UPDATE sessions").run(),
          /gate/,
        );
        hold = false;
        finish();
        await write;
      },
    },
  );
  assert.equal(result, "consistent snapshot");
  assert.deepEqual(await guarded.DB.prepare("UPDATE sessions").run(), {
    success: true,
  });
});

test("never accepts a capture that exceeded the maximum maintenance window", async () => {
  const f = fixture();
  let clock = 1000;
  f.settings.now = () => clock;
  f.settings.maxHoldMs = 100;
  await assert.rejects(
    withProductionBackupGate(async () => {
      clock = 1101;
      return 7;
    }, f.settings),
    /maintenance window/,
  );
  assert.equal(f.actions.at(-1), "release");
});
