import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import { assertAccountId } from "../naming.mjs";
import { branchStackName } from "../branch-preview-resources.mjs";
import { previewNames } from "../../../scripts/preview-environment.mjs";

const config = new pulumi.Config();
const accountId = assertAccountId(config.require("accountId"));
const configuredBranchSlug = config.require("branchSlug");
const configuredAuthDatabaseName = config.require("authDatabaseName");
const configuredDomainDatabaseName = config.require("domainDatabaseName");
const configuredBucketName = config.require("bucketName");
const importAuthD1Id = config.get("importAuthD1Id");
const importDomainD1Id = config.get("importDomainD1Id");
const importBucketId = config.get("importBucketId");

const expectedStack = branchStackName(configuredBranchSlug);
if (pulumi.getStack() !== expectedStack) {
  throw new Error("Pulumi stack does not match the configured branch slug");
}
const names = previewNames(configuredBranchSlug);
for (const [configured, expected, label] of [
  [configuredAuthDatabaseName, names.databases.auth, "authDatabaseName"],
  [configuredDomainDatabaseName, names.databases.domain, "domainDatabaseName"],
  [configuredBucketName, names.bucket, "bucketName"],
]) {
  if (configured !== expected) {
    throw new Error(`Configured ${label} does not match the branch slug`);
  }
}

function importedD1Name(importId: string | undefined, expectedName: string) {
  if (!importId) return expectedName;
  const prefix = `${accountId}/`;
  const databaseId = importId.startsWith(prefix)
    ? importId.slice(prefix.length)
    : "";
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      databaseId,
    )
  ) {
    throw new Error(
      "D1 import ID must match the configured Cloudflare account",
    );
  }
  return cloudflare
    .getD1DatabaseOutput({ accountId, databaseId })
    .apply((database) => {
      if (database.name !== expectedName) {
        throw new Error(
          "D1 import ID does not identify the configured branch database",
        );
      }
      return expectedName;
    });
}

const validatedAuthDatabaseName = importedD1Name(
  importAuthD1Id,
  configuredAuthDatabaseName,
);
const validatedDomainDatabaseName = importedD1Name(
  importDomainD1Id,
  configuredDomainDatabaseName,
);
const expectedBucketImportId = `${accountId}/${configuredBucketName}/default`;
if (importBucketId && importBucketId !== expectedBucketImportId) {
  throw new Error("R2 import ID does not match the configured branch bucket");
}

const authDatabase = new cloudflare.D1Database(
  "auth-database",
  { accountId, name: validatedAuthDatabaseName },
  {
    ignoreChanges: ["readReplication"],
    protect: false,
    ...(importAuthD1Id ? { import: importAuthD1Id } : {}),
  },
);
const domainDatabase = new cloudflare.D1Database(
  "domain-database",
  { accountId, name: validatedDomainDatabaseName },
  {
    ignoreChanges: ["readReplication"],
    protect: false,
    ...(importDomainD1Id ? { import: importDomainD1Id } : {}),
  },
);
const documents = new cloudflare.R2Bucket(
  "documents",
  { accountId, name: configuredBucketName, jurisdiction: "default" },
  {
    protect: false,
    ...(importBucketId ? { import: importBucketId } : {}),
  },
);

export const branchSlug = configuredBranchSlug;
export const cloudflareAccountId = accountId;
export const authDatabaseName = authDatabase.name;
export const domainDatabaseName = domainDatabase.name;
export const documentsBucketName = documents.name;
export const authD1Id = authDatabase.uuid;
export const domainD1Id = domainDatabase.uuid;
