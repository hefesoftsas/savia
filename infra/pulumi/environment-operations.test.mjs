import test from "node:test";
import assert from "node:assert/strict";
import {
  assertProvisionPlan,
  verifySavedEnvironmentPlan,
} from "./environment-operations.mjs";
import { productionBackupLifecycleRule, stateBackendUrl } from "./naming.mjs";
const accountId = "a".repeat(32);
const plan = {
  accountId: "a".repeat(32),
  environment: "preview",
  operation: "release",
  checkpointFingerprint: "before",
  artifactDigest: "c".repeat(64),
  configDigest: "d".repeat(64),
  revision: "reviewed",
  pulumiPlanDigest: "f".repeat(64),
};
test("saved release plans bind artifact, checkpoint, account, source revision and plan bytes", () => {
  const actual = { ...plan };
  assert.equal(verifySavedEnvironmentPlan(plan, actual), true);
  for (const key of Object.keys(actual))
    assert.throws(
      () => verifySavedEnvironmentPlan(plan, { ...actual, [key]: "changed" }),
      /saved|plan/i,
    );
});

test("first-install provision plans allow only persistence creates in the selected stack", () => {
  const plan = {
    steps: [
      {
        op: "create",
        type: "pulumi:providers:cloudflare",
        urn: "urn:pulumi:production::savia-cloudflare::pulumi:providers:cloudflare::default_7_0_0",
      },
      {
        op: "update",
        type: "pulumi:pulumi:Stack",
        urn: "urn:pulumi:production::savia-cloudflare::pulumi:pulumi:Stack::savia-cloudflare-production",
      },
      {
        op: "create",
        kind: "d1",
        type: "cloudflare:index/d1Database:D1Database",
        accountId,
        name: "savia-auth-local-canonical-20260913-v2",
        urn: "urn:pulumi:production::savia-cloudflare::cloudflare:index/d1Database:D1Database::auth-db",
      },
      {
        op: "create",
        kind: "r2",
        type: "cloudflare:index/r2Bucket:R2Bucket",
        accountId,
        name: "savia-documents",
        urn: "urn:pulumi:production::savia-cloudflare::cloudflare:index/r2Bucket:R2Bucket::documents",
      },
      {
        op: "create",
        kind: "r2",
        type: "cloudflare:index/r2Bucket:R2Bucket",
        accountId,
        name: "savia-production-backups",
        storageClass: "Standard",
        urn: "urn:pulumi:production::savia-cloudflare::cloudflare:index/r2Bucket:R2Bucket::production-backups",
      },
      {
        op: "create",
        type: "cloudflare:index/r2BucketLifecycle:R2BucketLifecycle",
        accountId,
        bucketName: "savia-production-backups",
        rules: [
          {
            id: "expire-production-backups-after-30-days",
            enabled: true,
            conditions: { prefix: "production/" },
            deleteObjectsTransition: {
              condition: { type: "Age", maxAge: 30 * 24 * 60 * 60 },
            },
          },
        ],
        urn: "urn:pulumi:production::savia-cloudflare::cloudflare:index/r2BucketLifecycle:R2BucketLifecycle::production-backups-lifecycle",
      },
      {
        op: "create",
        type: "cloudflare:index/r2ManagedDomain:R2ManagedDomain",
        accountId,
        bucketName: "savia-production-backups",
        enabled: false,
        urn: "urn:pulumi:production::savia-cloudflare::cloudflare:index/r2ManagedDomain:R2ManagedDomain::production-backups-public-access",
      },
    ],
  };
  assert.equal(
    assertProvisionPlan(plan, "production", {
      accountId,
      profile: { flowsEnabled: false },
    }),
    true,
  );
  for (const badStep of [
    { ...plan.steps[2], op: "delete" },
    { ...plan.steps[2], op: "update" },
    {
      op: "create",
      kind: "worker",
      name: "savia",
      urn: "urn:pulumi:production::savia-cloudflare::cloudflare:index/worker:Worker::gateway",
    },
    {
      op: "create",
      kind: "r2",
      name: "savia-pulumi-state-preview",
      urn: "urn:pulumi:production::savia-cloudflare::cloudflare:index/r2Bucket:R2Bucket::state-backend",
    },
    {
      ...plan.steps[2],
      urn: "urn:pulumi:preview::savia-cloudflare::cloudflare:index/d1Database:D1Database::auth-db",
    },
    {
      ...plan.steps[2],
      name: "savia-auth-preview",
    },
    {
      ...plan.steps[3],
      name: "unrelated-data-bucket",
    },
    {
      ...plan.steps[0],
      op: "update",
    },
    {
      ...plan.steps[2],
      accountId: "b".repeat(32),
    },
  ]) {
    assert.throws(() =>
      assertProvisionPlan({ steps: [badStep] }, "production", {
        accountId,
        profile: { flowsEnabled: false },
      }),
    );
  }
  assert.throws(() =>
    assertProvisionPlan(
      {
        steps: plan.steps.map((step, index) =>
          index === 5 ? { ...step, bucketName: "savia-documents" } : step,
        ),
      },
      "production",
      { accountId, profile: { flowsEnabled: false } },
    ),
  );
  for (const [index, changes] of [
    [4, { storageClass: "InfrequentAccess" }],
    [5, { rules: [{ ...productionBackupLifecycleRule(), enabled: false }] }],
    [
      5,
      {
        rules: [
          { ...productionBackupLifecycleRule(), conditions: { prefix: "" } },
        ],
      },
    ],
    [
      5,
      {
        rules: [{ ...productionBackupLifecycleRule(), id: "unexpected-rule" }],
      },
    ],
    [6, { enabled: true }],
    [5, { bucketName: "savia-documents" }],
    [6, { bucketName: "savia-documents" }],
  ]) {
    assert.throws(() =>
      assertProvisionPlan(
        {
          steps: plan.steps.map((step, stepIndex) =>
            stepIndex === index ? { ...step, ...changes } : step,
          ),
        },
        "production",
        { accountId, profile: { flowsEnabled: false } },
      ),
    );
  }
});

