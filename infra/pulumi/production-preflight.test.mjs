import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeProductionConfig,
  validateProductionReadiness,
} from "./production-preflight.mjs";

const accountId = "a".repeat(32);
const outputs = {
  cloudflareAccountId: accountId,
  authD1Id: "11111111-1111-4111-8111-111111111111",
  domainD1Id: "22222222-2222-4222-8222-222222222222",
  documentsBucketName: "savia-documents",
  resolvedEnvironment: "production",
  resolvedPublicOrigin: "https://savia.app.hefesoft.com",
  workerNames: { auth: "savia-auth", api: "savia-agencies" },
  databaseNames: {
    auth: "savia-auth-local-canonical-20260913-v2",
    domain: "savia-agencies-local-canonical-20260913-v2",
  },
  plannedFlowsResourceNames: {
    worker: "savia-flows",
    database: "savia-flows",
    kvNamespace: "savia-flows",
    buckets: {
      resources: "savia-flows-resources",
      datasets: "savia-flows-datasets",
      inboxes: "savia-flows-inboxes",
    },
    queue: "savia-flows-execute",
    deadLetterQueue: "savia-flows-execute-dlq",
    workflow: "savia-flows-execute",
  },
  flowsEnabled: false,
  flowsExecutionEnabled: false,
  flowsResources: null,
  deletionProtected: true,
  stateBackendBucketName: "savia-pulumi-state",
};

const stackConfig = {
  accountId,
  environment: "production",
  publicOrigin: "https://savia.app.hefesoft.com",
  documentsBucket: "savia-documents",
  stateBucket: "savia-pulumi-state",
  authDatabaseName: "savia-auth-local-canonical-20260913-v2",
  domainDatabaseName: "savia-agencies-local-canonical-20260913-v2",
  flowsEnabled: false,
  flowsExecutionEnabled: false,
};

const stateExport = {
  deployment: {
    resources: [
      {
        urn: "urn:pulumi:production::savia-cloudflare::cloudflare:index/d1Database:D1Database::auth-db",
        type: "cloudflare:index/d1Database:D1Database",
        protect: true,
        outputs: {
          id: "11111111-1111-4111-8111-111111111111",
          name: "savia-auth-local-canonical-20260913-v2",
          accountId,
        },
      },
      {
        urn: "urn:pulumi:production::savia-cloudflare::cloudflare:index/d1Database:D1Database::domain-db",
        type: "cloudflare:index/d1Database:D1Database",
        protect: true,
        outputs: {
          id: "22222222-2222-4222-8222-222222222222",
          name: "savia-agencies-local-canonical-20260913-v2",
          accountId,
        },
      },
      {
        urn: "urn:pulumi:production::savia-cloudflare::cloudflare:index/r2Bucket:R2Bucket::documents",
        type: "cloudflare:index/r2Bucket:R2Bucket",
        protect: true,
        outputs: { name: "savia-documents", accountId },
      },
      {
        urn: "urn:pulumi:production::savia-cloudflare::cloudflare:index/r2Bucket:R2Bucket::state-backend",
        type: "cloudflare:index/r2Bucket:R2Bucket",
        protect: true,
        outputs: { name: "savia-pulumi-state", accountId },
      },
    ],
  },
};

