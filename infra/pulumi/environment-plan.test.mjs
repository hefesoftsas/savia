import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEnvironmentPlan } from "./environment-plan.mjs";
import {
  assertAdoptionPlan,
  adoptionManifestHash,
} from "./environment-manifest.mjs";
const accountId = "a".repeat(32),
  manifest = {
    accountId,
    environment: "preview",
    resources: [
      { kind: "worker", name: "savia-preview", cloudId: "b".repeat(32) },
      {
        kind: "vectorize",
        name: "savia-pages-search-preview",
        cloudId: "savia-pages-search-preview",
      },
    ],
  };
test("actual dynamic resource plan types normalize to read-only adoption bookkeeping", () => {
  const plan = normalizeEnvironmentPlan({
    steps: [
      {
        op: "create",
        urn: "runtime",
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
      {
        op: "create",
        urn: "index",
        newState: {
          type: "pulumi-nodejs:dynamic/vectorize:Index",
          inputs: {
            accountId,
            environment: "preview",
            name: "savia-pages-search-preview",
            dimensions: 1024,
            metric: "cosine",
            adoptExisting: true,
            deleteData: false,
          },
        },
      },
    ],
    changeSummary: { create: 2 },
  });
  assert.equal(plan.steps[0].manifestHash, adoptionManifestHash(manifest));
  assert.equal(assertAdoptionPlan(plan, manifest), true);
  plan.steps[1].adoptExisting = false;
  assert.throws(() => assertAdoptionPlan(plan, manifest));
});
test("native Worker imports use actual matching physical IDs rather than name guesses", () => {
  const plan = normalizeEnvironmentPlan({
    steps: [
      {
        op: "import",
        newState: {
          type: "cloudflare:index/worker:Worker",
          id: "b".repeat(32),
          inputs: { accountId, name: "savia-preview" },
        },
      },
    ],
    changeSummary: { import: 1 },
  });
  assert.equal(assertAdoptionPlan(plan, manifest), true);
  plan.steps[0].cloudId = "c".repeat(32);
  assert.throws(() => assertAdoptionPlan(plan, manifest));
});

test("retirement permits only reviewed deletions and isolated data-delete authorization", async () => {
  const { assertRetirementPlan } = await import("./environment-plan.mjs");
  assert.equal(
    assertRetirementPlan(
      {
        steps: [
          {
            op: "delete",
            urn: "owned-worker",
            type: "cloudflare:index/worker:Worker",
          },
        ],
      },
      { allowedDeletes: ["owned-worker"] },
    ),
    true,
  );
  for (const step of [
    { op: "delete", urn: "another-worker" },
    { op: "replace", urn: "owned-worker" },
    { op: "update", urn: "owned-worker" },
  ])
    assert.throws(() =>
      assertRetirementPlan(
        { steps: [step] },
        { allowedDeletes: ["owned-worker"] },
      ),
    );
  assert.equal(
    assertRetirementPlan(
      {
        steps: [
          {
            op: "update",
            urn: "runtime",
            deleteData: true,
            inputChanges: ["deleteData"],
          },
        ],
      },
      { allowedDeletes: [], authorizeRuntime: "runtime" },
    ),
    true,
  );
  assert.throws(() =>
    assertRetirementPlan(
      {
        steps: [
          {
            op: "update",
            urn: "runtime",
            deleteData: true,
            inputChanges: ["artifactDigest"],
          },
        ],
      },
      { allowedDeletes: [], authorizeRuntime: "runtime" },
    ),
  );
});

// Pulumi 3.268 dry imports contain importID and no resolved resource id/outputs.
for (const [kind, type, name, id, inputKey] of [
  ["worker", "worker:Worker", "savia-preview", "b".repeat(32), "name"],
  ["d1", "d1Database:D1Database", "savia-auth-preview", "b".repeat(32), "name"],
  [
    "r2",
    "r2Bucket:R2Bucket",
    "savia-documents-preview",
    "savia-documents-preview",
    "name",
  ],
  [
    "kv",
    "workersKvNamespace:WorkersKvNamespace",
    "savia-flows-preview",
    "b".repeat(32),
    "title",
  ],
  ["queue", "queue:Queue", "savia-flows-preview", "b".repeat(32), "queueName"],
])
  test(`planned ${kind} import resolves its exact reviewed account-qualified importID`, () => {
    const physicalImport =
      kind === "r2" ? `${accountId}/${name}/default` : `${accountId}/${id}`;
    const raw = {
      changeSummary: { import: 1 },
      steps: [
        {
          op: "import",
          newState: {
            type: `cloudflare:index/${type}`,
            importID: physicalImport,
            inputs: { accountId, [inputKey]: name },
          },
        },
      ],
    };
    const m = { ...manifest, resources: [{ kind, name, cloudId: id }] };
    const plan = normalizeEnvironmentPlan(raw);
    assert.equal(plan.steps[0].cloudId, id);
    assert.equal(assertAdoptionPlan(plan, m), true);
    const foreign = structuredClone(raw);
    foreign.steps[0].newState.importID = physicalImport.replace(
      accountId,
      "c".repeat(32),
    );
    assert.throws(() =>
      assertAdoptionPlan(normalizeEnvironmentPlan(foreign), m),
    );
    const foreignBoth = structuredClone(foreign);
    foreignBoth.steps[0].newState.inputs.accountId = "c".repeat(32);
    assert.throws(() =>
      assertAdoptionPlan(normalizeEnvironmentPlan(foreignBoth), m),
    );
    const extra = structuredClone(raw);
    extra.steps[0].newState.importID += "/unexpected";
    assert.throws(() => normalizeEnvironmentPlan(extra));
    const conflicting = structuredClone(raw);
    conflicting.steps[0].newState.id = "unexpected-id";
    assert.throws(() => normalizeEnvironmentPlan(conflicting));
    const outputConflict = structuredClone(raw);
    outputConflict.steps[0].newState.outputs = { id: "unexpected-id" };
    assert.throws(() => normalizeEnvironmentPlan(outputConflict));
    const outputAccount = structuredClone(raw);
    outputAccount.steps[0].newState.outputs = { accountId: "c".repeat(32) };
    assert.throws(() => normalizeEnvironmentPlan(outputAccount));
  });
