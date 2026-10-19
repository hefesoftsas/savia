import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import { fixtureWorkerDefinitions } from "../../verify-runtime-lifecycle.mjs";
import { RuntimeRelease } from "../../runtime-resource.ts";
import { fixtureDependencies } from "./operations.mjs";

const config = new pulumi.Config();
const definitions = fixtureWorkerDefinitions(
  config.require("fixturePrefix"),
  config.require("accountId"),
);
const prefix = config.require("fixturePrefix");
const accountId = config.require("accountId");
const deleteData = config.getBoolean("deleteData") ?? false;
const retired = config.getBoolean("retired") ?? false;
export const workers = definitions
  .filter(({ role }) => !retired || role === "coordinator")
  .map(({ role, args }) => {
    const worker = new cloudflare.Worker(role, args, {
      protect: role === "coordinator" && !deleteData,
      ignoreChanges: [
        "subdomain",
        "logpush",
        "observability",
        "tags",
        "tailConsumers",
        "previewsBaseConfig",
      ],
    });
    return { name: worker.name, cloudId: worker.id };
  });
const protect = { protect: !deleteData };
const database = new cloudflare.D1Database(
  "database",
  { accountId, name: `${prefix}-db` },
  { ...protect, ignoreChanges: ["readReplication"] },
);
const bucket = new cloudflare.R2Bucket(
  "bucket",
  { accountId, name: `${prefix}-data` },
  protect,
);
const kv = new cloudflare.WorkersKvNamespace(
  "kv",
  { accountId, title: `${prefix}-kv` },
  protect,
);
const queue = new cloudflare.Queue(
  "queue",
  { accountId, queueName: `${prefix}-queue` },
  protect,
);
export const data = {
  databaseId: database.id,
  bucketName: bucket.name,
  kvNamespaceId: kv.id,
  queueId: queue.id,
  queueName: queue.queueName,
};
let release: RuntimeRelease | undefined;
if (config.getBoolean("adoptRuntime") && !retired) {
  release = new RuntimeRelease(
    "runtime",
    {
      accountId,
      environment: prefix,
      workers,
      mode: (config.get("runtimeMode") ?? "adopt") as "adopt" | "release",
      artifactDigest: config.get("artifactDigest"),
      configDigest: config.get("configDigest"),
      artifactDirectory: config.get("artifactDirectory"),
      deleteData,
      adoptionManifest: pulumi.output(workers).apply((items) => ({
        accountId,
        environment: prefix,
        resources: items.map((w) => ({ kind: "worker", ...w })),
      })),
    },
    fixtureDependencies,
  );
}
export const runtime = release
  ? {
      id: release.id,
      status: release.status,
      workerVersions: release.workerVersions,
      namespaceIds: release.namespaceIds,
    }
  : null;
