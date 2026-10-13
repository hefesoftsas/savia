import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { captureRecovery, restoreRecovery } from "./flows-preview-recovery.mjs";

const ACCOUNT = "a".repeat(32);
const AUTHORITY = "https://api.cloudflare.com/client/v4";
const FLOWS_D1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RESOURCES = JSON.stringify({
  workerName: "savia-flows-preview",
  databaseId: FLOWS_D1,
});
const DEPLOYMENTS = {
  "savia-agencies-preview": [
    { version_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", percentage: 75 },
    { version_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", percentage: 25 },
  ],
  "savia-flows-preview": [
    { version_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", percentage: 100 },
  ],
};

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status });
}

function env(overrides = {}) {
  return {
    SAVIA_DEPLOY_ENVIRONMENT: "preview",
    SAVIA_FLOWS_PROVISIONED: "true",
    SAVIA_FLOWS_RESOURCES: RESOURCES,
    CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
    CLOUDFLARE_API_TOKEN: "test-token",
    ...overrides,
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "flows-preview-recovery-"));
  await writeFile(
    join(root, "agencies.jsonc"),
    JSON.stringify({ migrations: [{ tag: "v1" }, { tag: "v2" }] }),
  );
  await writeFile(
    join(root, "flows.jsonc"),
    JSON.stringify({
      migrations: [{ tag: "savia-flows-v1" }],
      vars: {
        SAVIA_FLOWS_POLICY_GENERATION: "4000",
        SAVIA_FLOWS_MAINTENANCE: "false",
      },
    }),
  );
  return {
    root,
    metadataPath: join(root, "recovery.json"),
    configPaths: {
      agencies: join(root, "agencies.jsonc"),
      flows: join(root, "flows.jsonc"),
    },
  };
}

function flowsBindings({ generation = "3000", maintenance = "false" } = {}) {
  return [
    ["SAVIA_FLOWS_EXTERNAL_SERVICES_ENABLED", "false"],
    ["SAVIA_FLOWS_EXECUTION_ENABLED", "true"],
    ["SAVIA_FLOWS_QUOTAS_ENABLED", "true"],
    ["SAVIA_FLOWS_POLICY_GENERATION", generation],
    ["SAVIA_FLOWS_MAINTENANCE", maintenance],
    ["SAVIA_FLOWS_MAX_DAILY_RUNS", "100"],
    ["SAVIA_FLOWS_MAX_MONTHLY_RUNS", "1000"],
    ["SAVIA_FLOWS_MAX_CONCURRENT_RUNS", "2"],
    ["SAVIA_FLOWS_MAX_NODES_PER_RUN", "50"],
    ["SAVIA_FLOWS_MAX_STEPS_PER_RUN", "200"],
  ]
    .map(([name, text]) => ({ type: "plain_text", name, text }))
    .concat([
      {
        type: "service",
        name: "CODE_EXECUTOR",
        service: "savia-hook-executor-preview",
        entrypoint: "FlowsExecutor",
      },
      {
        type: "service",
        name: "SAVIA_HOST",
        service: "savia-agencies-preview",
      },
    ]);
}

