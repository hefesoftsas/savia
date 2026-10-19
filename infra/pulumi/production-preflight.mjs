import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { assertBackendConfigured } from "./deploy-stack.mjs";
import { parseStackOutputs, assertDeploymentAccount } from "./outputs.mjs";
import { resolveInfraNames, stateBackendUrl } from "./naming.mjs";
import {
  managementBackendName,
  validateManagementOutputs,
} from "./management-resources.mjs";
import { buildFlowsSecretUploads } from "../../scripts/flows-preview-policy.mjs";

const exec = promisify(execFile);
const UUID =
  /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;

function required(value, label) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    /REPLACE_WITH|placeholder|example/i.test(value)
  ) {
    throw new Error(`Production ${label} is missing or still a placeholder`);
  }
  return value.trim();
}

function validateProductionConfig(config) {
  const fields = [
    ["accountId", config?.accountId],
    ["environment", config?.environment],
    ["publicOrigin", config?.publicOrigin],
    ["documentsBucket", config?.documentsBucket],
    ["stateBucket", config?.stateBucket],
    ["authDatabaseName", config?.authDatabaseName],
    ["domainDatabaseName", config?.domainDatabaseName],
  ];
  const values = Object.fromEntries(
    fields.map(([name, value]) => [name, required(value, `config ${name}`)]),
  );
  if (config?.backupBucket !== undefined && config.backupBucket !== null) {
    values.backupBucket = required(config.backupBucket, "config backupBucket");
  }
  if (values.environment !== "production")
    throw new Error("Production Pulumi config must select production");
  if (!/^[a-f\d]{32}$/i.test(values.accountId))
    throw new Error("Production config accountId is invalid");
  if (values.publicOrigin !== "https://savia.hefesoft.com")
    throw new Error(
      "Production publicOrigin does not match the canonical origin",
    );
  if (values.documentsBucket !== "savia-documents")
    throw new Error(
      "Production documents bucket does not match the adopted stack",
    );
  managementBackendName(values.stateBucket);
  const names = resolveInfraNames({
    environment: "production",
    documentsBucket: values.documentsBucket,
    publicOrigin: values.publicOrigin,
    authDatabaseName: values.authDatabaseName,
    domainDatabaseName: values.domainDatabaseName,
    ...(values.backupBucket ? { backupBucket: values.backupBucket } : {}),
  });
  if (
    names.databases.auth !== values.authDatabaseName ||
    names.databases.domain !== values.domainDatabaseName
  ) {
    throw new Error("Production D1 database names are invalid");
  }
  return values;
}

function assertProtectedState(stateExport) {
  const resources = stateExport?.deployment?.resources;
  if (!Array.isArray(resources) || resources.length === 0)
    throw new Error(
      "Production Pulumi state export is empty; refusing an unadopted stack",
    );
  if (
    (
      stateExport?.deployment?.pending_operations ??
      stateExport?.pendingOperations ??
      []
    ).length > 0
  )
    throw new Error(
      "Production Pulumi state has pending operations; refusing deployment",
    );
  if (
    resources.some(
      (resource) =>
        resource?.delete === true ||
        resource?.deleted === true ||
        resource?.pendingReplacement === true,
    )
  )
    throw new Error(
      "Production Pulumi state has deleted or pending-replacement resources; refusing deployment",
    );
  const managed = resources.filter(
    ({ type }) =>
      type !== "pulumi:pulumi:Stack" &&
      !String(type).startsWith("pulumi:providers:"),
  );
  if (
    managed.length === 0 ||
    managed.some((resource) => resource?.protect !== true)
  ) {
    throw new Error(
      "Production Pulumi resources must all have deletion protection enabled",
    );
  }
  return resources;
}

