import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import { fixtureWorkerDefinitions } from "../../verify-runtime-lifecycle.mjs";

const config = new pulumi.Config();
const definitions = fixtureWorkerDefinitions(
  config.require("fixturePrefix"),
  config.require("accountId"),
);
export const workers = definitions.map(({ role, args }) => {
  const worker = new cloudflare.Worker(role, args);
  return { name: worker.name, cloudId: worker.id };
});
