import test from "node:test";
import assert from "node:assert/strict";
import {
  adoptRuntime,
  readRuntime,
  diffRuntimeInputs,
  releaseRuntime,
} from "./runtime-release.mjs";

const worker = { name: "savia-preview", cloudId: "b".repeat(32) };
const inputs = {
  accountId: "a".repeat(32),
  environment: "preview",
  workers: [worker],
  mode: "adopt",
  adoptionManifest: {
    accountId: "a".repeat(32),
    environment: "preview",
    resources: [{ kind: "worker", ...worker }],
  },
};
const snapshot = {
  workerVersions: [{ ...worker, versionId: "v1" }],
  namespaceIds: [],
  attachments: [],
};
const deps = { readSnapshot: async () => snapshot };

test("adoption and refresh read only and strip unexpected credential fields", async () => {
  const state = await adoptRuntime(inputs, {
    readSnapshot: async () => ({ ...snapshot, token: "CREDENTIAL_CANARY" }),
  });
  assert.equal(state.status, "adopted");
  assert.equal(JSON.stringify(state).includes("CREDENTIAL_CANARY"), false);
  assert.deepEqual(
    (await readRuntime(inputs, state, deps)).workerVersions,
    snapshot.workerVersions,
  );
  await assert.rejects(
    adoptRuntime(
      {
        ...inputs,
        adoptionManifest: {
          ...inputs.adoptionManifest,
          accountId: "c".repeat(32),
        },
      },
      deps,
    ),
    /manifest/,
  );
});

test("digest changes update in place, staging path changes do not deploy", () => {
  const before = {
    ...inputs,
    mode: "release",
    artifactDigest: "c".repeat(64),
    configDigest: "d".repeat(64),
    artifactDirectory: "/private/artifact",
  };
  assert.deepEqual(
    diffRuntimeInputs(before, { ...before, artifactDigest: "e".repeat(64) }),
    { changes: true, replaces: [] },
  );
  assert.deepEqual(
    diffRuntimeInputs(before, {
      ...before,
      artifactDirectory: "/private/staged",
    }),
    { changes: false, replaces: [] },
  );
  for (const patch of [
    { accountId: "f".repeat(32) },
    { environment: "production" },
    { workers: [{ ...worker, cloudId: "c".repeat(32) }] },
  ])
    assert.throws(
      () => diffRuntimeInputs(before, { ...before, ...patch }),
      /identity/,
    );
  assert.throws(
    () => diffRuntimeInputs(before, { ...before, apiToken: "secret" }),
    /fields/,
  );
});

test("runtime inputs reject coercible identities and secret-bearing manifest fields", async () => {
  await assert.rejects(
    adoptRuntime({ ...inputs, accountId: [inputs.accountId] }, deps),
    /identity/,
  );
  await assert.rejects(
    adoptRuntime(
      {
        ...inputs,
        adoptionManifest: {
          ...inputs.adoptionManifest,
          apiToken: "SECRET_CANARY",
        },
      },
      deps,
    ),
    /manifest fields/,
  );
  await assert.rejects(
    adoptRuntime(
      {
        ...inputs,
        adoptionManifest: {
          ...inputs.adoptionManifest,
          resources: [
            {
              ...inputs.adoptionManifest.resources[0],
              secretValue: "SECRET_CANARY",
            },
          ],
        },
      },
      deps,
    ),
    /manifest resource fields/,
  );
});

test("failed publication restores actual versions and rejects incomplete recovery", async () => {
  const calls = [];
  const release = {
    ...inputs,
    mode: "release",
    artifactDigest: "c".repeat(64),
    configDigest: "d".repeat(64),
    artifactDirectory: "/private/artifact",
  };
  let current = snapshot;
  const operations = {
    readSnapshot: async () => current,
    verifyArtifact: async () => calls.push("verify"),
    publish: async () => {
      current = {
        ...snapshot,
        workerVersions: [{ ...worker, versionId: "bad" }],
      };
      throw new Error("injected failure");
    },
    recover: async () => {
      calls.push("recover");
      current = snapshot;
    },
    pause: async () => calls.push("pause"),
  };
  await assert.rejects(
    releaseRuntime({}, release, operations),
    /injected failure/,
  );
  assert.deepEqual(calls, ["verify", "recover"]);
  operations.recover = async () => {};
  await assert.rejects(
    releaseRuntime({}, release, operations),
    /incomplete recovery/,
  );
  assert.equal(calls.at(-1), "pause");
  const live = await readRuntime(
    release,
    { status: "maintenance" },
    operations,
  );
  assert.equal(live.workerVersions[0].versionId, "bad");
});

test("refresh reports observed drift instead of retaining a successful release status", async () => {
  const previous = { ...snapshot, status: "ready", releaseDigest: "previous" };
  const live = {
    ...snapshot,
    workerVersions: [{ ...worker, versionId: "unexpected-version" }],
  };
  const refreshed = await readRuntime(inputs, previous, {
    readSnapshot: async () => live,
  });
  assert.equal(refreshed.status, "maintenance");
  assert.equal(refreshed.workerVersions[0].versionId, "unexpected-version");
});
