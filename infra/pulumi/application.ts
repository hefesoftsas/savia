import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import { registerConfiguredRuntime } from "./runtime-resources.ts";
import { VectorizeIndex } from "./vectorize-resource.ts";
import {
  managementBackendName,
  validateManagementOutputs,
} from "./management-resources.mjs";
import { validateTenantSubdomains } from "./worker-config.mjs";
import {
  resolveInfraNames,
  stackProtection,
  stateBackendUrl as buildStateBackendUrl,
  assertAccountId,
  productionBackupLifecycleRule,
  PRODUCTION_BACKUP_RETENTION_DAYS,
} from "./naming.mjs";

// Pulumi owns persistence, Worker identities and the managed RuntimeRelease.
// That release invokes Wrangler as the sole publisher of code and attachments.

const config = new pulumi.Config();
const accountId = assertAccountId(config.require("accountId"));
const environment = config.require("environment");
const publicOrigin = config.require("publicOrigin");
const configuredTenantSubdomains =
  config.getObject<string[]>("tenantSubdomains") ?? [];
const documentsBucket = config.require("documentsBucket");
const authDatabaseName = config.get("authDatabaseName");
const domainDatabaseName = config.get("domainDatabaseName");
const pagesSearchIndex = config.get("pagesSearchIndex");
const shouldProvisionFlows = config.getBoolean("flowsEnabled") ?? false;
const shouldExecuteFlows = config.getBoolean("flowsExecutionEnabled") ?? false;
if (shouldExecuteFlows && !shouldProvisionFlows) {
  throw new Error("flowsExecutionEnabled requires flowsEnabled");
}
const configuredStateBucket = config.get("stateBucket");
const configuredBackupBucket = config.get("backupBucket");
const stateBucketName =
  configuredStateBucket === undefined
    ? undefined
    : managementBackendName(configuredStateBucket);

const names = resolveInfraNames({
  environment,
  documentsBucket,
  pagesSearchIndex,
  publicOrigin,
  authDatabaseName,
  domainDatabaseName,
  backupBucket: configuredBackupBucket,
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

// Production backups are opt-in until the private R2 target is provisioned.
// Keep them isolated from documents and Pulumi state, and expire only objects
// under the production/ prefix after the documented retention window.
const productionBackups = names.backupBucket
  ? new cloudflare.R2Bucket(
      "production-backups",
      { accountId, name: names.backupBucket, storageClass: "Standard" },
      stateOpts,
    )
  : null;
const productionBackupsLifecycle = productionBackups
  ? new cloudflare.R2BucketLifecycle(
      "production-backups-lifecycle",
      {
        accountId,
        bucketName: names.backupBucket!,
        rules: [productionBackupLifecycleRule()],
      },
      { ...stateOpts, dependsOn: productionBackups },
    )
  : null;
if (productionBackups) {
  new cloudflare.R2ManagedDomain(
    "production-backups-public-access",
    {
      accountId,
      bucketName: names.backupBucket!,
      enabled: false,
    },
    { ...stateOpts, dependsOn: productionBackups },
  );
}

// The bucket's physical name/URL remain stable. Ownership lives exclusively in
// savia-management; lifecycle commands refresh this public custody proof from
// that independent checkpoint before planning or applying an application stack.
const stateBackendUrlValue = stateBucketName
  ? buildStateBackendUrl(accountId, stateBucketName)
  : null;
if (stateBucketName)
  validateManagementOutputs(config.requireObject("managementProof"), {
    accountId,
    backendUrl: stateBackendUrlValue!,
  });

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
export const backupBucketName = productionBackups?.name ?? null;
export const backupRetentionDays = productionBackupsLifecycle
  ? PRODUCTION_BACKUP_RETENTION_DAYS
  : null;
export const resolvedPublicOrigin = names.publicOrigin;
export const tenantSubdomains = validateTenantSubdomains(
  configuredTenantSubdomains,
  names.environment,
);
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
export const stateBackendBucketName = stateBucketName ?? null;
export const stateBackendUrl = stateBackendUrlValue;

// Ownership is enabled by a reviewed adoption plan. Existing persistence
// logical names and parents stay unchanged during that bookkeeping operation.
const search =
  config.getBoolean("runtimeManaged") && names.vectorizeIndex
    ? new VectorizeIndex(
        "pages-search",
        {
          accountId,
          environment: names.environment,
          name: names.vectorizeIndex,
          dimensions: 1024,
          metric: "cosine",
          adoptExisting: config.getBoolean("adoptSearchIndex") ?? true,
          deleteData: config.getBoolean("deleteRuntimeData") ?? false,
        },
        { protect: true },
      )
    : undefined;
const runtime = registerConfiguredRuntime(config, {
  accountId,
  environment: names.environment,
  dataDependencies: [
    authDb,
    domainDb,
    documents,
    ...(flows ? Object.values(flows) : []),
    ...(search ? [search] : []),
    ...(productionBackups ? [productionBackups] : []),
  ],
  dataInventory: pulumi.output([
    { kind: "d1", name: names.databases.auth, cloudId: authDb.id },
    { kind: "d1", name: names.databases.domain, cloudId: domainDb.id },
    { kind: "r2", name: names.bucket, cloudId: documents.name },
    ...(search
      ? [
          {
            kind: "vectorize",
            name: names.vectorizeIndex!,
            cloudId: names.vectorizeIndex!,
          },
        ]
      : []),
    ...(productionBackups
      ? [
          {
            kind: "r2",
            name: names.backupBucket!,
            cloudId: productionBackups.name,
          },
        ]
      : []),
    ...(flows
      ? [
          {
            kind: "d1",
            name: names.flows.database,
            cloudId: flows.database.id,
          },
          { kind: "kv", name: names.flows.kvNamespace, cloudId: flows.kv.id },
          ...(["resources", "datasets", "inboxes"] as const).map((kind) => ({
            kind: "r2",
            name: names.flows.buckets[kind],
            cloudId: flows[`${kind}Bucket`].name,
          })),
          { kind: "queue", name: names.flows.queue, cloudId: flows.queue.id },
          {
            kind: "queue",
            name: names.flows.deadLetterQueue,
            cloudId: flows.deadLetterQueue.id,
          },
        ]
      : []),
  ]),
});
export const environmentInventory = runtime?.inventory ?? null;
export const runtimeStatus = runtime?.status ?? "unmanaged";
