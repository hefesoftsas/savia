import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  transformCheckpoint,
  validateImportedCheckpoint,
  validateTransformedCheckpoint,
} from "./retire-vector-state.mjs";

const targetUrn =
  "urn:pulumi:preview::savia-cloudflare::pulumi-nodejs:dynamic/vectorize:Index::pages-search";
const stackUrn =
  "urn:pulumi:preview::savia-cloudflare::pulumi:pulumi:Stack::savia-cloudflare-preview";
const providerUrn =
  "urn:pulumi:preview::savia-cloudflare::pulumi:providers:pulumi-nodejs::default";
const runtimeUrn =
  "urn:pulumi:preview::savia-cloudflare::pulumi-nodejs:dynamic/runtime:RuntimeRelease::runtime";
const encryptedMarker = { secure: "ciphertext-that-must-remain-byte-for-byte" };
const targetResource = {
  urn: targetUrn,
  type: "pulumi-nodejs:dynamic/vectorize:Index",
  id: "account/savia-pages-search-preview",
  protect: true,
  inputs: { name: "savia-pages-search-preview" },
  outputs: { name: "savia-pages-search-preview" },
};

function exportCheckpoint() {
  const targetEntry = {
    kind: "vectorize",
    name: "savia-pages-search-preview",
    cloudId: "savia-pages-search-preview",
  };
  const workerEntry = {
    kind: "worker",
    name: "savia-preview",
    cloudId: "worker-id",
  };
  const manifest = JSON.stringify({
    version: 1,
    resources: [workerEntry, targetEntry],
  });
  const provider = {
    urn: providerUrn,
    type: "pulumi:providers:pulumi-nodejs",
    inputs: {
      "savia-cloudflare:pagesSearchIndex": "savia-pages-search-preview",
      "savia-cloudflare:adoptionManifest": manifest,
      encryptedMarker,
    },
    outputs: {
      "savia-cloudflare:pagesSearchIndex": "savia-pages-search-preview",
      "savia-cloudflare:adoptionManifest": manifest,
      encryptedMarker,
    },
  };
  const runtime = {
    urn: runtimeUrn,
    type: "pulumi-nodejs:dynamic/runtime:RuntimeRelease",
    id: "account/preview",
    dependencies: [targetUrn],
    propertyDependencies: { vectorizeIndex: [targetUrn] },
    inputs: {
      adoptionManifest: { version: 1, resources: [workerEntry, targetEntry] },
      encryptedMarker,
    },
    outputs: {
      adoptionManifest: { version: 1, resources: [workerEntry, targetEntry] },
      encryptedMarker,
    },
  };
  const root = {
    urn: stackUrn,
    type: "pulumi:pulumi:Stack",
    outputs: {
      vectorizeIndex: "savia-pages-search-preview",
      environmentInventory: { resources: [workerEntry, targetEntry] },
      encryptedMarker,
    },
  };
  return {
    version: 3,
    secrets_providers: {
      type: "passphrase",
      state: { salt: "encrypted-salt" },
    },
    deployment: {
      manifest: { time: "checkpoint-meta" },
      resources: [root, provider, runtime, targetResource],
    },
  };
}

test("transforms only the fixed vector index and its allowlisted configuration references", () => {
  const before = exportCheckpoint();
  const { checkpoint: after, report } = transformCheckpoint(before, {
    targetUrn,
  });
  validateTransformedCheckpoint(before, after, { targetUrn });
  assert.deepEqual(after.secrets_providers, before.secrets_providers);
  assert.deepEqual(after.deployment.manifest, before.deployment.manifest);
  const resources = after.deployment.resources;
  assert.equal(
    resources.some((resource) => resource.urn === targetUrn),
    false,
  );
  assert.equal(
    resources.find((resource) => resource.urn === stackUrn).outputs
      .vectorizeIndex,
    null,
  );
  assert.equal(
    resources.find((resource) => resource.urn === stackUrn).outputs
      .environmentInventory.resources.length,
    1,
  );
  const provider = resources.find((resource) => resource.urn === providerUrn);
  assert.equal("savia-cloudflare:pagesSearchIndex" in provider.inputs, false);
  assert.equal("savia-cloudflare:pagesSearchIndex" in provider.outputs, false);
  for (const field of [
    provider.inputs["savia-cloudflare:adoptionManifest"],
    provider.outputs["savia-cloudflare:adoptionManifest"],
  ])
    assert.deepEqual(
      JSON.parse(field).resources.map((entry) => entry.kind),
      ["worker"],
    );
  const runtime = resources.find((resource) => resource.urn === runtimeUrn);
  assert.deepEqual(runtime.dependencies, []);
  assert.equal(runtime.propertyDependencies, undefined);
  assert.deepEqual(
    runtime.inputs.adoptionManifest.resources.map((entry) => entry.kind),
    ["worker"],
  );
  assert.deepEqual(
    runtime.outputs.adoptionManifest.resources.map((entry) => entry.kind),
    ["worker"],
  );
  assert.deepEqual(provider.inputs.encryptedMarker, encryptedMarker);
  assert.deepEqual(provider.outputs.encryptedMarker, encryptedMarker);
  assert.deepEqual(runtime.inputs.encryptedMarker, encryptedMarker);
  assert.deepEqual(runtime.outputs.encryptedMarker, encryptedMarker);
  assert.deepEqual(
    resources.find((resource) => resource.urn === stackUrn).outputs
      .encryptedMarker,
    encryptedMarker,
  );
  assert.deepEqual(report, {
    removedResources: 1,
    removedDependencyReferences: 2,
    nulledIndexOutputs: 1,
    removedIndexConfigReferences: 2,
    removedInventoryEntries: 1,
    removedManifestEntries: 4,
    changedPaths: [
      targetUrn,
      `${stackUrn}.outputs.vectorizeIndex`,
      `${stackUrn}.outputs.environmentInventory.resources`,
      `${providerUrn}.inputs.savia-cloudflare:pagesSearchIndex`,
      `${providerUrn}.inputs.savia-cloudflare:adoptionManifest.resources`,
      `${providerUrn}.outputs.savia-cloudflare:pagesSearchIndex`,
      `${providerUrn}.outputs.savia-cloudflare:adoptionManifest.resources`,
      `${runtimeUrn}.inputs.adoptionManifest.resources`,
      `${runtimeUrn}.outputs.adoptionManifest.resources`,
      `${runtimeUrn}.dependencies`,
      `${runtimeUrn}.propertyDependencies`,
    ],
  });
});