const env = {
  CLOUDFLARE_ACCOUNT_ID: accountId,
  PULUMI_BACKEND_URL: `s3://savia-pulumi-state?endpoint=${accountId}.r2.cloudflarestorage.com&region=auto&s3ForcePathStyle=true`,
  PULUMI_CONFIG_PASSPHRASE: "configured",
  AWS_ACCESS_KEY_ID: "configured",
  AWS_SECRET_ACCESS_KEY: "configured",
  SAVIA_BACKUP_KEY: "b".repeat(64),
  SAVIA_BACKUP_CONTROL_SECRET: "c".repeat(64),
};
const productionBackupBucket = "savia-production-backups";
const productionBackupOutputs = {
  ...outputs,
  backupBucketName: productionBackupBucket,
  backupRetentionDays: 30,
};
const productionBackupResources = [
  {
    urn: "urn:pulumi:production::savia-cloudflare::cloudflare:index/r2Bucket:R2Bucket::production-backups",
    type: "cloudflare:index/r2Bucket:R2Bucket",
    protect: true,
    outputs: {
      name: productionBackupBucket,
      accountId,
      storageClass: "Standard",
    },
  },
  {
    urn: "urn:pulumi:production::savia-cloudflare::cloudflare:index/r2BucketLifecycle:R2BucketLifecycle::production-backups-lifecycle",
    type: "cloudflare:index/r2BucketLifecycle:R2BucketLifecycle",
    protect: true,
    outputs: {
      bucketName: productionBackupBucket,
      accountId,
      rules: [
        {
          id: "expire-production-backups-after-30-days",
          enabled: true,
          conditions: { prefix: "production/" },
          deleteObjectsTransition: {
            condition: { type: "Age", maxAge: 30 * 24 * 60 * 60 },
          },
        },
      ],
    },
  },
  {
    urn: "urn:pulumi:production::savia-cloudflare::cloudflare:index/r2ManagedDomain:R2ManagedDomain::production-backups-public-access",
    type: "cloudflare:index/r2ManagedDomain:R2ManagedDomain",
    protect: true,
    outputs: {
      accountId,
      bucketName: productionBackupBucket,
      enabled: false,
    },
  },
];
const productionBackupState = {
  ...stateExport,
  deployment: {
    ...stateExport.deployment,
    resources: [
      ...stateExport.deployment.resources,
      ...productionBackupResources,
    ],
  },
};

test("accepts adopted, protected production state and emits current Flows flags", () => {
  assert.deepEqual(
    validateProductionReadiness({ outputs, stackConfig, stateExport, env }),
    {
      SAVIA_FLOWS_PROVISIONED: "false",
      SAVIA_FLOWS_EXECUTION_ENABLED: "false",
      SAVIA_FLOWS_PLANNED: "false",
      SAVIA_FLOWS_PLANNED_EXECUTION_ENABLED: "false",
    },
  );
});

test("allows opt-in backup config before the first Pulumi apply", () => {
  const readiness = validateProductionReadiness({
    outputs,
    stackConfig: { ...stackConfig, backupBucket: productionBackupBucket },
    stateExport,
    env: {
      ...env,
      R2_BACKUP_ACCESS_KEY_ID: undefined,
      R2_BACKUP_SECRET_ACCESS_KEY: undefined,
    },
  });
  assert.equal(readiness.SAVIA_FLOWS_PROVISIONED, "false");
});

test("rejects an invalid configured backup bucket before it exists in stack outputs", () => {
  assert.throws(
    () =>
      validateProductionReadiness({
        outputs,
        stackConfig: { ...stackConfig, backupBucket: "savia-documents" },
        stateExport,
        env,
      }),
    /backupBucket.*savia-production-backups/i,
  );
});