function cloudflareFetcher({
  failAgenciesRestore = false,
  failLatch = false,
  d1Response,
  database,
} = {}) {
  const calls = [];
  const fetcher = async (url, options = {}) => {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(`/accounts/${ACCOUNT}`, "");
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ path, method: options.method ?? "GET", body });

    if (
      path.endsWith(`/d1/database/${FLOWS_D1}`) &&
      options.method !== "POST"
    ) {
      return response({
        success: true,
        result: { name: "savia-flows-preview" },
      });
    }
    if (options.method === "POST" && path.endsWith("/deployments")) {
      if (path.includes("savia-agencies") && failAgenciesRestore) {
        return response(
          { success: false, errors: [{ message: "injected" }] },
          500,
        );
      }
      return response({
        success: true,
        result: { id: "ffffffff-ffff-4fff-8fff-ffffffffffff" },
      });
    }
    if (options.method === "POST" && path.includes("/d1/database/")) {
      if (failLatch)
        return response(
          { success: false, errors: [{ message: "injected" }] },
          500,
        );
      if (d1Response) return response(d1Response);
      if (database) {
        const batch = body?.batch;
        const result = batch.map(({ sql, params = [] }) => {
          const statement = database.prepare(sql);
          if (/^\s*select\b/i.test(sql)) {
            return { success: true, results: statement.all(...params) };
          }
          statement.run(...params);
          return { success: true, results: [] };
        });
        return response({ success: true, result });
      }
      return response({
        success: true,
        result: [
          { success: true, results: [] },
          { success: true, results: [] },
          { success: true, results: [{ paused: 1, generation: 9001 }] },
        ],
      });
    }
    if (path.endsWith("/deployments")) {
      const name = path.split("/").at(-2);
      return response({
        success: true,
        result: { deployments: [{ versions: DEPLOYMENTS[name] }] },
      });
    }
    if (path.includes("/workers/services/")) {
      const name = path.split("/").at(-1);
      return response({
        success: true,
        result: {
          default_environment: {
            script: {
              migration_tag: name.includes("flows") ? "savia-flows-v1" : "v2",
            },
          },
        },
      });
    }
    if (path.endsWith("/settings")) {
      const name = path.split("/").at(-2);
      return response({
        success: true,
        result: {
          ...(name.includes("flows") ? { bindings: flowsBindings() } : {}),
        },
      });
    }
    throw new Error(
      `Unexpected Cloudflare request ${options.method ?? "GET"} ${path}`,
    );
  };
  return { calls, fetcher };
}

test("capture stores exact active versions and configs in a private metadata file", async (t) => {
  const files = await fixture();
  t.after(() => rm(files.root, { recursive: true, force: true }));
  const { calls, fetcher } = cloudflareFetcher();
  const result = await captureRecovery({
    env: env(),
    fetcher,
    root: files.root,
    configPaths: files.configPaths,
    metadataPath: files.metadataPath,
    now: () => 1234,
  });

  assert.equal(result.skipped, false);
  const metadata = JSON.parse(await readFile(files.metadataPath, "utf8"));
  assert.equal(metadata.environment, "preview");
  assert.equal(metadata.accountId, ACCOUNT);
  assert.equal(metadata.flowsDatabaseId, FLOWS_D1);
  assert.equal(metadata.workers.flows.policyGeneration, 3000);
  assert.equal(metadata.renderedFlowsPolicyGeneration, 4000);
  assert.deepEqual(
    metadata.workers.agencies.versions,
    DEPLOYMENTS["savia-agencies-preview"],
  );
  assert.deepEqual(
    metadata.workers.flows.versions,
    DEPLOYMENTS["savia-flows-preview"],
  );
  assert.equal((await stat(files.metadataPath)).mode & 0o777, 0o600);
  assert.doesNotMatch(await readFile(files.metadataPath, "utf8"), /test-token/);
  assert.equal(calls.length, 7);
  assert.ok(calls.every((call) => call.method === "GET"));
});

test("capture refuses foreign preview resources before contacting Cloudflare", async (t) => {
  const files = await fixture();
  t.after(() => rm(files.root, { recursive: true, force: true }));
  let calls = 0;
  await assert.rejects(
    captureRecovery({
      env: env({
        SAVIA_FLOWS_RESOURCES: JSON.stringify({
          workerName: "savia-flows-production",
          databaseId: "f".repeat(32),
        }),
      }),
      fetcher: async () => {
        calls += 1;
        return response({});
      },
      root: files.root,
      configPaths: files.configPaths,
      metadataPath: files.metadataPath,
    }),
    /preview Flows resources/,
  );
  assert.equal(calls, 0);
});

test("capture rejects a Durable Object migration change before preview pauses", async (t) => {
  const files = await fixture();
  t.after(() => rm(files.root, { recursive: true, force: true }));
  let calls = 0;
  const { fetcher } = cloudflareFetcher();
  await assert.rejects(
    captureRecovery({
      env: env(),
      fetcher: async (...args) => {
        calls += 1;
        const result = await fetcher(...args);
        if (String(args[0]).includes("/workers/services/savia-flows-preview")) {
          return response({
            success: true,
            result: {
              default_environment: { script: { migration_tag: "older-tag" } },
            },
          });
        }
        return result;
      },
      root: files.root,
      configPaths: {
        ...files.configPaths,
        flows: files.configPaths.flows,
      },
      metadataPath: files.metadataPath,
    }),
    /migration tag/,
  );
  assert.ok(calls >= 2);
  await assert.rejects(readFile(files.metadataPath));
});

