import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import {
  resolveInfraNames,
  stackProtection,
  stateBackendName,
  stateBackendUrl as buildStateBackendUrl,
  assertAccountId,
} from "./naming.mjs";

// Hybrid model (recommended by Cloudflare for Pulumi + Wrangler):
// - Pulumi owns stateful resources: D1 databases + R2 bucket.
// - Wrangler still owns Worker code deploys, bindings, migrations, assets.
// This avoids Pulumi/Wrangler fighting over Worker scripts while giving
// `pulumi preview` drift detection for data-plane resources.
//
// Vectorize search index stays Wrangler-managed: the Cloudflare Pulumi
// provider has no first-class Vectorize resource (use a dynamic provider
// only if you need it in state).

const config = new pulumi.Config();
const accountId = assertAccountId(config.require("accountId"));
const environment = config.require("environment");
const publicOrigin = config.require("publicOrigin");
const documentsBucket = config.require("documentsBucket");
const pagesSearchIndex = config.get("pagesSearchIndex");
const shouldProvisionFlows = config.getBoolean("flowsEnabled") ?? false;
const shouldExecuteFlows = config.getBoolean("flowsExecutionEnabled") ?? false;
if (shouldExecuteFlows && !shouldProvisionFlows) {
  throw new Error("flowsExecutionEnabled requires flowsEnabled");
}
const configuredStateBucket = config.get("stateBucket");
const stateBucketName = stateBackendName(environment, configuredStateBucket);

const names = resolveInfraNames({
  environment,
  documentsBucket,
  pagesSearchIndex,
  publicOrigin,
});

// Production stateful resources cannot be deleted by accident: `protect`
// makes `pulumi destroy` and replacements fail until protection is
// explicitly removed. Preview stacks stay cheap to tear down.
const protection = stackProtection(names.environment);
const stateOpts: pulumi.ResourceOptions = { protect: protection.protect };

// The Cloudflare API returns read_replication: null on refresh for D1
// databases without replication, which makes the provider propose a
// perpetual -readReplication update (pulumi-cloudflare #1583, fails with
// 400 if applied). The setting is Cloudflare-managed; ignore it.
const d1Opts: pulumi.ResourceOptions = {
  ...stateOpts,
  ignoreChanges: ["readReplication"],
};

// D1: savia-auth + savia-agencies (or *-preview). Replaces the
// `wrangler d1 create` step in scripts/setup.mjs.
const authDb = new cloudflare.D1Database(
  "auth-db",
  {
    accountId,
    name: names.databases.auth,
  },
  d1Opts,
);

const domainDb = new cloudflare.D1Database(
  "domain-db",
  {
    accountId,
    name: names.databases.domain,
  },
  d1Opts,
);

// R2: documents bucket. Replaces `wrangler r2 bucket create`.
const documents = new cloudflare.R2Bucket(
  "documents",
  {
    accountId,
    name: names.bucket,
  },
  stateOpts,
);

// The self-managed Pulumi backend is optional during bootstrap. When enabled,
// protect its bucket even in preview because it contains the state itself.
const stateBackendUrlValue = stateBucketName
  ? buildStateBackendUrl(accountId, stateBucketName)
  : null;
const stateBackend = stateBucketName
  ? new cloudflare.R2Bucket(
      "state-backend",
      { accountId, name: stateBucketName },
      { protect: true },
    )
  : null;

// Flows data resources are opt-in. Wrangler remains the sole publisher of
// the Flows Worker and its attached bindings, migrations, workflows, and cron.
const flows = shouldProvisionFlows
  ? {
      database: new cloudflare.D1Database(
        "flows-db",
        { accountId, name: names.flows.database },
        d1Opts,
      ),
      kv: new cloudflare.WorkersKvNamespace(
        "flows-kv",
        { accountId, title: names.flows.kvNamespace },
        stateOpts,
      ),
      resourcesBucket: new cloudflare.R2Bucket(
        "flows-resources",
        { accountId, name: names.flows.buckets.resources },
        stateOpts,
      ),
      datasetsBucket: new cloudflare.R2Bucket(
        "flows-datasets",
        { accountId, name: names.flows.buckets.datasets },
        stateOpts,
      ),
      inboxesBucket: new cloudflare.R2Bucket(
        "flows-inboxes",
        { accountId, name: names.flows.buckets.inboxes },
        stateOpts,
      ),
      queue: new cloudflare.Queue(
        "flows-queue",
        {
          accountId,
          queueName: names.flows.queue,
          settings: { messageRetentionPeriod: 1_209_600 },
        },
        stateOpts,
      ),
      deadLetterQueue: new cloudflare.Queue(
        "flows-dead-letter-queue",
        {
          accountId,
          queueName: names.flows.deadLetterQueue,
          settings: { messageRetentionPeriod: 1_209_600 },
        },
        stateOpts,
      ),
    }
  : null;

// Feed these outputs into the existing render + deploy flow:
//   pulumi stack output --json > /tmp/savia-infra.json
//   SAVIA_AUTH_D1_ID=$(jq -r .authD1Id) SAVIA_DOMAIN_D1_ID=... \
//     SAVIA_DOCUMENTS_BUCKET=... SAVIA_PUBLIC_ORIGIN=... \
//     node scripts/render-cloudflare-production-config.mjs
// Secrets stay out of state: keep using
// scripts/upload-cloudflare-secrets.mjs with `pulumi config set --secret`.
export const authD1Id = authDb.id;
export const cloudflareAccountId = accountId;
export const domainD1Id = domainDb.id;
export const documentsBucketName = documents.name;
export const resolvedPublicOrigin = names.publicOrigin;
export const resolvedEnvironment = names.environment;
export const workerNames = names.workers;
export const databaseNames = names.databases;
export const vectorizeIndex = names.vectorizeIndex ?? null;
export const deletionProtected = protection.protect;
export const flowsEnabled = shouldProvisionFlows;
export const flowsExecutionEnabled = shouldExecuteFlows;
export const flowsResources = flows
  ? {
      databaseId: flows.database.id,
      kvNamespaceId: flows.kv.id,
      workerName: names.flows.worker,
      workflowName: names.flows.workflow,
      queueName: flows.queue.queueName,
      deadLetterQueueName: flows.deadLetterQueue.queueName,
      buckets: {
        resources: flows.resourcesBucket.name,
        datasets: flows.datasetsBucket.name,
        inboxes: flows.inboxesBucket.name,
      },
    }
  : null;
export const plannedFlowsResourceNames = names.flows;
export const stateBackendBucketName = stateBackend?.name ?? null;
export const stateBackendUrl = stateBackendUrlValue;