test("adopts the protected production backup bucket and exact lifecycle rule", () => {
  const readiness = validateProductionReadiness({
    outputs: productionBackupOutputs,
    stackConfig: { ...stackConfig, backupBucket: productionBackupBucket },
    stateExport: productionBackupState,
    env: {
      ...env,
      R2_BACKUP_ACCESS_KEY_ID: undefined,
      R2_BACKUP_SECRET_ACCESS_KEY: undefined,
    },
  });
  assert.equal(readiness.SAVIA_FLOWS_PROVISIONED, "false");

  assert.throws(() =>
    validateProductionReadiness({
      outputs: productionBackupOutputs,
      stackConfig: { ...stackConfig, backupBucket: productionBackupBucket },
      stateExport: {
        ...stateExport,
        deployment: {
          ...stateExport.deployment,
          resources: [
            ...stateExport.deployment.resources,
            ...productionBackupResources.slice(0, 2),
          ],
        },
      },
      env,
    }),
  );

  for (const invalid of [
    productionBackupResources.slice(1),
    [productionBackupResources[0]],
    [
      productionBackupResources[0],
      {
        ...productionBackupResources[1],
        outputs: {
          ...productionBackupResources[1].outputs,
          rules: [
            {
              ...productionBackupResources[1].outputs.rules[0],
              conditions: { prefix: "other/" },
            },
          ],
        },
      },
    ],
    [
      productionBackupResources[0],
      {
        ...productionBackupResources[1],
        outputs: {
          ...productionBackupResources[1].outputs,
          rules: [
            {
              ...productionBackupResources[1].outputs.rules[0],
              deleteObjectsTransition: {
                condition: { type: "Age", maxAge: 31 * 24 * 60 * 60 },
              },
            },
          ],
        },
      },
    ],
    [
      {
        ...productionBackupResources[0],
        outputs: { ...productionBackupResources[0].outputs, name: "wrong" },
      },
      productionBackupResources[1],
    ],
    [
      {
        ...productionBackupResources[0],
        outputs: {
          ...productionBackupResources[0].outputs,
          accountId: "b".repeat(32),
        },
      },
      productionBackupResources[1],
    ],
    [
      { ...productionBackupResources[0], protect: false },
      productionBackupResources[1],
    ],
    [
      productionBackupResources[0],
      {
        ...productionBackupResources[1],
        outputs: {
          ...productionBackupResources[1].outputs,
          bucketName: "wrong",
        },
      },
    ],
    [
      productionBackupResources[0],
      {
        ...productionBackupResources[1],
        outputs: {
          ...productionBackupResources[1].outputs,
          accountId: "b".repeat(32),
        },
      },
    ],
    [
      productionBackupResources[0],
      { ...productionBackupResources[1], protect: false },
    ],
    [
      productionBackupResources[0],
      {
        ...productionBackupResources[1],
        outputs: {
          ...productionBackupResources[1].outputs,
          rules: [
            {
              ...productionBackupResources[1].outputs.rules[0],
              enabled: false,
            },
          ],
        },
      },
    ],
    [
      productionBackupResources[0],
      productionBackupResources[1],
      { ...productionBackupResources[2], protect: false },
    ],
    [
      productionBackupResources[0],
      productionBackupResources[1],
      {
        ...productionBackupResources[2],
        outputs: { ...productionBackupResources[2].outputs, enabled: true },
      },
    ],
    [
      productionBackupResources[0],
      productionBackupResources[1],
      {
        ...productionBackupResources[2],
        outputs: {
          ...productionBackupResources[2].outputs,
          bucketName: "savia-documents",
        },
      },
    ],
    [
      productionBackupResources[0],
      productionBackupResources[1],
      {
        ...productionBackupResources[2],
        outputs: {
          ...productionBackupResources[2].outputs,
          accountId: "b".repeat(32),
        },
      },
    ],
  ]) {
    assert.throws(() =>
      validateProductionReadiness({
        outputs: productionBackupOutputs,
        stackConfig: { ...stackConfig, backupBucket: productionBackupBucket },
        stateExport: {
          ...stateExport,
          deployment: {
            ...stateExport.deployment,
            resources: [
              ...stateExport.deployment.resources,
              ...invalid,
              ...(invalid.some((resource) =>
                resource.urn?.endsWith("::production-backups-public-access"),
              )
                ? []
                : [productionBackupResources[2]]),
            ],
          },
        },
        env,
      }),
    );
  }

  assert.throws(() =>
    validateProductionReadiness({
      outputs: productionBackupOutputs,
      stackConfig,
      stateExport: productionBackupState,
      env,
    }),
  );
  assert.throws(
    () =>
      validateProductionReadiness({
        outputs: { ...productionBackupOutputs, backupRetentionDays: 29 },
        stackConfig: { ...stackConfig, backupBucket: productionBackupBucket },
        stateExport: productionBackupState,
        env,
      }),
    /retention.*30/i,
  );
});

