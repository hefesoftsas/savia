import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";

import {
  sharedRegistryBucketOptions,
  SHARED_REGISTRY_BUCKET,
  SHARED_REGISTRY_WORKER,
} from "../shared-registry-resources.mjs";
import { pluginRegistryWorkerConfig } from "../auxiliary-worker-config.mjs";
import { assertAccountId } from "../naming.mjs";

const config = new pulumi.Config();
const accountId = assertAccountId(config.require("accountId"));
const adoptExisting = config.getBoolean("adoptExisting") ?? true;

// This project only owns the pre-existing shared data bucket. Its independent
// 30-day lifecycle rule remains outside this R2Bucket resource, so importing
// the bucket cannot replace or clear that policy. Wrangler remains the publisher
// of the registry Worker and its runtime secrets.
const bucket = new cloudflare.R2Bucket(
  "plugin-registry",
  { accountId, name: SHARED_REGISTRY_BUCKET },
  sharedRegistryBucketOptions({ accountId, adoptExisting }),
);

export const environment = "shared";
export const cloudflareAccountId = accountId;
export const workerName = SHARED_REGISTRY_WORKER;
export const bucketName = bucket.name;
export const bucketProtected = true;
export const registryWorkerManifest = pulumi
  .all([bucket.name])
  .apply(([name]) =>
    pluginRegistryWorkerConfig({
      environment: "shared",
      workerName: SHARED_REGISTRY_WORKER,
      bucketName: name,
      bucketProtected: true,
    }),
  );
