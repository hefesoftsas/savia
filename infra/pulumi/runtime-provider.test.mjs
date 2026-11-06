import test from "node:test";
import assert from "node:assert/strict";
import { makeRuntimeProvider } from "./runtime-provider.mjs";
import * as pulumi from "@pulumi/pulumi";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

test("serialized provider code never captures execution-time credentials", async () => {
  const canary = `credential-canary-${randomUUID()}`;
  const previous = process.env.SAVIA_SERIALIZATION_TEST_TOKEN;
  process.env.SAVIA_SERIALIZATION_TEST_TOKEN = canary;
  try {
    const provider = makeRuntimeProvider((inputs) => ({
      readSnapshot: async () => {
        if (!process.env.SAVIA_SERIALIZATION_TEST_TOKEN)
          throw new Error("Missing execution-time credential");
        return {
          workerVersions: inputs.workers.map((w) => ({
            ...w,
            versionId: "v1",
          })),
          namespaceIds: [],
          attachments: [],
        };
      },
      verifyArtifact: async () => {},
      publish: async () => {},
      recover: async () => {},
      pause: async () => {},
    }));
    const serialized = await pulumi.runtime.serializeFunction(() => provider);
    assert.equal(serialized.text.includes(canary), false);
    assert.match(serialized.text, /SAVIA_SERIALIZATION_TEST_TOKEN/);
    const exports = {};
    new Function("exports", "require", serialized.text)(
      exports,
      createRequire(import.meta.url),
    );
    const restored = exports[serialized.exportName]();
    const identity = {
      accountId: "a".repeat(32),
      environment: "preview",
      workers: [{ name: "savia-preview", cloudId: "b".repeat(32) }],
      mode: "adopt",
      adoptionManifest: {
        accountId: "a".repeat(32),
        environment: "preview",
        resources: [
          { kind: "worker", name: "savia-preview", cloudId: "b".repeat(32) },
        ],
      },
    };
    assert.equal((await restored.check({}, identity)).failures, undefined);
    const created = await restored.create(identity);
    const updated = await restored.update(created.id, created.outs, {
      ...identity,
      mode: "release",
      artifactDigest: "c".repeat(64),
      configDigest: "d".repeat(64),
      artifactDirectory: "/private/unit-artifact",
    });
    assert.equal(updated.outs.status, "ready");
    assert.equal(JSON.stringify(updated).includes(canary), false);
  } finally {
    if (previous === undefined)
      delete process.env.SAVIA_SERIALIZATION_TEST_TOKEN;
    else process.env.SAVIA_SERIALIZATION_TEST_TOKEN = previous;
  }
});

test("provider refresh is read-only and delete runs explicit runtime retirement", async () => {
  const inputs = {
    accountId: "a".repeat(32),
    environment: "preview",
    workers: [{ name: "savia-preview", cloudId: "b".repeat(32) }],
    mode: "adopt",
    adoptionManifest: {
      accountId: "a".repeat(32),
      environment: "preview",
      resources: [
        { kind: "worker", name: "savia-preview", cloudId: "b".repeat(32) },
      ],
    },
  };
  const calls = [];
  const factory = () => ({
    readSnapshot: async () => {
      calls.push("read");
      return {
        workerVersions: [{ ...inputs.workers[0], versionId: "v1" }],
        namespaceIds: [],
        attachments: [],
      };
    },
    retire: async (_state, options) => {
      calls.push("retire");
      assert.equal(options.deleteData, false);
    },
  });
  const provider = makeRuntimeProvider(factory);
  const created = await provider.create(inputs);
  const read = await provider.read(created.id, {
    ...created.outs,
    __provider: "serialized",
  });
  assert.equal(read.id, created.id);
  assert.deepEqual(await provider.diff(created.id, created.outs, inputs), {
    changes: false,
    replaces: [],
  });
  await provider.delete(created.id, created.outs);
  assert.deepEqual(calls, ["read", "read", "retire"]);
  assert.equal(JSON.stringify(created.outs).includes("serialized"), false);
});

test("preview accepts unresolved native IDs, while execution and unknown input fields stay strict", async () => {
  const unknown = pulumi.runtime.unknownValue;
  const provider = makeRuntimeProvider(() => {
    throw new Error("No API may run during check");
  });
  const unresolved = {
    accountId: "a".repeat(32),
    environment: "preview",
    workers: [{ name: "savia-preview", cloudId: unknown }],
    mode: "adopt",
    adoptionManifest: unknown,
  };
  assert.equal((await provider.check({}, unresolved)).failures, undefined);
  await assert.rejects(provider.create(unresolved), /identity/);
  assert.ok(
    (await provider.check({}, { ...unresolved, apiToken: "SECRET_CANARY" }))
      .failures,
  );
});