test("normalizes Pulumi CLI-wrapped booleans and rejects secret or malformed config", () => {
  assert.deepEqual(
    normalizeProductionConfig({
      config: {
        "savia-cloudflare:accountId": accountId,
        "savia-cloudflare:environment": "production",
        "savia-cloudflare:publicOrigin": "https://savia.app.hefesoft.com",
        "savia-cloudflare:documentsBucket": "savia-documents",
        "savia-cloudflare:stateBucket": "savia-pulumi-state",
        "savia-cloudflare:authDatabaseName":
          "savia-auth-local-canonical-20260913-v2",
        "savia-cloudflare:domainDatabaseName":
          "savia-agencies-local-canonical-20260913-v2",
        "savia-cloudflare:flowsEnabled": false,
        "savia-cloudflare:flowsExecutionEnabled": false,
      },
    }),
    stackConfig,
  );
  assert.equal(
    normalizeProductionConfig({
      config: {
        ...Object.fromEntries(
          Object.entries(stackConfig).map(([key, value]) => [
            `savia-cloudflare:${key}`,
            { value: String(value), secret: false },
          ]),
        ),
      },
    }).flowsEnabled,
    false,
  );
  assert.equal(
    normalizeProductionConfig({
      config: {
        ...Object.fromEntries(
          Object.entries(stackConfig).map(([key, value]) => [
            `savia-cloudflare:${key}`,
            { value: String(value), secret: false },
          ]),
        ),
        "savia-cloudflare:backupBucket": {
          value: productionBackupBucket,
          secret: false,
        },
      },
    }).backupBucket,
    productionBackupBucket,
  );
  assert.throws(
    () =>
      normalizeProductionConfig({
        config: {
          "savia-cloudflare:backupBucket": {
            value: productionBackupBucket,
            secret: true,
          },
        },
      }),
    /public scalar/i,
  );
  assert.equal(
    normalizeProductionConfig({
      ...stackConfig,
      flowsEnabled: { value: "true", secret: false },
      flowsExecutionEnabled: { value: "true", secret: false },
    }).flowsEnabled,
    true,
  );
  assert.equal(
    normalizeProductionConfig({
      ...stackConfig,
      flowsEnabled: { value: "true", secret: false },
      flowsExecutionEnabled: { value: "true", secret: false },
    }).flowsExecutionEnabled,
    true,
  );
  assert.throws(
    () => normalizeProductionConfig({ ...stackConfig, flowsEnabled: "FALSE" }),
    /boolean/,
  );
  assert.throws(
    () =>
      normalizeProductionConfig({
        ...stackConfig,
        flowsEnabled: { value: "false", secret: true },
      }),
    /public|secret/i,
  );
  assert.throws(
    () =>
      normalizeProductionConfig({
        ...stackConfig,
        flowsEnabled: { value: false },
      }),
    /public|secret|boolean/i,
  );
});

test("rejects Pulumi resources marked with the export delete flag", () => {
  const deletedState = {
    ...stateExport,
    deployment: {
      ...stateExport.deployment,
      resources: stateExport.deployment.resources.map((resource, index) =>
        index === 0 ? { ...resource, delete: true } : resource,
      ),
    },
  };
  assert.throws(
    () =>
      validateProductionReadiness({
        outputs,
        stackConfig,
        stateExport: deletedState,
        env,
      }),
    /deleted|pending-replacement/i,
  );
});

test("rejects placeholder or mismatched production account and identifiers", () => {
  for (const invalid of [
    { outputs: { ...outputs, cloudflareAccountId: "REPLACE_WITH_ACCOUNT_ID" } },
    { outputs: { ...outputs, authD1Id: "REPLACE_WITH_D1_ID" } },
    { env: { ...env, CLOUDFLARE_ACCOUNT_ID: "b".repeat(32) } },
    { stackConfig: { ...stackConfig, accountId: "REPLACE_WITH_ACCOUNT_ID" } },
  ]) {
    assert.throws(() =>
      validateProductionReadiness({
        outputs: invalid.outputs ?? outputs,
        stackConfig: invalid.stackConfig ?? stackConfig,
        stateExport,
        env: invalid.env ?? env,
      }),
    );
  }
});

