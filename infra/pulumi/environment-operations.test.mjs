import test from "node:test";
import assert from "node:assert/strict";
import { verifySavedEnvironmentPlan } from "./environment-operations.mjs";
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
                  id: cloudId,
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