function assertAdoptedResources(resources, outputs, accountId) {
  const expected = [
    [
      "auth-db",
      "cloudflare:index/d1Database:D1Database",
      { id: outputs.authD1Id, name: outputs.databaseNames?.auth },
    ],
    [
      "domain-db",
      "cloudflare:index/d1Database:D1Database",
      { id: outputs.domainD1Id, name: outputs.databaseNames?.domain },
    ],
    [
      "documents",
      "cloudflare:index/r2Bucket:R2Bucket",
      { name: "savia-documents" },
    ],
  ];
  for (const [logicalName, type, fields] of expected) {
    const resource = resources.find((entry) =>
      entry.urn?.endsWith(`::${logicalName}`),
    );
    if (
      !resource ||
      resource.type !== type ||
      Object.entries(fields).some(
        ([key, value]) => resource.outputs?.[key] !== value,
      ) ||
      resource.outputs?.accountId !== accountId
    ) {
      throw new Error(
        `Production state is missing a matching mandatory production resource: ${logicalName}`,
      );
    }
  }
  if (
    outputs.backupBucketName !== undefined &&
    outputs.backupBucketName !== null
  ) {
    const bucket = resources.find((entry) =>
      entry.urn?.endsWith("::production-backups"),
    );
    if (
      !bucket ||
      bucket.type !== "cloudflare:index/r2Bucket:R2Bucket" ||
      bucket.protect !== true ||
      bucket.outputs?.name !== outputs.backupBucketName ||
      bucket.outputs?.accountId !== accountId ||
      bucket.outputs?.storageClass !== "Standard"
    ) {
      throw new Error(
        "Production state is missing a matching protected production backup bucket",
      );
    }

    const lifecycle = resources.find((entry) =>
      entry.urn?.endsWith("::production-backups-lifecycle"),
    );
    const rules = lifecycle?.outputs?.rules;
    const rule = Array.isArray(rules) ? rules[0] : undefined;
    const condition = rule?.deleteObjectsTransition?.condition;
    if (
      !lifecycle ||
      lifecycle.type !==
        "cloudflare:index/r2BucketLifecycle:R2BucketLifecycle" ||
      lifecycle.protect !== true ||
      lifecycle.outputs?.accountId !== accountId ||
      lifecycle.outputs?.bucketName !== outputs.backupBucketName ||
      !Array.isArray(rules) ||
      rules.length !== 1 ||
      rule?.id !== "expire-production-backups-after-30-days" ||
      rule?.enabled !== true ||
      rule?.conditions?.prefix !== "production/" ||
      condition?.type !== "Age" ||
      condition?.maxAge !== 30 * 24 * 60 * 60
    ) {
      throw new Error(
        "Production state is missing the exact protected production backup lifecycle rule",
      );
    }

    const publicAccess = resources.find((entry) =>
      entry.urn?.endsWith("::production-backups-public-access"),
    );
    if (
      !publicAccess ||
      publicAccess.type !==
        "cloudflare:index/r2ManagedDomain:R2ManagedDomain" ||
      publicAccess.protect !== true ||
      publicAccess.outputs?.accountId !== accountId ||
      publicAccess.outputs?.bucketName !== outputs.backupBucketName ||
      publicAccess.outputs?.enabled !== false
    ) {
      throw new Error(
        "Production backup bucket must have a matching protected disabled public access domain",
      );
    }
  }
  if (outputs.flowsEnabled) {
    const expectedFlows = [
      [
        "flows-db",
        "cloudflare:index/d1Database:D1Database",
        { id: outputs.flowsResources?.databaseId, name: "savia-flows" },
      ],
      [
        "flows-kv",
        "cloudflare:index/workersKvNamespace:WorkersKvNamespace",
        { id: outputs.flowsResources?.kvNamespaceId, title: "savia-flows" },
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
    ];
    for (const [logicalName, type, fields] of expectedFlows) {
      const resource = resources.find((entry) =>
        entry.urn?.endsWith(`::${logicalName}`),
      );
      if (
        !resource ||
        resource.type !== type ||
        resource.protect !== true ||
        Object.entries(fields).some(
          ([key, value]) => !value || resource.outputs?.[key] !== value,
        ) ||
        resource.outputs?.accountId !== accountId
      ) {
        throw new Error(
          `Production state is missing a matching mandatory production resource: ${logicalName}`,
        );
      }
    }
  }
}

function validateBackend(env, accountId, bucket) {
  assertBackendConfigured(env);
  let actual;
  try {
    actual = new URL(env.PULUMI_BACKEND_URL);
  } catch {
    throw new Error("Production Pulumi state backend URL is invalid");
  }
  const expected = new URL(stateBackendUrl(accountId, bucket));
  if (actual.toString() !== expected.toString()) {
    throw new Error(
      "Production Pulumi state backend does not match the adopted Cloudflare account and protected R2 bucket",
    );
  }
}

export function validateProductionReadiness({
  outputs,
  stackConfig,
  stateExport,
  management,
  env = process.env,
}) {
  const config = validateProductionConfig(stackConfig);
  if (outputs?.resolvedEnvironment !== "production")
    throw new Error("Selected Pulumi stack is not production");
  if (outputs.deletionProtected !== true)
    throw new Error(
      "Production stack output does not confirm deletion protection",
    );
  const accountId = required(
    outputs.cloudflareAccountId,
    "Cloudflare account output",
  );
  if (!/^[a-f\d]{32}$/i.test(accountId))
    throw new Error("Production Cloudflare account output is invalid");
  assertDeploymentAccount(outputs, env.CLOUDFLARE_ACCOUNT_ID);
  if (config.accountId !== accountId)
    throw new Error(
      "Production Pulumi config account does not match the adopted stack",
    );
  // Allow only the explicit old -> new hostname transition before Pulumi apply.
  // Resource identity and deletion-protection checks below still apply unchanged.
  const migratingCanonicalOrigin =
    config.publicOrigin === "https://savia.hefesoft.com" &&
    outputs.resolvedPublicOrigin === "https://savia.app.hefesoft.com";
  if (
    !migratingCanonicalOrigin &&
    (outputs.resolvedPublicOrigin !== "https://savia.hefesoft.com" ||
      config.publicOrigin !== outputs.resolvedPublicOrigin)
  )
    throw new Error(
      "Production public origin does not match the adopted stack",
    );
  if (outputs.documentsBucketName !== config.documentsBucket)
    throw new Error(
      "Production documents bucket does not match the adopted stack",
    );
  if (
    outputs.databaseNames?.auth !== config.authDatabaseName ||
    outputs.databaseNames?.domain !== config.domainDatabaseName
  ) {
    throw new Error(
      "Production D1 database names do not match the adopted stack",
    );
  }
  if (outputs.stateBackendBucketName !== config.stateBucket)
    throw new Error(
      "Production state backend bucket does not match Pulumi config",
    );
  const outputBackupBucket = outputs.backupBucketName ?? null;
  const outputBackupRetention = outputs.backupRetentionDays ?? null;
  if ((outputBackupBucket === null) !== (outputBackupRetention === null)) {
    throw new Error(
      "Production backup bucket and retention outputs must be configured together",
    );
  }
  if (outputBackupBucket !== null && outputBackupRetention !== 30) {
    throw new Error("Production backup retention output must be 30 days");
  }
  if (
    outputBackupBucket !== null &&
    config.backupBucket !== outputBackupBucket
  ) {
    throw new Error(
      "Production backup bucket output does not match Pulumi config",
    );
  }
  // A newly enabled resource has no outputs until the reviewed Pulumi apply.
  // This preflight allows that plan/apply bootstrap and validates any
  // provisioned bucket strictly on subsequent runs.
  for (const name of ["authD1Id", "domainD1Id"]) {
    if (!UUID.test(required(outputs[name], `${name} output`)))
      throw new Error(`Production ${name} is not a real D1 identifier`);
  }
  validateBackend(env, accountId, config.stateBucket);
  validateManagementOutputs(management, {
    accountId,
    backendUrl: env.PULUMI_BACKEND_URL,
  });
  const resources = assertProtectedState(stateExport);
  if (
    resources.some(
      (row) =>
        row.type === "cloudflare:index/r2Bucket:R2Bucket" &&
        ["savia-pulumi-state-preview", "savia-pulumi-state"].includes(
          row.outputs?.name,
        ),
    )
  )
    throw new Error("Application state must not own the management backend");
  assertAdoptedResources(resources, outputs, accountId);
  const currentFlows = outputs.flowsEnabled === true;
  if (
    !currentFlows &&
    resources.some((resource) =>
      /::flows-(?:db|kv|resources|datasets|inboxes|queue|dead-letter-queue)$/.test(
        resource.urn ?? "",
      ),
    )
  ) {
    throw new Error(
      "Production state contains unexpected Flows resources while flowsEnabled is false",
    );
  }
  const plannedFlows = stackConfig.flowsEnabled === true;
  if (outputs.flowsEnabled !== true && outputs.flowsEnabled !== false)
    throw new Error("Production current Flows output is invalid");
  if (
    outputs.flowsExecutionEnabled !== true &&
    outputs.flowsExecutionEnabled !== false
  )
    throw new Error("Production current Flows execution output is invalid");
  if (outputs.flowsExecutionEnabled && !currentFlows)
    throw new Error(
      "Production Flows execution cannot be enabled without provisioned resources",
    );
  if (currentFlows && !plannedFlows)
    throw new Error(
      "Keep flowsEnabled true to preserve existing production Flows data",
    );
  const plannedExecution = stackConfig.flowsExecutionEnabled === true;
  if (plannedExecution && !plannedFlows)
    throw new Error(
      "Planned Flows execution cannot be enabled without provisioned resources",
    );
  if (
    typeof env.SAVIA_BACKUP_CONTROL_SECRET !== "string" ||
    env.SAVIA_BACKUP_CONTROL_SECRET.length < 32
  )
    throw new Error(
      "SAVIA_BACKUP_CONTROL_SECRET is required for the production write barrier",
    );
  if (!/^[a-f0-9]{64}$/i.test(env.SAVIA_BACKUP_KEY ?? ""))
    throw new Error(
      "SAVIA_BACKUP_KEY is required for encrypted production recovery artifacts",
    );
  if (
    (currentFlows || plannedFlows) &&
    !/^[a-f0-9]{64}$/i.test(env.SAVIA_FLOWS_BACKUP_KEY ?? "")
  )
    throw new Error(
      "SAVIA_FLOWS_BACKUP_KEY is required for encrypted Flows recovery artifacts",
    );
  if (currentFlows || plannedFlows) {
    buildFlowsSecretUploads("production", {
      ...env,
      SAVIA_FLOWS_PROVISIONED: String(plannedFlows),
    });
  }
  return {
    SAVIA_FLOWS_PROVISIONED: String(currentFlows),
    SAVIA_FLOWS_EXECUTION_ENABLED: String(outputs.flowsExecutionEnabled),
    SAVIA_FLOWS_PLANNED: String(plannedFlows),
    SAVIA_FLOWS_PLANNED_EXECUTION_ENABLED: String(plannedExecution),
  };
}

export function normalizeProductionConfig(raw) {
  raw = raw?.config ?? raw;
  const get = (key) => {
    const entry = raw?.[`savia-cloudflare:${key}`] ?? raw?.[key];
    if (entry === undefined || entry === null) return entry;
    if (typeof entry !== "object") return entry;
    if (
      Array.isArray(entry) ||
      Object.keys(entry).length !== 2 ||
      !Object.hasOwn(entry, "value") ||
      !Object.hasOwn(entry, "secret") ||
      entry.secret !== false ||
      (typeof entry.value !== "string" && typeof entry.value !== "boolean")
    ) {
      throw new Error(`Production ${key} config must be a public scalar value`);
    }
    return entry.value;
  };
  const config = {
    accountId: get("accountId"),
    environment: get("environment"),
    publicOrigin: get("publicOrigin"),
    documentsBucket: get("documentsBucket"),
    stateBucket: get("stateBucket"),
    authDatabaseName: get("authDatabaseName"),
    domainDatabaseName: get("domainDatabaseName"),
    ...(get("backupBucket") == null
      ? {}
      : { backupBucket: get("backupBucket") }),
    flowsEnabled: get("flowsEnabled") ?? false,
    flowsExecutionEnabled: get("flowsExecutionEnabled") ?? false,
  };
  for (const key of ["flowsEnabled", "flowsExecutionEnabled"]) {
    if (config[key] === "true") config[key] = true;
    if (config[key] === "false") config[key] = false;
    if (typeof config[key] !== "boolean")
      throw new Error(`Production ${key} config must be a boolean`);
  }
  return config;
}

async function main() {
  const cwd = fileURLToPath(new URL(".", import.meta.url));
  assertBackendConfigured(process.env);
  const options = { cwd, env: process.env, maxBuffer: 32 * 1024 * 1024 };
  await exec(
    "pulumi",
    ["login", process.env.PULUMI_BACKEND_URL, "--non-interactive"],
    options,
  );
  await exec(
    "pulumi",
    ["stack", "select", "production", "--non-interactive"],
    options,
  );
  const [{ stdout }, { stdout: exported }, { stdout: configJson }] =
    await Promise.all([
      exec(
        "pulumi",
        ["stack", "output", "--json", "--stack", "production"],
        options,
      ),
      exec("pulumi", ["stack", "export", "--stack", "production"], options),
      exec("pulumi", ["config", "--json", "--stack", "production"], options),
    ]);
  const managementStack = process.env.SAVIA_MANAGEMENT_STACK;
  if (!/^[\w.-]+\/savia-management\/management$/.test(managementStack ?? ""))
    throw new Error("Qualified management stack is required");
  const [{ stdout: managementOutputs }, { stdout: managementCheckpoint }] =
    await Promise.all([
      exec(
        "pulumi",
        ["stack", "output", "--json", "--stack", managementStack],
        options,
      ),
      exec("pulumi", ["stack", "export", "--stack", managementStack], options),
    ]);
  const management = {
    ...JSON.parse(managementOutputs),
    checkpoint: JSON.parse(managementCheckpoint),
  };
  const outputs = parseStackOutputs(stdout);
  const envOutputs = validateProductionReadiness({
    outputs,
    stackConfig: normalizeProductionConfig(JSON.parse(configJson)),
    stateExport: JSON.parse(exported),
    management,
    env: process.env,
  });
  if (process.env.GITHUB_ENV)
    await appendFile(
      process.env.GITHUB_ENV,
      Object.entries(envOutputs)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
    );
  console.log(
    "Production preflight passed: adopted account, protected state backend, current outputs, and planned Flows policy verified.",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Production preflight failed",
    );
    process.exitCode = 1;
  });