test("rejects production D1 names that differ between config, outputs, or adopted state", () => {
  assert.throws(
    () =>
      validateProductionReadiness({
        outputs,
        stackConfig: {
          ...stackConfig,
          domainDatabaseName: "savia-agencies",
        },
        stateExport,
        env,
      }),
    /database names do not match/i,
  );
  const wrongResourceState = {
    ...stateExport,
    deployment: {
      ...stateExport.deployment,
      resources: stateExport.deployment.resources.map((resource) =>
        resource.urn?.endsWith("::auth-db")
          ? {
              ...resource,
              outputs: { ...resource.outputs, name: "savia-auth" },
            }
          : resource,
      ),
    },
  };
  assert.throws(
    () =>
      validateProductionReadiness({
        outputs,
        stackConfig,
        stateExport: wrongResourceState,
        env,
      }),
    /matching mandatory production resource: auth-db/i,
  );
});

test("requires production protection and an adopted remote R2 state backend", () => {
  assert.throws(
    () =>
      validateProductionReadiness({
        outputs: { ...outputs, deletionProtected: false },
        stackConfig,
        stateExport,
        env,
      }),
    /empty|protection/i,
  );
  assert.throws(
    () =>
      validateProductionReadiness({
        outputs,
        stackConfig: { ...stackConfig, stateBucket: "savia-documents" },
        stateExport,
        env,
      }),
    /state backend/i,
  );
  assert.throws(
    () =>
      validateProductionReadiness({
        outputs,
        stackConfig,
        stateExport: { deployment: { resources: [] } },
        env,
      }),
    /empty|protection/i,
  );
});

test("rejects incomplete or unsettled adopted production state", () => {
  assert.throws(
    () =>
      validateProductionReadiness({
        outputs,
        stackConfig,
        stateExport: {
          deployment: {
            resources: stateExport.deployment.resources.slice(0, 2),
          },
        },
        env,
      }),
    /mandatory production resource/i,
  );
  assert.throws(
    () =>
      validateProductionReadiness({
        outputs,
        stackConfig,
        stateExport: {
          ...stateExport,
          deployment: {
            ...stateExport.deployment,
            resources: [
              ...stateExport.deployment.resources,
              {
                urn: "urn:pulumi:production::savia-cloudflare::cloudflare:index/d1Database:D1Database::flows-db",
                type: "cloudflare:index/d1Database:D1Database",
                protect: true,
                outputs: {
                  id: "33333333-3333-4333-8333-333333333333",
                  name: "savia-flows",
                  accountId,
                },
              },
            ],
          },
        },
        env,
      }),
    /unexpected Flows/i,
  );
  assert.throws(
    () =>
      validateProductionReadiness({
        outputs,
        stackConfig,
        stateExport: {
          ...stateExport,
          deployment: {
            ...stateExport.deployment,
            pending_operations: [{ type: "update" }],
          },
        },
        env,
      }),
    /pending/i,
  );
});

test("rejects attempts to change provisioned Flows state without the recovery key", () => {
  const flowsState = {
    ...stateExport,
    deployment: {
      ...stateExport.deployment,
      resources: [
        ...stateExport.deployment.resources,
        {
          urn: "urn:pulumi:production::savia-cloudflare::cloudflare:index/d1Database:D1Database::flows-db",
          type: "cloudflare:index/d1Database:D1Database",
          protect: true,
          outputs: {
            id: "33333333-3333-4333-8333-333333333333",
            name: "savia-flows",
            accountId,
          },
        },
      ],
    },
  };
  assert.throws(
    () =>
      validateProductionReadiness({
        outputs: {
          ...outputs,
          flowsEnabled: true,
          flowsResources: {
            workerName: "savia-flows",
            databaseId: "33333333-3333-4333-8333-333333333333",
            kvNamespaceId: "44444444444444444444444444444444",
            workflowName: "savia-flows-execute",
            queueName: "savia-flows-execute",
            deadLetterQueueName: "savia-flows-execute-dlq",
            buckets: {
              resources: "savia-flows-resources",
              datasets: "savia-flows-datasets",
              inboxes: "savia-flows-inboxes",
            },
          },
        },
        stackConfig: { ...stackConfig, flowsEnabled: true },
        stateExport: flowsState,
        env,
      }),
    /flows-/i,
  );
});

