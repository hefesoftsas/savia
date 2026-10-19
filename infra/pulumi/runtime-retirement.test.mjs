import test from "node:test";
import assert from "node:assert/strict";
import { planRuntimeRetirement, retireRuntime } from "./runtime-retirement.mjs";

const manifest = {
  accountId: "a".repeat(32),
  environment: "preview",
  resources: [
    { kind: "worker", name: "savia-preview", cloudId: "b".repeat(32) },
    { kind: "worker", name: "savia-agencies-preview", cloudId: "c".repeat(32) },
    {
      kind: "durableObject",
      name: "savia-agencies-preview_RealtimeHub",
      cloudId: "d".repeat(32),
      parentWorker: "savia-agencies-preview",
    },
    { kind: "d1", name: "savia-agencies-preview", cloudId: "db" },
  ],
};

test("data-preserving retirement retains namespace hosts, not every Worker", () => {
  const plan = planRuntimeRetirement(manifest, { deleteData: false });
  assert.deepEqual(plan.retainedWorkers, ["savia-agencies-preview"]);
  assert.deepEqual(plan.deletedWorkers, ["savia-preview"]);
  assert.equal(plan.deleteData, false);
  assert.deepEqual(plan.retainedNamespaces, ["d".repeat(32)]);
  assert.deepEqual(
    planRuntimeRetirement(manifest, { deleteData: true }).deletedWorkers,
    ["savia-agencies-preview", "savia-preview"],
  );
  assert.throws(
    () => planRuntimeRetirement(manifest, { deleteData: "false" }),
    /boolean/,
  );
});

test("an unattached namespace or foreign caller fails before any mutation", async () => {
  assert.throws(
    () =>
      planRuntimeRetirement({
        ...manifest,
        resources: [
          ...manifest.resources,
          {
            kind: "durableObject",
            name: "alien",
            cloudId: "e".repeat(32),
            parentWorker: "other",
          },
        ],
      }),
    /host/,
  );
  const calls = [];
  await assert.rejects(
    retireRuntime(
      {},
      { manifest },
      {
        inspectReferences: async () => [
          { caller: "other-product", target: "savia-preview" },
        ],
        stopProducers: async () => calls.push("stop"),
      },
    ),
    /outside/,
  );
  assert.deepEqual(calls, []);
});

test("retirement quiesces first and preserves namespace IDs after maintenance", async () => {
  const calls = [];
  const deps = Object.fromEntries(
    [
      "stopProducers",
      "removeIngress",
      "maintainHosts",
      "detachReferences",
      "removeWorkflows",
    ].map((name) => [
      name,
      async (plan) => {
        calls.push(name);
        assert.deepEqual(plan.retainedWorkers, ["savia-agencies-preview"]);
      },
    ]),
  );
  deps.inspectReferences = async () => [];
  deps.readNamespaces = async () => [
    { namespaceId: "d".repeat(32), workerName: "savia-agencies-preview" },
  ];
  const result = await retireRuntime({}, { manifest }, deps);
  assert.equal(result.status, "maintenance");
  assert.deepEqual(calls, [
    "stopProducers",
    "removeIngress",
    "maintainHosts",
    "detachReferences",
    "removeWorkflows",
  ]);
  deps.readNamespaces = async () => [];
  await assert.rejects(retireRuntime({}, { manifest }, deps), /namespace/);
});

test("shared and management are excluded from application retirement", () => {
  for (const environment of ["shared", "management"])
    assert.throws(
      () => planRuntimeRetirement({ ...manifest, environment }),
      /protected/,
    );
});

test("opaque encryption-key hosts survive data-preserving retirement", () => {
  const withKeyHost = {
    ...manifest,
    resources: [
      ...manifest.resources,
      {
        kind: "worker",
        name: "savia-request-preview",
        cloudId: "f".repeat(32),
      },
    ],
  };
  const plan = planRuntimeRetirement(withKeyHost, {
    retainWorkers: ["savia-request-preview"],
  });
  assert.deepEqual(plan.retainedWorkers, [
    "savia-agencies-preview",
    "savia-request-preview",
  ]);
  assert.deepEqual(plan.deletedWorkers, ["savia-preview"]);
  assert.throws(
    () =>
      planRuntimeRetirement(withKeyHost, { retainWorkers: ["other-product"] }),
    /retained|outside/,
  );
});