test("state-catalog command failures preserve private output and stay generic", async () => {
  const { createEnvironmentDependencies } =
      await import("./environment-operations.mjs"),
    { execFile } = await import("node:child_process"),
    { promisify } = await import("node:util"),
    { mkdtemp, readFile, readdir, stat, rm } = await import("node:fs/promises"),
    { tmpdir } = await import("node:os"),
    { join } = await import("node:path"),
    execute = promisify(execFile),
    directory = await mkdtemp(join(tmpdir(), "savia-state-catalog-failure-")),
    account = "a".repeat(32),
    deps = createEnvironmentDependencies({
      env: {
        CLOUDFLARE_ACCOUNT_ID: account,
        AWS_ACCESS_KEY_ID: "test-access-key",
        AWS_SECRET_ACCESS_KEY: "test-secret-key",
        PULUMI_CONFIG_PASSPHRASE: "test-passphrase",
        PULUMI_BACKEND_URL: stateBackendUrl(
          account,
          "savia-pulumi-state-preview",
        ),
        SAVIA_RUNTIME_OPERATION_DIRECTORY: directory,
      },
      cloud: async () => [{ kind: "r2", name: "savia-pulumi-state-preview" }],
      run: async (_binary, _args, options) =>
        execute(
          process.execPath,
          [
            "-e",
            'process.stdout.write("catalog stdout"); process.stderr.write("catalog stderr"); process.exit(29)',
          ],
          options,
        ),
    });
  try {
    await assert.rejects(deps.inventory("preview"), {
      message: "Environment command failed: pulumi stack",
    });
    const errorsDirectory = join(directory, "command-errors"),
      files = await readdir(errorsDirectory),
      path = join(errorsDirectory, files[0]),
      record = JSON.parse(await readFile(path, "utf8"));
    assert.equal(files.length, 1);
    assert.deepEqual(record, {
      executable: "pulumi",
      operation: "environment-command",
      exitcode: 29,
      signal: null,
      stdout: "catalog stdout",
      stderr: "catalog stderr",
    });
    assert.equal((await stat(errorsDirectory)).mode & 0o777, 0o700);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("concrete adoption saves and applies the guarded plan, then clears one-time Worker imports", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createEnvironmentDependencies, writePrivateJson } =
    await import("./environment-operations.mjs");
  const { parseEnvironmentArgs, runEnvironmentOperation } =
    await import("./environment.mjs");
  const { stateBackendUrl } = await import("./naming.mjs");
  const directory = await mkdtemp(join(tmpdir(), "savia-adopt-orchestration-"));
  try {
    const accountId = "a".repeat(32),
      backendUrl = stateBackendUrl(accountId, "savia-pulumi-state-preview"),
      name = "savia-preview",
      cloudId = "b".repeat(32),
      calls = [];
    const manifest = {
      version: 1,
      accountId,
      environment: "preview",
      project: "savia-cloudflare",
      stack: "preview",
      profile: { enabledWorkers: [name] },
      resources: [{ kind: "worker", name, cloudId }],
    };
    const raw = {
      deployment: {
        resources: [
          {
            type: "pulumi:pulumi:Stack",
            outputs: {
              databaseNames: {
                auth: "savia-auth-preview",
                domain: "savia-agencies-preview",
              },
            },
          },
        ],
      },
    };
    const management = {
      deployment: {
        resources: [
          {
            type: "pulumi:pulumi:Stack",
            outputs: {
              accountId,
              backendBuckets: ["savia-pulumi-state-preview"],
              protected: true,
            },
          },
          {
            urn: "urn:pulumi:management::savia-management::cloudflare:index/r2Bucket:R2Bucket::state-backend",
            type: "cloudflare:index/r2Bucket:R2Bucket",
            id: `${accountId}/savia-pulumi-state-preview/default`,
            protect: true,
            inputs: { accountId, name: "savia-pulumi-state-preview" },
            outputs: { accountId, name: "savia-pulumi-state-preview" },
          },
        ],
      },
    };
    const checkpoints = [
      {
        project: "savia-cloudflare",
        stack: "preview",
        qualifiedStack: "organization/savia-cloudflare/preview",
        accountId,
        backendUrl,
        resources: [],
        stateExport: raw,
      },
      {
        project: "savia-management",
        stack: "management",
        qualifiedStack: "organization/savia-management/management",
        accountId,
        backendUrl,
        resources: [
          {
            kind: "r2",
            name: "savia-pulumi-state-preview",
            cloudId: "savia-pulumi-state-preview",
          },
        ],
        stateExport: management,
      },
    ];
    const run = async (binary, args) => {
      calls.push({ binary, args });
      if (binary === "git") return { stdout: "reviewed" };
      if (args[0] === "preview") {
        await writeFile(
          args[args.indexOf("--save-plan") + 1],
          "private saved Pulumi plan",
        );
        return {
          stdout: JSON.stringify({
            steps: [
              {
                op: "import",
                newState: {
                  type: "cloudflare:index/worker:Worker",
                  importID: `${accountId}/${cloudId}`,
                  inputs: { accountId, name },
                },
              },
              {
                op: "create",
                newState: {
                  type: "pulumi-nodejs:dynamic/runtime:RuntimeRelease",
                  inputs: {
                    accountId,
                    environment: "preview",
                    mode: "adopt",
                    adoptionManifest: manifest,
                  },
                },
              },
            ],
            changeSummary: { import: 1, create: 1 },
          }),
        };
      }
      return { stdout: args[0] === "stack" ? JSON.stringify(raw) : "" };
    };
    const env = {
      CLOUDFLARE_ACCOUNT_ID: accountId,
      PULUMI_BACKEND_URL: backendUrl,
      PULUMI_CONFIG_PASSPHRASE: "test",
      AWS_ACCESS_KEY_ID: "test",
      AWS_SECRET_ACCESS_KEY: "test",
    };
    const deps = createEnvironmentDependencies({
      env,
      run,
      cloud: async () => [
        { kind: "worker", name, cloudId },
        {
          kind: "r2",
          name: "savia-pulumi-state-preview",
          cloudId: "savia-pulumi-state-preview",
        },
      ],
      catalog: async () => checkpoints,
    });
    const path = join(directory, "manifest.json");
    await writePrivateJson(path, manifest);
    const result = await runEnvironmentOperation(
      parseEnvironmentArgs([
        "adopt",
        "--environment",
        "preview",
        "--manifest",
        path,
        "--plan",
        join(directory, "plan.json"),
        "--apply",
      ]),
      deps,
    );
    assert.equal(result.status, "adopted");
    assert.equal(calls.filter((row) => row.args[0] === "up").length, 1);
    assert.equal(calls.at(-1).args.includes("false"), true);
    assert.equal(
      calls.some(
        (row) =>
          row.binary === "wrangler" || row.args.includes("--show-secrets"),
      ),
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("retirement cannot unprotect a foreign or retained identity", async () => {
  const { retirementRows } = await import("./environment-operations.mjs");
  const manifest = {
    accountId: "a".repeat(32),
    environment: "preview",
    project: "savia-cloudflare",
    stack: "preview",
    profile: { retentionWorkerNames: ["savia-preview"] },
    resources: [
      { kind: "worker", name: "savia-preview", cloudId: "b".repeat(32) },
    ],
  };
  const row = {
    urn: "urn:pulumi:preview::savia-cloudflare::cloudflare:index/worker:Worker::runtime-savia-preview",
    type: "cloudflare:index/worker:Worker",
    id: "b".repeat(32),
    protect: true,
    inputs: { accountId: manifest.accountId, name: "savia-preview" },
    outputs: { accountId: manifest.accountId, name: "savia-preview" },
  };
  const state = { deployment: { resources: [row] } };
  assert.deepEqual(
    retirementRows(state, manifest, { kind: "workers", names: [] }),
    [],
  );
  assert.throws(
    () =>
      retirementRows(state, manifest, {
        kind: "workers",
        names: ["savia-preview"],
      }),
    /retained/i,
  );
  assert.equal(
    retirementRows(state, manifest, {
      kind: "workers",
      names: ["savia-preview"],
      deleteData: true,
    }).length,
    1,
  );
  assert.throws(
    () => retirementRows(state, manifest, { kind: "data" }),
    /runtime|Worker/i,
  );
  const foreign = structuredClone(state);
  foreign.deployment.resources[0].outputs.accountId = "c".repeat(32);
  assert.throws(
    () =>
      retirementRows(foreign, manifest, {
        kind: "workers",
        names: ["savia-preview"],
        deleteData: true,
      }),
    /account|identity/i,
  );
});

test("concrete retained-data retirement uses one saved engine plan and never empties persistence", async () => {
  const { createEnvironmentDependencies } =
    await import("./environment-operations.mjs");
  const { resolveEnvironment } = await import("./environments.mjs");
  const { adoptionManifestHash } = await import("./environment-manifest.mjs");
  const { writeFile, rm } = await import("node:fs/promises");
  const accountId = "a".repeat(32),
    manifest = {
      version: 1,
      accountId,
      environment: "preview",
      project: "savia-cloudflare",
      stack: "preview",
      profile: { enabledWorkers: ["savia-preview"], retentionWorkerNames: [] },
      resources: [
        { kind: "worker", name: "savia-preview", cloudId: "b".repeat(32) },
      ],
    };
  const prefix = "urn:pulumi:preview::savia-cloudflare::",
    worker = {
      urn: prefix + "cloudflare:index/worker:Worker::runtime-savia-preview",
      type: "cloudflare:index/worker:Worker",
      id: "b".repeat(32),
      protect: true,
      inputs: { accountId, name: "savia-preview" },
      outputs: { accountId, name: "savia-preview" },
    };
  const runtime = {
    urn: prefix + "pulumi-nodejs:dynamic/runtime:RuntimeRelease::runtime",
    type: "pulumi-nodejs:dynamic/runtime:RuntimeRelease",
    id: "runtime",
    inputs: { accountId, environment: "preview", deleteData: false },
    outputs: { accountId, environment: "preview", deleteData: false },
  };
  let state = { deployment: { resources: [worker, runtime] } };
  const calls = [];
  let directory;
  try {
    const deps = createEnvironmentDependencies({
      env: { CLOUDFLARE_ACCOUNT_ID: accountId },
      appliedConfiguration: async () => ({
        "savia-cloudflare:runtimeManaged": { value: "true" },
        "savia-cloudflare:runtimeMode": { value: "adopt" },
        "savia-cloudflare:runtimeProfile": {
          value: JSON.stringify(manifest.profile),
        },
        "savia-cloudflare:adoptionManifest": {
          value: JSON.stringify(manifest),
        },
      }),
      configuration: async () => Buffer.from("encrypted fixture"),
      emptyBucket: async () => assert.fail("emptied data"),
      run: async (_binary, args) => {
        calls.push(args);
        if (args[0] === "stack") return { stdout: JSON.stringify(state) };
        if (args[0] === "state") worker.protect = false;
        if (args[0] === "preview") {
          const file = args[args.indexOf("--save-plan") + 1];
          directory = (await import("node:path")).dirname(file);
          await writeFile(file, "saved retirement plan");
          return {
            stdout: JSON.stringify({
              steps: [worker, runtime].map((row) => ({
                op: "delete",
                urn: row.urn,
                oldState: row,
              })),
              changeSummary: { delete: 2 },
            }),
          };
        }
        if (args[0] === "up") state = { deployment: { resources: [] } };
        return { stdout: "" };
      },
    });
    const result = await deps.retire({
      descriptor: resolveEnvironment("preview"),
      manifest,
      manifestHash: adoptionManifestHash(manifest),
      deleteData: false,
      args: {},
      context: { checkpoint: { stateExport: state } },
    });
    directory = result.journalDir;
    assert.equal(calls.filter((args) => args[0] === "up").length, 1);
    assert.equal(
      calls.find((args) => args[0] === "up").includes("--plan"),
      true,
    );
    assert.equal(
      calls.some(
        (args) =>
          args.includes("--all") ||
          args[0] === "destroy" ||
          args.includes("rm"),
      ),
      false,
    );
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

test("data deletion validates its saved plan before emptying an approved bucket", async () => {
  const { createEnvironmentDependencies } =
    await import("./environment-operations.mjs");
  const { resolveEnvironment } = await import("./environments.mjs");
  const { writeFile, rm } = await import("node:fs/promises");
  for (const illegal of [false, true]) {
    const accountId = "a".repeat(32),
      name = "savia-documents-preview",
      urn =
        "urn:pulumi:preview::savia-cloudflare::cloudflare:index/r2Bucket:R2Bucket::documents",
      row = {
        urn,
        type: "cloudflare:index/r2Bucket:R2Bucket",
        id: name,
        protect: true,
        inputs: { accountId, name },
        outputs: { accountId, name },
      };
    const manifest = {
      version: 1,
      accountId,
      environment: "preview",
      project: "savia-cloudflare",
      stack: "preview",
      profile: { enabledWorkers: [] },
      resources: [{ kind: "r2", name, cloudId: name }],
    };
    let state = { deployment: { resources: [row] } },
      directory;
    const calls = [];
    try {
      const deps = createEnvironmentDependencies({
        env: { CLOUDFLARE_ACCOUNT_ID: accountId },
        configuration: async () => Buffer.from("encrypted fixture"),
        makeClient: () => ({ inspectReferences: async () => [] }),
        emptyBucket: async ({ bucket }) => {
          assert.equal(bucket, name);
          calls.push("empty");
        },
        run: async (_binary, args) => {
          if (args[0] === "stack") return { stdout: JSON.stringify(state) };
          if (args[0] === "state") row.protect = false;
          if (args[0] === "preview") {
            calls.push("preview");
            const file = args[args.indexOf("--save-plan") + 1];
            directory = (await import("node:path")).dirname(file);
            await writeFile(file, "saved data plan");
            return {
              stdout: JSON.stringify({
                steps: [
                  {
                    op: "delete",
                    urn: illegal ? "foreign-urn" : urn,
                    oldState: row,
                  },
                ],
                changeSummary: { delete: 1 },
              }),
            };
          }
          if (args[0] === "up") {
            calls.push("apply");
            assert.ok(args.includes("--plan"));
            state = { deployment: { resources: [] } };
          }
          return { stdout: "" };
        },
      });
      const execution = deps.destroyData({
        descriptor: resolveEnvironment("preview"),
        manifest,
      });
      if (illegal) {
        await assert.rejects(execution, /stopped after/);
        assert.deepEqual(calls, ["preview"]);
      } else {
        await execution;
        assert.deepEqual(calls, ["preview", "empty", "apply"]);
      }
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }
});

test("inventory reads an initialized empty management export without treating it as protected custody", async () => {
  const { createEnvironmentDependencies } =
    await import("./environment-operations.mjs");
  const { normalizeCheckpoint } = await import("./environment-state.mjs");
  const { stateBackendUrl } = await import("./naming.mjs");
  const accountId = "a".repeat(32),
    backendUrl = stateBackendUrl(accountId, "savia-pulumi-state-preview");
  const cp = normalizeCheckpoint({
    qualifiedStack: "organization/savia-management/management",
    backendUrl,
    accountId,
    stateExport: { version: 3, deployment: { manifest: {}, metadata: {} } },
  });
  const deps = createEnvironmentDependencies({
    env: {
      CLOUDFLARE_ACCOUNT_ID: accountId,
      PULUMI_BACKEND_URL: backendUrl,
      PULUMI_CONFIG_PASSPHRASE: "test-only",
      AWS_ACCESS_KEY_ID: "test-only",
      AWS_SECRET_ACCESS_KEY: "test-only",
    },
    cloud: async () => [
      {
        kind: "r2",
        name: "savia-pulumi-state-preview",
        cloudId: "savia-pulumi-state-preview",
        accountId,
      },
    ],
    catalog: async () => [cp],
    run: async () => assert.fail("inventory must not run commands"),
  });
  const result = await deps.inventory("management");
  assert.equal(result.resources.length, 1);
  await assert.rejects(
    deps.context(
      (await import("./environments.mjs")).resolveEnvironment("preview"),
    ),
    /account|protection/,
  );
});

for (const action of [
  "infrastructure",
  "already-adopted",
  "retire",
  "default-reader",
  "secret-cache",
])
  test(`fresh branch checkout restores required configuration for ${action}`, async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { previewNames } =
      await import("../../scripts/preview-environment.mjs");
    const { resolveEnvironment } = await import("./environments.mjs");
    const { createEnvironmentDependencies } =
      await import("./environment-operations.mjs");
    const { adoptionManifestHash } = await import("./environment-manifest.mjs");
    const directory = await mkdtemp(
      join(tmpdir(), "savia-fresh-branch-config-"),
    );
    const accountId = "a".repeat(32),
      slug = "feat-config-check",
      names = previewNames(slug),
      descriptor = resolveEnvironment(`branch-${slug}`);
    const workerName = names.workers.gateway;
    const resources = [
      { kind: "worker", name: workerName, cloudId: "b".repeat(32) },
      {
        kind: "d1",
        name: names.databases.auth,
        cloudId: "11111111-1111-4111-8111-111111111111",
      },
      {
        kind: "d1",
        name: names.databases.domain,
        cloudId: "22222222-2222-4222-8222-222222222222",
      },
      { kind: "r2", name: names.bucket, cloudId: names.bucket },
    ];
    const manifest = {
      version: 1,
      accountId,
      environment: descriptor.environment,
      project: descriptor.project,
      stack: descriptor.stack,
      profile: { enabledWorkers: [workerName], retentionWorkerNames: [] },
      resources,
    };
    const prefix = `urn:pulumi:${descriptor.stack}::${descriptor.project}::`;
    const workerUrn =
        prefix + "cloudflare:index/worker:Worker::runtime-" + workerName,
      runtimeUrn =
        prefix + "pulumi-nodejs:dynamic/runtime:RuntimeRelease::runtime";
    let state = {
      version: 3,
      deployment: {
        resources: [
          {
            type: "pulumi:pulumi:Stack",
            urn:
              prefix +
              `pulumi:pulumi:Stack::${descriptor.project}-${descriptor.stack}`,
            outputs: { runtimeStatus: "active" },
          },
          {
            type: "cloudflare:index/worker:Worker",
            urn: workerUrn,
            id: resources[0].cloudId,
            protect: true,
            inputs: { accountId, name: workerName },
            outputs: { accountId, name: workerName },
          },
          {
            type: "pulumi-nodejs:dynamic/runtime:RuntimeRelease",
            urn: runtimeUrn,
            id: "runtime",
            inputs: {
              accountId,
              environment: descriptor.environment,
              mode: "adopt",
              adoptionManifest: manifest,
            },
          },
        ],
      },
    };
    const cfg = new Map(),
      calls = [];
    const required = () => {
      for (const key of [
        "accountId",
        "branchSlug",
        "authDatabaseName",
        "domainDatabaseName",
        "bucketName",
        "runtimeManaged",
        "runtimeProfile",
        "adoptionManifest",
      ])
        assert.ok(cfg.has(key), `fresh checkout missing ${key}`);
      assert.equal(cfg.get("accountId"), accountId);
      assert.equal(cfg.get("branchSlug"), slug);
      assert.equal(cfg.get("authDatabaseName"), names.databases.auth);
      assert.equal(cfg.get("domainDatabaseName"), names.databases.domain);
      assert.equal(cfg.get("bucketName"), names.bucket);
      assert.equal(cfg.get("runtimeManaged"), "true");
      assert.equal(cfg.get("importRuntimeWorkers"), "false");
      assert.equal(cfg.get("importAuthD1Id"), "");
      assert.equal(cfg.get("importDomainD1Id"), "");
      assert.equal(cfg.get("importBucketId"), "");
      assert.equal(cfg.has("apiToken"), false);
    };
    const cache = Object.fromEntries(
      Object.entries({
        runtimeManaged: true,
        runtimeMode: "adopt",
        runtimeProfile: manifest.profile,
        adoptionManifest: manifest,
        importRuntimeWorkers: true,
        importAuthD1Id: "old-import-only",
        apiToken: "DO_NOT_COPY",
      }).map(([key, value]) => [
        `${descriptor.project}:${key}`,
        {
          value:
            typeof value === "object" ? JSON.stringify(value) : String(value),
          secret: key === "apiToken",
        },
      ]),
    );
    if (action === "secret-cache")
      cache[`${descriptor.project}:runtimeProfile`].secret = true;
    let snapshotPath;
    const deps = createEnvironmentDependencies({
      env: { CLOUDFLARE_ACCOUNT_ID: accountId },
      appliedConfiguration:
        action === "default-reader" ? undefined : async () => cache,
      configuration: async () => {
        required();
        return Buffer.from("private configuration");
      },
      run: async (binary, args) => {
        calls.push({ binary, args });
        if (binary === "git") return { stdout: "a".repeat(40) };
        assert.equal(binary, "pulumi");
        if (args[0] === "config" && args[1] === "refresh") {
          assert.equal(
            args[args.indexOf("--stack") + 1],
            `organization/${descriptor.project}/${descriptor.stack}`,
          );
          snapshotPath = args[args.indexOf("--config-file") + 1];
          assert.ok(snapshotPath.endsWith("configuration.private.yaml"));
          await (
            await import("node:fs/promises")
          ).writeFile(snapshotPath, "encrypted snapshot");
          return { stdout: "" };
        }
        if (args[0] === "config" && args[1] === "--json") {
          assert.equal(args.includes("--show-secrets"), false);
          assert.equal(args[args.indexOf("--config-file") + 1], snapshotPath);
          return { stdout: JSON.stringify(cache) };
        }
        if (args[0] === "config" && args[1] === "set") {
          cfg.set(args[2].split(":").at(-1), args[3]);
          return { stdout: "" };
        }
        if (args[0] === "config" && args[1] === "rm") {
          cfg.delete(args[2].split(":").at(-1));
          return { stdout: "" };
        }
        if (args[0] === "stack" && args[1] === "export")
          return { stdout: JSON.stringify(state) };
        if (args[0] === "state" && args[1] === "unprotect") {
          required();
          return { stdout: "" };
        }
        if (args[0] === "preview") {
          required();
          const file = args[args.indexOf("--save-plan") + 1];
          await (
            await import("node:fs/promises")
          ).writeFile(file, "saved engine plan");
          return {
            stdout: JSON.stringify({
              changeSummary: action === "retire" ? { delete: 2 } : { same: 1 },
              steps:
                action === "retire"
                  ? [workerUrn, runtimeUrn].map((urn) => ({
                      op: "delete",
                      urn,
                      oldState: state.deployment.resources.find(
                        (r) => r.urn === urn,
                      ),
                    }))
                  : [
                      {
                        op: "same",
                        urn: prefix + "root",
                        newState: { type: "pulumi:pulumi:Stack" },
                      },
                    ],
            }),
          };
        }
        if (args[0] === "up") {
          state = {
            ...state,
            deployment: {
              resources: state.deployment.resources.filter(
                (r) => ![workerUrn, runtimeUrn].includes(r.urn),
              ),
            },
          };
          return { stdout: "{}" };
        }
        assert.fail(`unexpected command ${args.slice(0, 2).join(" ")}`);
      },
    });
    const context = {
      qualifiedStack: `organization/${descriptor.project}/${descriptor.stack}`,
      checkpoint: { stateExport: state, resources },
      management: {},
      backendUrl: "private",
    };
    let result;
    try {
      if (action === "secret-cache") {
        await assert.rejects(
          deps.planOperation({
            descriptor,
            manifest,
            manifestHash: adoptionManifestHash(manifest),
            operation: "infrastructure",
            args: {},
            context,
          }),
          /public metadata/,
        );
        assert.equal(
          calls.some(
            (x) =>
              ["set", "preview", "up"].includes(x.args[1]) ||
              ["preview", "up"].includes(x.args[0]),
          ),
          false,
        );
        return;
      }
      if (action === "already-adopted")
        assert.equal(
          await deps.alreadyAdopted({ descriptor, manifest, context }),
          true,
        );
      else if (action === "retire")
        result = await deps.retire({
          descriptor,
          manifest,
          manifestHash: adoptionManifestHash(manifest),
          deleteData: false,
          args: {},
          context,
        });
      else
        await deps.planOperation({
          descriptor,
          manifest,
          manifestHash: adoptionManifestHash(manifest),
          operation: "infrastructure",
          args: { plan: join(directory, "reviewed.json") },
          context,
        });
      required();
      if (action === "default-reader")
        await assert.rejects(
          (await import("node:fs/promises")).stat(snapshotPath),
          { code: "ENOENT" },
        );
      if (action !== "retire")
        assert.equal(
          calls.some((x) => x.args[0] === "up"),
          false,
        );
    } finally {
      await rm(directory, { recursive: true, force: true });
      if (result?.journalDir)
        await rm(result.journalDir, { recursive: true, force: true });
    }
  });
