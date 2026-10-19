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
  bootstrapProof?: object;
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
  const original = (options.manifest ?? {}) as Record<string, any>;
  const releaseManifest =
    options.mode === "release"
      ? pulumi
          .all([
            pulumi.output(identities),
            pulumi.output(options.dataInventory ?? []),
          ])
          .apply(([items, data]) => ({
            ...original,
            version: 1,
            accountId: options.accountId,
            environment: options.environment,
            project: plan.descriptor.project,
            stack: plan.descriptor.stack,
            profile: {
              ...(original.profile ?? {}),
              enabledWorkers: items.map((row) => row.name).sort(),
              retentionWorkerNames: (
                original.profile?.retentionWorkerNames ?? []
              ).filter((name: string) =>
                items.some((row) => row.name === name),
              ),
            },
            resources: [
              ...(original.resources ?? []).filter(
                (row: any) =>
                  !["worker", "d1", "r2", "kv", "queue", "vectorize"].includes(
                    row.kind,
                  ),
              ),
              ...data,
              ...items.map((row) => ({
                ...original.resources?.find(
                  (old: any) => old.kind === "worker" && old.name === row.name,
                ),
                kind: "worker",
                ...row,
              })),
            ],
          }))
      : options.manifest;
  const release = plan.retired
    ? undefined
    : new RuntimeRelease(
        "runtime",
        {
          accountId: options.accountId,
          environment: options.environment,
          workers: identities,
          mode: options.mode ?? "adopt",
          adoptionManifest: releaseManifest,
          artifactDigest: options.artifactDigest,
          configDigest: options.configDigest,
          artifactDirectory: options.artifactDirectory,
          deleteData: options.deleteData ?? false,
          bootstrapProof: options.bootstrapProof,
        },
        runtimeDependencies,
        {
          dependsOn: [...workers, ...(options.dataDependencies ?? [])],
          protect: ["production", "shared"].includes(options.environment),
        },
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
    bootstrapProof: config.getObject<object>("runtimeBootstrapProof"),
    mode,
    artifactDigest: config.get("artifactDigest"),
    configDigest: config.get("configDigest"),
    artifactDirectory: config.get("artifactDirectory"),
  });
}
