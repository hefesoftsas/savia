import test from "node:test";
import assert from "node:assert/strict";
import {
  managementBucketDefinitions,
  validateManagementOutputs,
  settledCheckpoint,
} from "./management-resources.mjs";
import { stateBackendUrl } from "./naming.mjs";
const accountId = "a".repeat(32),
  bucket = "savia-pulumi-state-preview";
const checkpoint = {
  deployment: {
    resources: [
      {
        urn: "urn:pulumi:management::savia-management::cloudflare:index/r2Bucket:R2Bucket::state-backend",
        type: "cloudflare:index/r2Bucket:R2Bucket",
        id: `${accountId}/${bucket}/default`,
        protect: true,
        inputs: { accountId, name: bucket },
        outputs: { accountId, name: bucket },
      },
    ],
  },
};
export const management = {
  accountId,
  backendBuckets: [bucket],
  protected: true,
  checkpoint,
};
test("management owns only exact protected backend buckets without duplicate imports", () => {
  const definitions = managementBucketDefinitions({
    accountId,
    backendBuckets: [bucket],
  });
  assert.deepEqual(definitions, [
    {
      logicalName: "state-backend",
      args: { accountId, name: bucket },
      options: { protect: true },
    },
  ]);
  assert.throws(() =>
    managementBucketDefinitions({
      accountId,
      backendBuckets: ["savia-documents-preview"],
    }),
  );
  assert.throws(() =>
    managementBucketDefinitions({
      accountId,
      backendBuckets: [bucket, bucket],
    }),
  );
});
test("application backend protection requires independent settled management state", () => {
  const context = { accountId, backendUrl: stateBackendUrl(accountId, bucket) };
  assert.deepEqual(validateManagementOutputs(management, context), {
    accountId,
    backendBuckets: [bucket],
    protected: true,
  });
  for (const patch of [
    {},
    { ...management, protected: false },
    { ...management, accountId: "b".repeat(32) },
    { ...management, checkpoint: { deployment: { resources: [] } } },
    {
      ...management,
      checkpoint: {
        deployment: {
          resources: checkpoint.deployment.resources,
          pending_operations: [{}],
        },
      },
    },
  ])
    assert.throws(() => validateManagementOutputs(patch, context));
  const wrong = structuredClone(management);
  wrong.checkpoint.deployment.resources[0].protect = false;
  assert.throws(() => validateManagementOutputs(wrong, context), /protect/i);
  assert.throws(
    () =>
      validateManagementOutputs(management, {
        ...context,
        backendUrl: stateBackendUrl("b".repeat(32), bucket),
      }),
    /backend|account/i,
  );
});

// Pulumi 3.268.0 omits resources when exporting a newly initialized stack.
test("an omitted resource list in a version-3 empty export is readable but grants no management proof", () => {
  const empty = { version: 3, deployment: { manifest: {}, metadata: {} } };
  assert.deepEqual(settledCheckpoint(empty), []);
  assert.equal(Object.hasOwn(empty.deployment, "resources"), false);
  assert.throws(() =>
    validateManagementOutputs(
      { ...management, checkpoint: empty },
      { accountId, backendUrl: stateBackendUrl(accountId, bucket) },
    ),
  );
  assert.throws(
    () =>
      settledCheckpoint({
        ...empty,
        deployment: { ...empty.deployment, pending_operations: [{}] },
      }),
    /pending/,
  );
  for (const value of [
    null,
    {},
    { version: 3 },
    { deployment: {} },
    { version: 3, deployment: { manifest: {}, resources: null } },
    { version: 3, deployment: { manifest: {}, resources: {} } },
  ])
    assert.throws(() => settledCheckpoint(value), /Readable/);
});
