import * as pulumi from "@pulumi/pulumi";
import { assertAccountId } from "../naming.mjs";
import { branchStackName } from "../branch-preview-resources.mjs";
const config = new pulumi.Config();
const account = assertAccountId(config.require("accountId"));
const slug = config.require("branchSlug");
const environment = branchStackName(slug);
if (pulumi.getStack() !== environment)
  throw new Error("Branch stack identity mismatch");
const resources = config.getBoolean("environmentDeleted")
  ? undefined
  : await import("./resources.ts");
export const branchSlug = resources?.branchSlug ?? slug;
export const cloudflareAccountId = resources?.cloudflareAccountId ?? account;
export const authDatabaseName =
  resources?.authDatabaseName ?? config.require("authDatabaseName");
export const domainDatabaseName =
  resources?.domainDatabaseName ?? config.require("domainDatabaseName");
export const documentsBucketName = resources?.documentsBucketName ?? null;
export const authD1Id = resources?.authD1Id ?? null;
export const domainD1Id = resources?.domainD1Id ?? null;
export const environmentInventory = resources?.environmentInventory ?? {
  accountId: account,
  environment,
  resources: [],
  retentionWorkerNames: [],
};
export const runtimeStatus = resources?.runtimeStatus ?? "deleted";
