import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import { runtimeRegistrationPlan } from "./runtime-resources.mjs";
import { RuntimeRelease } from "./runtime-resource.ts";
import { runtimeDependencies } from "./runtime-dependencies.mjs";

interface Registration {
  accountId: string;
  environment: string;
  manifest?: object;
  profile?: { enabledWorkers?: string[]; retentionWorkerNames?: string[] };
  importExisting?: boolean;
  retired?: boolean;
  deleteData?: boolean;
  mode?: "adopt" | "release";
  artifactDigest?: string;
  configDigest?: string;
  artifactDirectory?: string;
  dataDependencies?: pulumi.Resource[];
  dataInventory?: pulumi.Input<object[]>;
}
export function registerRuntime(options: Registration) {
  const plan = runtimeRegistrationPlan(
    options as Parameters<typeof runtimeRegistrationPlan>[0],
  );
  const workers = plan.workers.map(
    (definition) =>
      new cloudflare.Worker(
        definition.logicalName,
        definition.args,
        definition.options,
      ),
  );
  const identities = workers.map((worker) => ({
    name: worker.name,
    cloudId: worker.id,
  }));
  const release = plan.retired
    ? undefined
    : new RuntimeRelease(
        "runtime",
        {
          accountId: options.accountId,
          environment: options.environment,
          workers: identities,
          mode: options.mode ?? "adopt",
          adoptionManifest: options.manifest,
          artifactDigest: options.artifactDigest,
          configDigest: options.configDigest,
          artifactDirectory: options.artifactDirectory,
          deleteData: options.deleteData ?? false,
        },
        runtimeDependencies,
        { dependsOn: [...workers, ...(options.dataDependencies ?? [])] },
      );
  const inventory = pulumi.output({
    accountId: options.accountId,
    environment: options.environment,
    resources: pulumi
      .all([
        pulumi.output(identities),
        pulumi.output(options.dataInventory ?? []),
        release?.namespaceIds ??
          pulumi.output(
            (plan.manifest?.resources ?? [])
              .filter(
                (row: any) =>
                  row.kind === "durableObject" &&
                  plan.workers.some(
                    (worker) => worker.args.name === row.parentWorker,
                  ),
              )
              .map((row: any) => ({
                workerName: row.parentWorker,
                className: row.name.slice(row.parentWorker!.length + 1),
                namespaceId: row.cloudId,
              })),
          ),
        release?.attachments ?? pulumi.output([]),
      ])
      .apply(([ids, data, namespaces, attachments]) => [
        ...ids.map((worker) => ({ kind: "worker", ...worker })),
        ...data,
        ...namespaces.map((row: any) => ({
          kind: "durableObject",
          name: `${row.workerName}_${row.className}`,
          cloudId: row.namespaceId,
          parentWorker: row.workerName,
        })),
        ...attachments,
      ]),
    retentionWorkerNames:
      release?.retentionWorkerNames ??
      pulumi.output(
        (options.profile ?? plan.manifest?.profile)?.retentionWorkerNames ?? [],
      ),
  });
  return {
    workers,
    release,
    inventory,
    status: release?.status ?? pulumi.output("maintenance"),
  };
}
export function registerConfiguredRuntime(
  config: pulumi.Config,
  context: Pick<
    Registration,
    "accountId" | "environment" | "dataDependencies" | "dataInventory"
  >,
) {
  if (!config.getBoolean("runtimeManaged")) return undefined;
  const mode = config.get("runtimeMode") ?? "adopt";
  if (mode !== "adopt" && mode !== "release")
    throw new Error("Invalid runtime mode");
  return registerRuntime({
    ...context,
    manifest: config.getObject<object>("adoptionManifest"),
    profile: config.getObject<Registration["profile"]>("runtimeProfile"),
    importExisting: config.getBoolean("importRuntimeWorkers") ?? false,
    retired: config.getBoolean("runtimeRetired") ?? false,
    deleteData: config.getBoolean("deleteRuntimeData") ?? false,
    mode,
    artifactDigest: config.get("artifactDigest"),
    configDigest: config.get("configDigest"),
    artifactDirectory: config.get("artifactDirectory"),
  });
}
