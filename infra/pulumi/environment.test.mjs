import test from "node:test";
import assert from "node:assert/strict";
import {
  parseEnvironmentArgs,
  runEnvironmentOperation,
} from "./environment.mjs";
import { stateBackendUrl } from "./naming.mjs";
import { adoptionManifestHash } from "./environment-manifest.mjs";
const accountId = "a".repeat(32);
const manifest = {
  version: 1,
  accountId,
  environment: "preview",
  project: "savia-cloudflare",
  stack: "preview",
  profile: { enabledWorkers: ["savia-preview"] },
  resources: [
    { kind: "worker", name: "savia-preview", cloudId: "b".repeat(32) },
  ],
};
function dependencies() {
  const calls = [];
  return {
    calls,
    env: { CLOUDFLARE_ACCOUNT_ID: accountId },
    inventory: async () => ({ ...manifest, status: "present" }),
    inventoryAll: async () => [],
    readManifest: async () => manifest,
    context: async () => ({
      checkpoints: [],
      backendUrl: stateBackendUrl(accountId, "savia-pulumi-state-preview"),
      management: {
        accountId,
        backendBuckets: ["savia-pulumi-state-preview"],
        protected: true,
        checkpoint: {
          deployment: {
            resources: [
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
        },
      },
    }),
    planOperation: async (options) => {
      calls.push("plan");
      return {
        accountId,
        environment: "preview",
        operation: options.operation,
        manifestHash: options.manifestHash,
        steps: [{ op: "same", type: "worker" }],
      };
    },
    applyPlan: async () => calls.push("apply"),
    alreadyAdopted: async () => false,
    inspectReferences: async () => [],
    retire: async () => calls.push("retire"),
    destroyData: async () => calls.push("data"),
    readSavedPlan: async () => ({ accountId, environment: "other" }),
  };
}
test("lifecycle requires exact targets and rejects wildcard mutations", () => {
  for (const argv of [
    ["destroy", "--all", "--apply"],
    ["apply"],
    ["plan", "--environment", "qa"],
    ["adopt", "--environment", "preview"],
    ["apply", "--environment", "preview", "--artifact", "/x"],
    ["destroy", "--environment", "preview", "--manifest", "/x", "--wat"],
  ])
    assert.throws(() => parseEnvironmentArgs(argv));
  assert.equal(parseEnvironmentArgs(["inventory", "--all"]).all, true);
  assert.equal(
    parseEnvironmentArgs([
      "destroy",
      "--environment",
      "preview",
      "--manifest",
      "/x",
      "--apply",
    ]).deleteData,
    false,
  );
  assert.deepEqual(
    parseEnvironmentArgs([
      "apply",
      "--environment",
      "production",
      "--provision",
      "--plan",
      "/saved-provision.json",
      "--apply",
    ]),
    {
      action: "apply",
      environment: "production",
      all: false,
      manifest: undefined,
      artifact: undefined,
      plan: "/saved-provision.json",
      out: undefined,
      apply: true,
      deleteData: false,
      provision: true,
    },
  );
  assert.throws(() =>
    parseEnvironmentArgs([
      "apply",
      "--environment",
      "production",
      "--provision",
      "--artifact",
      "/release",
      "--plan",
      "/saved.json",
      "--apply",
    ]),
  );
});
test("read-only production inventory reports absence without initializing it", async () => {
  const deps = dependencies();
  deps.inventory = async () => ({
    status: "defined-not-deployed",
    resources: [],
  });
  const result = await runEnvironmentOperation(
    parseEnvironmentArgs(["inventory", "--environment", "production"]),
    deps,
  );
  assert.equal(result.status, "defined-not-deployed");
  assert.deepEqual(deps.calls, []);
});
test("adoption refuses a mutating plan and a second adoption cannot import or publish again", async () => {
  const deps = dependencies(),
    args = parseEnvironmentArgs([
      "adopt",
      "--environment",
      "preview",
      "--manifest",
      "/x",
      "--apply",
    ]);
  deps.planOperation = async () => ({
    accountId,
    environment: "preview",
    operation: "adopt",
    steps: [{ op: "delete", name: "savia-preview" }],
  });
  await assert.rejects(
    runEnvironmentOperation(args, deps),
    /adoption|mutating/i,
  );
  assert.deepEqual(deps.calls, []);
  deps.alreadyAdopted = async () => true;
  assert.equal(
    (await runEnvironmentOperation(args, deps)).status,
    "already-adopted",
  );
  assert.deepEqual(deps.calls, []);
});
test("production mutation gates and missing management custody fail before planning", async () => {
  const deps = dependencies();
  await assert.rejects(
    runEnvironmentOperation(
      parseEnvironmentArgs([
        "destroy",
        "--environment",
        "production",
        "--manifest",
        "/x",
        "--apply",
      ]),
      deps,
    ),
    /production.*disabled/i,
  );
  deps.context = async () => ({
    management: {},
    checkpoints: [],
    backendUrl: stateBackendUrl(accountId, "savia-pulumi-state-preview"),
  });
  await assert.rejects(
    runEnvironmentOperation(
      parseEnvironmentArgs([
        "adopt",
        "--environment",
        "preview",
        "--manifest",
        "/x",
      ]),
      deps,
    ),
    /management/i,
  );
  assert.deepEqual(deps.calls, []);
});
test("destruction retains data by default, refuses foreign callers and always retires before deleting data", async () => {
  const deps = dependencies(),
    argv = [
      "destroy",
      "--environment",
      "preview",
      "--manifest",
      "/x",
      "--apply",
    ];
  await runEnvironmentOperation(parseEnvironmentArgs(argv), deps);
  assert.deepEqual(deps.calls, ["retire"]);
  deps.calls.length = 0;
  await runEnvironmentOperation(
    parseEnvironmentArgs([...argv, "--delete-data"]),
    deps,
  );
  assert.deepEqual(deps.calls, ["retire", "data"]);
  deps.calls.length = 0;
  deps.inspectReferences = async () => [
    { caller: "other-product", target: "savia-preview" },
  ];
  await assert.rejects(
    runEnvironmentOperation(parseEnvironmentArgs(argv), deps),
    /foreign|outside/i,
  );
  assert.deepEqual(deps.calls, []);
  for (const target of ["shared", "management"])
    await assert.rejects(
      runEnvironmentOperation(
        parseEnvironmentArgs([
          "destroy",
          "--environment",
          target,
          "--manifest",
          "/x",
          "--apply",
        ]),
        deps,
      ),
      /protected/i,
    );
});
test("saved plan identity cannot be substituted at apply time", async () => {
  const deps = dependencies();
  await assert.rejects(
    runEnvironmentOperation(
      parseEnvironmentArgs([
        "apply",
        "--environment",
        "preview",
        "--manifest",
        "/x",
        "--artifact",
        "/frozen",
        "--plan",
        "/saved",
        "--apply",
      ]),
      deps,
    ),
    /plan.*identity|identity.*plan/i,
  );
  assert.deepEqual(deps.calls, []);
});

test("explicit infrastructure provisioning cannot remove an active or retained runtime", async () => {
  const args = parseEnvironmentArgs([
      "plan",
      "--environment",
      "preview",
      "--provision",
      "--apply",
    ]),
    deps = dependencies();
  assert.equal(args.provision, true);
  await assert.rejects(
    runEnvironmentOperation(args, deps),
    /runtime|adopt|empty environment/i,
  );
  assert.deepEqual(deps.calls, []);
  deps.inventory = async () => ({
    ...manifest,
    resources: [],
    profile: { enabledWorkers: [] },
  });
  await runEnvironmentOperation(args, deps);
  assert.deepEqual(deps.calls, ["plan", "apply"]);
  assert.throws(() =>
    parseEnvironmentArgs([
      "destroy",
      "--environment",
      "preview",
      "--manifest",
      "/x",
      "--provision",
      "--apply",
    ]),
  );
});

test("saved provision plan applies only when explicitly selected and binds the empty manifest", async () => {
  const deps = dependencies();
  const emptyProduction = {
    version: 1,
    accountId,
    environment: "production",
    project: "savia-cloudflare",
    stack: "production",
    profile: { enabledWorkers: [] },
    resources: [],
  };
  deps.env = {
    ...deps.env,
    PRODUCTION_OPERATIONS_ENABLED: "true",
    GITHUB_REF: "refs/heads/main",
  };
  deps.inventory = async () => ({
    ...emptyProduction,
    status: "defined-not-deployed",
  });
  const savedProvision = {
    accountId,
    environment: "production",
    operation: "provision",
    manifest: emptyProduction,
    manifestHash: adoptionManifestHash(emptyProduction),
  };
  let appliedPlan;
  deps.readSavedPlan = async () => savedProvision;
  deps.applyPlan = async (plan) => {
    appliedPlan = plan;
    deps.calls.push("apply");
  };
  const apply = parseEnvironmentArgs([
    "apply",
    "--environment",
    "production",
    "--provision",
    "--plan",
    "/saved-provision.json",
    "--apply",
  ]);
  await runEnvironmentOperation(apply, deps);
  assert.deepEqual(deps.calls, ["apply"]);
  assert.equal(appliedPlan, savedProvision);

  deps.calls.length = 0;
  await assert.rejects(
    runEnvironmentOperation(
      parseEnvironmentArgs([
        "apply",
        "--environment",
        "production",
        "--plan",
        "/saved-provision.json",
        "--artifact",
        "/release",
        "--apply",
      ]),
      deps,
    ),
    /identity|operation|provision/i,
  );
  assert.deepEqual(deps.calls, []);
});
