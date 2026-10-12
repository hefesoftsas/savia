import assert from "node:assert/strict";
import test from "node:test";

import {
  SHARED_REGISTRY_BUCKET,
  SHARED_REGISTRY_IMPORT_ID,
  SHARED_REGISTRY_WORKER,
  sharedRegistryBucketOptions,
  validateSharedRegistryOutputs,
} from "./shared-registry-resources.mjs";

const accountId = "08a0d36f8b0357684f83e4bfeb6628b6";

test("shared registry bucket options protect and adopt the existing service by default", () => {
  assert.deepEqual(sharedRegistryBucketOptions({ accountId }), {
    protect: true,
    import: SHARED_REGISTRY_IMPORT_ID(accountId),
  });
});

test("shared registry bucket options can explicitly create a bucket for a new account", () => {
  assert.deepEqual(
    sharedRegistryBucketOptions({
      accountId,
      adoptExisting: false,
    }),
    { protect: true },
  );
});

test("shared registry adoption requires an account ID", () => {
  assert.throws(
    () => sharedRegistryBucketOptions({ adoptExisting: true }),
    /accountId must be a 32-char lowercase hex string/,
  );
  assert.throws(
    () => sharedRegistryBucketOptions({ accountId: "not-an-account" }),
    /accountId must be a 32-char lowercase hex string/,
  );
  assert.throws(
    () => SHARED_REGISTRY_IMPORT_ID("not-an-account"),
    /accountId must be a 32-char lowercase hex string/,
  );
});

test("shared registry stack outputs are pinned to the persistent shared bucket", () => {
  assert.deepEqual(
    validateSharedRegistryOutputs({
      cloudflareAccountId: accountId,
      environment: "shared",
      workerName: SHARED_REGISTRY_WORKER,
      bucketName: SHARED_REGISTRY_BUCKET,
      bucketProtected: true,
    }),
    {
      cloudflareAccountId: accountId,
      environment: "shared",
      workerName: SHARED_REGISTRY_WORKER,
      bucketName: SHARED_REGISTRY_BUCKET,
      bucketProtected: true,
    },
  );
});

test("shared registry outputs reject drift and missing deletion protection", () => {
  for (const outputs of [
    {
      cloudflareAccountId: accountId,
      environment: "preview",
      workerName: SHARED_REGISTRY_WORKER,
      bucketName: SHARED_REGISTRY_BUCKET,
      bucketProtected: true,
    },
    {
      cloudflareAccountId: accountId,
      environment: "shared",
      workerName: SHARED_REGISTRY_WORKER,
      bucketName: "savia-plugin-registry-preview",
      bucketProtected: true,
    },
    {
      cloudflareAccountId: accountId,
      environment: "shared",
      workerName: SHARED_REGISTRY_WORKER,
      bucketName: SHARED_REGISTRY_BUCKET,
      bucketProtected: false,
    },
  ]) {
    assert.throws(() => validateSharedRegistryOutputs(outputs));
  }
});
