import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import { managementBucketDefinitions } from "../management-resources.mjs";
const config = new pulumi.Config();
if (pulumi.getStack() !== "management")
  throw new Error("Management must use its dedicated stack");
const configuredAccount = config.require("accountId");
const definitions = managementBucketDefinitions({
  accountId: configuredAccount,
  backendBuckets: config.requireObject<string[]>("backendBuckets"),
});
const buckets = definitions.map(
  (definition) =>
    new cloudflare.R2Bucket(
      definition.logicalName,
      definition.args,
      definition.options,
    ),
);
export const accountId = configuredAccount;
export const backendBuckets = buckets.map((bucket) => bucket.name);
const protectedBackend = true;
export { protectedBackend as protected };