test("restore attempts both workers independently and never uses force", async (t) => {
  const files = await fixture();
  t.after(() => rm(files.root, { recursive: true, force: true }));
  const capture = cloudflareFetcher();
  await captureRecovery({
    env: env(),
    fetcher: capture.fetcher,
    root: files.root,
    configPaths: files.configPaths,
    metadataPath: files.metadataPath,
  });
  const metadata = JSON.parse(await readFile(files.metadataPath, "utf8"));
  metadata.workers.flows.policyGeneration = 9000;
  await writeFile(files.metadataPath, JSON.stringify(metadata));

  const restore = cloudflareFetcher({ failAgenciesRestore: true });
  const result = await restoreRecovery({
    env: env(),
    fetcher: restore.fetcher,
    metadataPath: files.metadataPath,
    attemptedWorkers: { agencies: true, flows: true },
    now: () => 5000,
  });

  assert.equal(result.restored.agencies, false);
  assert.equal(result.restored.flows, true);
  assert.equal(result.failures.length, 1);
  const agencyPost = restore.calls.find(
    (call) =>
      call.method === "POST" &&
      call.path.includes("savia-agencies-preview/deployments"),
  );
  const flowsPost = restore.calls.find(
    (call) =>
      call.method === "POST" &&
      call.path.includes("savia-flows-preview/deployments"),
  );
  const latch = restore.calls.find(
    (call) => call.path.includes("/d1/database/") && call.method === "POST",
  );
  assert.ok(agencyPost);
  assert.ok(flowsPost);
  assert.ok(latch);
  assert.ok(restore.calls.indexOf(latch) < restore.calls.indexOf(flowsPost));
  assert.deepEqual(agencyPost.body, {
    strategy: "percentage",
    versions: DEPLOYMENTS["savia-agencies-preview"],
  });
  assert.deepEqual(flowsPost.body, {
    strategy: "percentage",
    versions: DEPLOYMENTS["savia-flows-preview"],
  });
  for (const call of [agencyPost, flowsPost])
    assert.equal("force" in call.body, false);
  assert.match(latch.body.batch[1].sql, /paused\s*=\s*1/i);
  assert.match(latch.body.batch[1].sql, /MAX\(/i);
  assert.match(latch.body.batch[1].sql, /CAST\(\? AS INTEGER\)/i);
  assert.deepEqual(latch.body.batch[1].params, ["5000", "5000", "9001"]);
  assert.ok(restore.calls.indexOf(latch) < restore.calls.indexOf(agencyPost));
});

test("capture refuses Flows settings that cannot fence stale workers or remain outside maintenance", async (t) => {
  const files = await fixture();
  t.after(() => rm(files.root, { recursive: true, force: true }));
  const { fetcher } = cloudflareFetcher();
  await assert.rejects(
    captureRecovery({
      env: env(),
      fetcher: async (...args) => {
        const result = await fetcher(...args);
        if (String(args[0]).includes("savia-flows-preview/settings")) {
          return response({
            success: true,
            result: {
              migration_tag: "savia-flows-v1",
              bindings: flowsBindings({ maintenance: "true" }),
            },
          });
        }
        return result;
      },
      root: files.root,
      configPaths: files.configPaths,
      metadataPath: files.metadataPath,
    }),
    /maintenance/,
  );
  await assert.rejects(readFile(files.metadataPath));
});

test("capture refuses a rendered Flows generation that cannot pause the current generation", async (t) => {
  const files = await fixture();
  t.after(() => rm(files.root, { recursive: true, force: true }));
  const flowsConfig = JSON.parse(
    await readFile(files.configPaths.flows, "utf8"),
  );
  flowsConfig.vars.SAVIA_FLOWS_POLICY_GENERATION = "2000";
  await writeFile(files.configPaths.flows, JSON.stringify(flowsConfig));
  await assert.rejects(
    captureRecovery({
      env: env(),
      fetcher: cloudflareFetcher().fetcher,
      root: files.root,
      configPaths: files.configPaths,
      metadataPath: files.metadataPath,
    }),
    /newer than the current Flows policy generation/,
  );
});

test("a failed pause latch fences Flows rollback but still attempts Savia API rollback", async (t) => {
  const files = await fixture();
  t.after(() => rm(files.root, { recursive: true, force: true }));
  await captureRecovery({
    env: env(),
    fetcher: cloudflareFetcher().fetcher,
    root: files.root,
    configPaths: files.configPaths,
    metadataPath: files.metadataPath,
  });
  const restore = cloudflareFetcher({ failLatch: true });
  const result = await restoreRecovery({
    env: env(),
    fetcher: restore.fetcher,
    metadataPath: files.metadataPath,
    attemptedWorkers: { agencies: true, flows: true },
  });
  assert.equal(result.restored.agencies, true);
  assert.equal(result.restored.flows, false);
  assert.ok(result.failures.some((failure) => failure.includes("pause latch")));
  assert.ok(
    restore.calls.some(
      (call) =>
        call.path.includes("savia-agencies-preview/deployments") &&
        call.method === "POST",
    ),
  );
  assert.ok(
    restore.calls.findIndex((call) => call.path.includes("/d1/database/")) <
      restore.calls.findIndex(
        (call) =>
          call.path.includes("savia-agencies-preview/deployments") &&
          call.method === "POST",
      ),
  );
  assert.ok(
    !restore.calls.some(
      (call) =>
        call.path.includes("savia-flows-preview/deployments") &&
        call.method === "POST",
    ),
  );
});

test("SQLite verifies the pause latch advances beyond an existing generation", async (t) => {
  const files = await fixture();
  t.after(() => rm(files.root, { recursive: true, force: true }));
  await captureRecovery({
    env: env(),
    fetcher: cloudflareFetcher().fetcher,
    root: files.root,
    configPaths: files.configPaths,
    metadataPath: files.metadataPath,
  });
  const metadata = JSON.parse(await readFile(files.metadataPath, "utf8"));
  metadata.workers.flows.policyGeneration = 9000;
  metadata.renderedFlowsPolicyGeneration = 4000;
  await writeFile(files.metadataPath, JSON.stringify(metadata));

  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  database.exec(`
    CREATE TABLE savia_flows_execution_control (
      id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
      paused INTEGER NOT NULL CHECK (paused IN (0, 1)),
      updated_at INTEGER NOT NULL,
      generation INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO savia_flows_execution_control (id, paused, updated_at, generation)
    VALUES (1, 0, 4500, 20000);
  `);
  const { calls, fetcher } = cloudflareFetcher({ database });
  const result = await restoreRecovery({
    env: env(),
    fetcher,
    metadataPath: files.metadataPath,
    attemptedWorkers: { agencies: false, flows: true },
    now: () => 5000,
  });

  assert.deepEqual(result.failures, []);
  assert.equal(result.restored.flows, true);
  const row = database
    .prepare("SELECT paused, generation FROM savia_flows_execution_control")
    .get();
  assert.equal(row.paused, 1);
  assert.equal(row.generation, 20001);
  const latch = calls.find(
    (call) => call.path.includes("/d1/database/") && call.method === "POST",
  );
  assert.deepEqual(latch.body.batch[1].params, ["5000", "5000", "9001"]);
});

test("capture and restore refuse a D1 database whose authoritative name is not preview", async (t) => {
  const files = await fixture();
  t.after(() => rm(files.root, { recursive: true, force: true }));
  const { fetcher } = cloudflareFetcher();
  let calls = 0;
  const foreignDatabaseFetcher = async (url, options) => {
    calls += 1;
    const result = await fetcher(url, options);
    if (String(url).includes(`/d1/database/${FLOWS_D1}`)) {
      return response({
        success: true,
        result: { name: "savia-flows-production" },
      });
    }
    return result;
  };
  await assert.rejects(
    captureRecovery({
      env: env(),
      fetcher: foreignDatabaseFetcher,
      root: files.root,
      configPaths: files.configPaths,
      metadataPath: files.metadataPath,
    }),
    /D1 database name/,
  );
  assert.ok(calls > 0);
  await assert.rejects(readFile(files.metadataPath));

  await captureRecovery({
    env: env(),
    fetcher,
    root: files.root,
    configPaths: files.configPaths,
    metadataPath: files.metadataPath,
  });
  const restore = cloudflareFetcher();
  const foreignRestoreFetcher = async (url, options) => {
    if (String(url).includes(`/d1/database/${FLOWS_D1}`)) {
      return response({
        success: true,
        result: { name: "savia-flows-production" },
      });
    }
    return restore.fetcher(url, options);
  };
  await assert.rejects(
    restoreRecovery({
      env: env(),
      fetcher: foreignRestoreFetcher,
      metadataPath: files.metadataPath,
      attemptedWorkers: { agencies: true, flows: true },
    }),
    /D1 database name/,
  );
  assert.equal(
    restore.calls.some((call) => call.method === "POST"),
    false,
  );
});

test("top-level D1 success with failed, empty, or malformed batch rows withholds Flows rollback", async (t) => {
  for (const [label, d1Response] of [
    [
      "failed statement",
      {
        success: true,
        result: [
          { success: true, results: [] },
          { success: false, results: [] },
          { success: true, results: [{ paused: 1, generation: 9001 }] },
        ],
      },
    ],
    ["empty result", { success: true, result: [] }],
    [
      "missing verification row",
      {
        success: true,
        result: [
          { success: true, results: [] },
          { success: true, results: [] },
          { success: true, results: [] },
        ],
      },
    ],
    [
      "unsafe generation",
      {
        success: true,
        result: [
          { success: true, results: [] },
          { success: true, results: [] },
          { success: true, results: [{ paused: 1, generation: "9001" }] },
        ],
      },
    ],
  ]) {
    const files = await fixture();
    t.after(() => rm(files.root, { recursive: true, force: true }));
    await captureRecovery({
      env: env(),
      fetcher: cloudflareFetcher().fetcher,
      root: files.root,
      configPaths: files.configPaths,
      metadataPath: files.metadataPath,
    });
    const restore = cloudflareFetcher({ d1Response });
    const result = await restoreRecovery({
      env: env(),
      fetcher: restore.fetcher,
      metadataPath: files.metadataPath,
      attemptedWorkers: { agencies: true, flows: true },
    });
    assert.equal(result.restored.flows, false, label);
    assert.equal(result.restored.agencies, true, label);
    assert.equal(
      restore.calls.some(
        (call) =>
          call.path.includes("savia-flows-preview/deployments") &&
          call.method === "POST",
      ),
      false,
      label,
    );
  }
});

test("invalid saved policy generations fail before any recovery mutation", async (t) => {
  const files = await fixture();
  t.after(() => rm(files.root, { recursive: true, force: true }));
  await captureRecovery({
    env: env(),
    fetcher: cloudflareFetcher().fetcher,
    root: files.root,
    configPaths: files.configPaths,
    metadataPath: files.metadataPath,
  });
  const metadata = JSON.parse(await readFile(files.metadataPath, "utf8"));
  metadata.renderedFlowsPolicyGeneration = Number.MAX_SAFE_INTEGER + 1;
  await writeFile(files.metadataPath, JSON.stringify(metadata));
  let calls = 0;
  await assert.rejects(
    restoreRecovery({
      env: env(),
      fetcher: async () => {
        calls += 1;
        return response({ success: true, result: {} });
      },
      metadataPath: files.metadataPath,
      attemptedWorkers: { agencies: true, flows: true },
    }),
    /policy generation/,
  );
  assert.equal(calls, 0);
});

test("restore skips a worker whose pause was never attempted", async (t) => {
  const files = await fixture();
  t.after(() => rm(files.root, { recursive: true, force: true }));
  await captureRecovery({
    env: env(),
    fetcher: cloudflareFetcher().fetcher,
    root: files.root,
    configPaths: files.configPaths,
    metadataPath: files.metadataPath,
  });
  const restore = cloudflareFetcher();
  const result = await restoreRecovery({
    env: env(),
    fetcher: restore.fetcher,
    metadataPath: files.metadataPath,
    attemptedWorkers: { agencies: false, flows: true },
  });
  assert.equal(result.restored.agencies, false);
  assert.equal(result.restored.flows, true);
  assert.ok(
    !restore.calls.some((call) =>
      call.path.includes("savia-agencies-preview/deployments"),
    ),
  );
});

test("unprovisioned Flows skips capture and restore without Cloudflare calls", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return response({});
  };
  assert.deepEqual(
    await captureRecovery({
      env: env({ SAVIA_FLOWS_PROVISIONED: "false" }),
      fetcher,
    }),
    { skipped: true },
  );
  assert.deepEqual(
    await restoreRecovery({
      env: env({ SAVIA_FLOWS_PROVISIONED: "false" }),
      fetcher,
    }),
    { skipped: true },
  );
  assert.equal(calls, 0);
});
