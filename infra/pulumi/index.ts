import * as pulumi from "@pulumi/pulumi";
import {
  assertAccountId,
  normalizeEnvironment,
  stateBackendUrl as backendUrl,
} from "./naming.mjs";
import {
  managementBackendName,
  validateManagementOutputs,
} from "./management-resources.mjs";
const config = new pulumi.Config();
const account = assertAccountId(config.require("accountId"));
const environment = normalizeEnvironment(config.require("environment"));
const removed = config.getBoolean("environmentDeleted") ?? false;
const resources = removed ? undefined : await import("./application.ts");
const configuredBackend = config.get("stateBucket");
const backend = configuredBackend
  ? managementBackendName(configuredBackend)
  : null;
if (removed && backend)
  validateManagementOutputs(config.requireObject("managementProof"), {
    accountId: account,
    backendUrl: backendUrl(account, backend),
  });
// Explicit data deletion removes desired application resources through a saved
// Pulumi update plan. The empty checkpoint and source definitions are retained.
export const authD1Id = resources?.authD1Id ?? null;
export const cloudflareAccountId = resources?.cloudflareAccountId ?? account;
export const domainD1Id = resources?.domainD1Id ?? null;
export const documentsBucketName = resources?.documentsBucketName ?? null;
export const backupBucketName = resources?.backupBucketName ?? null;
export const backupRetentionDays = resources?.backupRetentionDays ?? null;
export const resolvedPublicOrigin =
  resources?.resolvedPublicOrigin ?? config.require("publicOrigin");
export const tenantSubdomains = resources?.tenantSubdomains ?? [];
export const resolvedEnvironment =
  resources?.resolvedEnvironment ?? environment;
export const workerNames = resources?.workerNames ?? null;
export const databaseNames = resources?.databaseNames ?? null;
export const vectorizeIndex = resources?.vectorizeIndex ?? null;
export const deletionProtected =
  resources?.deletionProtected ?? environment === "production";
export const flowsEnabled = resources?.flowsEnabled ?? false;
export const flowsExecutionEnabled = resources?.flowsExecutionEnabled ?? false;
export const flowsResources = resources?.flowsResources ?? null;
export const plannedFlowsResourceNames =
  resources?.plannedFlowsResourceNames ?? null;
export const stateBackendBucketName =
  resources?.stateBackendBucketName ?? backend;
export const stateBackendUrl =
  resources?.stateBackendUrl ?? (backend ? backendUrl(account, backend) : null);
export const environmentInventory = resources?.environmentInventory ?? {
  accountId: account,
  environment,
  resources: [],
  retentionWorkerNames: [],
};
export const runtimeStatus = resources?.runtimeStatus ?? "deleted";