test("accepts all protected production Flows resources and rejects a missing queue", () => {
  const flowsOutputs = {
    ...outputs,
    flowsEnabled: true,
    flowsResources: {
      workerName: "savia-flows",
      databaseId: "33333333-3333-4333-8333-333333333333",
      kvNamespaceId: "44444444444444444444444444444444",
      workflowName: "savia-flows-execute",
      queueName: "savia-flows-execute",
      deadLetterQueueName: "savia-flows-execute-dlq",
      buckets: {
        resources: "savia-flows-resources",
        datasets: "savia-flows-datasets",
        inboxes: "savia-flows-inboxes",
      },
    },
  };
  const flowsResources = [
    [
      "flows-db",
      "cloudflare:index/d1Database:D1Database",
      { id: flowsOutputs.flowsResources.databaseId, name: "savia-flows" },
    ],
    [
      "flows-kv",
      "cloudflare:index/workersKvNamespace:WorkersKvNamespace",
      { id: flowsOutputs.flowsResources.kvNamespaceId, title: "savia-flows" },
    ],
    [
      "flows-resources",
      "cloudflare:index/r2Bucket:R2Bucket",
      { name: "savia-flows-resources" },
    ],
    [
      "flows-datasets",
      "cloudflare:index/r2Bucket:R2Bucket",
      { name: "savia-flows-datasets" },
    ],
    [
      "flows-inboxes",
      "cloudflare:index/r2Bucket:R2Bucket",
      { name: "savia-flows-inboxes" },
    ],
    [
      "flows-queue",
      "cloudflare:index/queue:Queue",
      { queueName: "savia-flows-execute" },
    ],
    [
      "flows-dead-letter-queue",
      "cloudflare:index/queue:Queue",
      { queueName: "savia-flows-execute-dlq" },
    ],
  ].map(([logical, type, values]) => ({
    urn: `urn:pulumi:production::savia-cloudflare::${type}::${logical}`,
    type,
    protect: true,
    outputs: { ...values, accountId },
  }));
  const state = {
    ...stateExport,
    deployment: {
      ...stateExport.deployment,
      resources: [...stateExport.deployment.resources, ...flowsResources],
    },
  };
  const envWithKeys = {
    ...env,
    SAVIA_FLOWS_BACKUP_KEY: "c".repeat(64),
    SAVIA_FLOWS_BRIDGE_SECRET: "b".repeat(32),
    SAVIA_FLOWS_JWT_SECRET: "j".repeat(32),
    SAVIA_FLOWS_SECRET_MASTER_KEY: "0".repeat(64),
    SAVIA_FLOWS_FORM_SIGNING_KEY: "f".repeat(32),
  };
  assert.equal(
    validateProductionReadiness({
      outputs: flowsOutputs,
      stackConfig: { ...stackConfig, flowsEnabled: true },
      stateExport: state,
      env: envWithKeys,
    }).SAVIA_FLOWS_PROVISIONED,
    "true",
  );
  assert.throws(
    () =>
      validateProductionReadiness({
        outputs: flowsOutputs,
        stackConfig: { ...stackConfig, flowsEnabled: true },
        stateExport: state,
        env: { ...envWithKeys, SAVIA_FLOWS_BACKUP_KEY: undefined },
      }),
    /BACKUP_KEY/,
  );
  assert.throws(
    () =>
      validateProductionReadiness({
        outputs: flowsOutputs,
        stackConfig: { ...stackConfig, flowsEnabled: true },
        stateExport: {
          ...state,
          deployment: {
            ...state.deployment,
            resources: state.deployment.resources.filter(
              ({ urn }) => !urn.endsWith("::flows-dead-letter-queue"),
            ),
          },
        },
        env: envWithKeys,
      }),
    /flows-dead-letter-queue/i,
  );
});

test("requires the writer barrier control credential before production mutations", () => {
  assert.throws(
    () =>
      validateProductionReadiness({
        outputs,
        stackConfig,
        stateExport,
        env: { ...env, SAVIA_BACKUP_CONTROL_SECRET: undefined },
      }),
    /SAVIA_BACKUP_CONTROL_SECRET/,
  );
});
