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