test("refuses unrecognized target references and unsupported manifest data", () => {
  const unknownReference = exportCheckpoint();
  unknownReference.deployment.resources[0].outputs.unrecognized =
    "savia-pages-search-preview";
  assert.throws(
    () => transformCheckpoint(unknownReference, { targetUrn }),
    /unrecognized reference/,
  );

  const malformedManifest = exportCheckpoint();
  const provider = malformedManifest.deployment.resources.find(
    (resource) => resource.urn === providerUrn,
  );
  provider.inputs["savia-cloudflare:adoptionManifest"] = "not-json";
  assert.throws(
    () => transformCheckpoint(malformedManifest, { targetUrn }),
    /manifest is not valid JSON/,
  );

  const unknownUrn = exportCheckpoint();
  unknownUrn.deployment.resources[0].outputs.unrecognizedUrn = targetUrn;
  assert.throws(
    () => transformCheckpoint(unknownUrn, { targetUrn }),
    /unrecognized reference/,
  );
});

test("refuses checkpoints with pending operations", () => {
  const pending = exportCheckpoint();
  pending.deployment.pending_operations = [{ type: "delete" }];
  assert.throws(
    () => transformCheckpoint(pending, { targetUrn }),
    /pending operations/,
  );

  const duplicateTarget = exportCheckpoint();
  duplicateTarget.deployment.resources[0].outputs.environmentInventory.resources.push(
    {
      kind: "vectorize",
      name: "savia-pages-search-preview",
      cloudId: "savia-pages-search-preview",
    },
  );
  assert.throws(
    () => transformCheckpoint(duplicateTarget, { targetUrn }),
    /exactly one target index/,
  );
});

test("rejects an imported checkpoint that differs from the validated candidate", () => {
  const before = exportCheckpoint();
  const { checkpoint: candidate } = transformCheckpoint(before, { targetUrn });
  assert.equal(
    validateImportedCheckpoint(candidate, structuredClone(candidate), {
      targetUrn,
    }),
    true,
  );

  const unexpectedMutation = structuredClone(candidate);
  unexpectedMutation.deployment.resources.find(
    (resource) => resource.urn === runtimeUrn,
  ).id = "changed";
  assert.throws(
    () =>
      validateImportedCheckpoint(candidate, unexpectedMutation, { targetUrn }),
    /imported checkpoint differs from candidate/,
  );

  const changedSecretsProvider = structuredClone(candidate);
  changedSecretsProvider.secrets_providers.state.salt = "changed";
  assert.throws(
    () =>
      validateImportedCheckpoint(candidate, changedSecretsProvider, {
        targetUrn,
      }),
    /changed the secrets provider state/,
  );
});

test("accepts imported checkpoints with only JSON object-key reordering", () => {
  const before = exportCheckpoint();
  const { checkpoint: candidate } = transformCheckpoint(before, { targetUrn });
  const imported = structuredClone(candidate);
  imported.deployment.resources = imported.deployment.resources.map(
    (resource) => Object.fromEntries(Object.entries(resource).reverse()),
  );
  imported.deployment = Object.fromEntries(
    Object.entries(imported.deployment).reverse(),
  );
  assert.equal(
    validateTransformedCheckpoint(before, imported, { targetUrn }),
    true,
  );
  assert.equal(
    validateImportedCheckpoint(candidate, imported, { targetUrn }),
    true,
  );
});

const pulumiBinary = process.env.PULUMI_BIN ?? "pulumi";
const pulumiVersionResult = spawnSync(pulumiBinary, ["version"], {
  encoding: "utf8",
});
const pulumiVersion =
  pulumiVersionResult.status === 0 ? pulumiVersionResult.stdout.trim() : null;

test(
  "Pulumi 3.268.0 import/export key reordering passes semantic comparison",
  { skip: pulumiVersion !== "v3.268.0" },
  (t) => {
    const root = mkdtempSync(join(tmpdir(), "savia-pulumi-import-test-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const project = join(root, "project");
    const backend = join(root, "backend");
    const pulumiHome = join(root, "pulumi-home");
    const candidatePath = join(root, "candidate.private.json");
    const importedPath = join(root, "imported.private.json");
    for (const path of [project, backend, pulumiHome])
      mkdirSync(path, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(project, "Pulumi.yaml"),
      "name: savia-cloudflare\nruntime: nodejs\n",
      { mode: 0o600 },
    );
    const env = {
      // Preserve host identity; isolate only the Pulumi-specific state directory.
      HOME: process.env.HOME,
      USER: process.env.USER,
      PATH: process.env.PATH,
      PULUMI_HOME: pulumiHome,
      PULUMI_CONFIG_PASSPHRASE: "isolated synthetic checkpoint only",
      PULUMI_SKIP_UPDATE_CHECK: "true",
    };
    const runPulumi = (args) =>
      execFileSync(pulumiBinary, args, {
        cwd: project,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });

    runPulumi(["login", `file://${backend}`]);
    runPulumi(["stack", "init", "preview", "--non-interactive"]);
    const emptyPath = join(root, "empty.private.json");
    runPulumi([
      "stack",
      "export",
      "--stack",
      "preview",
      "--file",
      emptyPath,
      "--non-interactive",
    ]);
    const candidate = JSON.parse(readFileSync(emptyPath, "utf8"));
    candidate.deployment.resources = [
      {
        urn: stackUrn,
        type: "pulumi:pulumi:Stack",
        custom: false,
        outputs: { vectorizeIndex: null },
      },
    ];
    writeFileSync(candidatePath, `${JSON.stringify(candidate)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    runPulumi([
      "stack",
      "import",
      "--file",
      candidatePath,
      "--stack",
      "preview",
      "--non-interactive",
    ]);
    runPulumi([
      "stack",
      "export",
      "--stack",
      "preview",
      "--file",
      importedPath,
      "--non-interactive",
    ]);
    assert.equal(
      validateImportedCheckpoint(
        candidate,
        JSON.parse(readFileSync(importedPath, "utf8")),
      ),
      true,
    );
  },
);

test("import comparison still rejects changes to nested values and array order", () => {
  const before = exportCheckpoint();
  const { checkpoint: candidate } = transformCheckpoint(before, { targetUrn });
  const mutate = (change) => {
    const imported = structuredClone(candidate);
    change(imported);
    assert.throws(
      () => validateImportedCheckpoint(candidate, imported, { targetUrn }),
      /differs from candidate|secrets provider state|deployment metadata/,
    );
  };

  mutate((imported) => {
    const provider = imported.deployment.resources.find(
      (resource) => resource.urn === providerUrn,
    );
    provider.inputs.encryptedMarker.secure = "changed";
  });
  mutate((imported) => {
    imported.deployment.resources.find(
      (resource) => resource.urn === runtimeUrn,
    ).id = "changed-resource-id";
  });
  mutate((imported) => {
    const runtime = imported.deployment.resources.find(
      (resource) => resource.urn === runtimeUrn,
    );
    runtime.dependencies = ["urn:first", "urn:second"];
  });
  const reorderedArrays = structuredClone(candidate);
  const runtime = reorderedArrays.deployment.resources.find(
    (resource) => resource.urn === runtimeUrn,
  );
  runtime.dependencies = ["urn:first", "urn:second"];
  const importedWithReorderedArray = structuredClone(reorderedArrays);
  importedWithReorderedArray.deployment.resources
    .find((resource) => resource.urn === runtimeUrn)
    .dependencies.reverse();
  assert.throws(
    () =>
      validateImportedCheckpoint(reorderedArrays, importedWithReorderedArray, {
        targetUrn,
      }),
    /differs from candidate/,
  );
  mutate((imported) => {
    imported.deployment.manifest.time = "changed";
  });
  mutate((imported) => {
    imported.secrets_providers.state.salt = "changed";
  });
});

test("fixes the target and output mutation scope to one exact Pulumi URN", () => {
  assert.throws(
    () =>
      transformCheckpoint(exportCheckpoint(), {
        targetUrn: targetUrn.replace("pages-search", "another-index"),
      }),
    /does not match the fixed preview index/,
  );
});
