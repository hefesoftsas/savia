import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { assertAccountId, resolveEnvironment } from "./environments.mjs";
import {
  validateAdoptionManifest,
  adoptionManifestHash,
  assertAdoptionPlan,
} from "./environment-manifest.mjs";
import { validateManagementOutputs } from "./management-resources.mjs";

export function parseEnvironmentArgs(argv) {
  const action = argv[0];
  if (!["inventory", "adopt", "plan", "apply", "destroy"].includes(action))
    throw new Error("Choose inventory, adopt, plan, apply or destroy");
  const values = {},
    flags = new Set(),
    valueFlags = [
      "--environment",
      "--manifest",
      "--artifact",
      "--plan",
      "--out",
    ],
    switches = ["--all", "--apply", "--delete-data", "--provision"];
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index];
    if (flags.has(flag) || Object.hasOwn(values, flag))
      throw new Error("Duplicate lifecycle option");
    if (valueFlags.includes(flag)) {
      const value = argv[++index];
      if (!value || value.startsWith("--"))
        throw new Error(`Missing ${flag} value`);
      values[flag] = value;
    } else if (switches.includes(flag)) flags.add(flag);
    else throw new Error(`Unknown lifecycle option: ${flag}`);
  }
  const all = flags.has("--all"),
    environment = values["--environment"];
  if (all ? action !== "inventory" || environment : !environment)
    throw new Error(
      "An exact environment is required; --all is inventory-only",
    );
  if (environment) resolveEnvironment(environment);
  if (action !== "inventory" && (all || environment?.includes("*")))
    throw new Error("Wildcard mutations are forbidden");
  if (["adopt", "destroy"].includes(action) && !values["--manifest"])
    throw new Error("Reviewed --manifest is required");
  if (action === "apply") {
    const provision = flags.has("--provision");
    if (
      !values["--plan"] ||
      !flags.has("--apply") ||
      (provision ? values["--artifact"] : !values["--artifact"])
    )
      throw new Error(
        provision
          ? "Provision apply requires --plan and --apply without --artifact"
          : "Release apply requires --artifact, --plan and --apply",
      );
  }
  if (
    flags.has("--provision") &&
    (!["plan", "apply"].includes(action) || values["--artifact"])
  )
    throw new Error("--provision is an infrastructure-only plan option");
  if (flags.has("--delete-data") && action !== "destroy")
    throw new Error("--delete-data is destroy-only");
  if (
    action === "inventory" &&
    (flags.has("--apply") || flags.has("--delete-data"))
  )
    throw new Error("Inventory is read-only");
  return {
    action,
    environment,
    all,
    manifest: values["--manifest"],
    artifact: values["--artifact"],
    plan: values["--plan"],
    out: values["--out"],
    apply: flags.has("--apply"),
    deleteData: flags.has("--delete-data"),
    provision: flags.has("--provision"),
  };
}
function reviewedLiveIdentity(manifest, live) {
  const key = (row) => `${row.kind}/${row.name}/${row.cloudId}`;
  if (
    (live.profile?.retentionWorkerNames ?? []).some(
      (name) => !manifest.profile?.retentionWorkerNames?.includes(name),
    )
  )
    throw new Error(
      "New data/key retention requirements need a fresh reviewed manifest",
    );
  if (
    manifest.resources.length !== live.resources.length ||
    manifest.resources.some(
      (row) =>
        !live.resources.some(
          (actual) =>
            key(row) === key(actual) &&
            (row.versionId === undefined || row.versionId === actual.versionId),
        ),
    )
  )
    throw new Error("Live resources changed since the reviewed manifest");
}
export async function runEnvironmentOperation(args, deps) {
  const accountId = assertAccountId(deps.env.CLOUDFLARE_ACCOUNT_ID);
  if (args.action === "inventory")
    return args.all ? deps.inventoryAll() : deps.inventory(args.environment);
  const descriptor = resolveEnvironment(args.environment);
  if (
    descriptor.environment === "production" &&
    (deps.env.PRODUCTION_OPERATIONS_ENABLED !== "true" ||
      deps.env.GITHUB_REF !== "refs/heads/main")
  )
    throw new Error(
      "Production mutation is disabled or is not running from reviewed main",
    );
  if (
    args.action === "destroy" &&
    ["shared", "management"].includes(descriptor.kind)
  )
    throw new Error("Shared and management environments are protected");
  if (descriptor.kind === "management")
    throw new Error(
      "Management requires the reviewed ownership-transfer operation",
    );
  const context = await deps.context(descriptor);
  validateManagementOutputs(context.management, {
    accountId,
    backendUrl: context.backendUrl,
  });
  const live = await deps.inventory(args.environment);
  const saved =
    args.action === "apply" ? await deps.readSavedPlan(args.plan) : undefined;
  if (
    saved &&
    (saved.accountId !== accountId ||
      saved.environment !== args.environment ||
      saved.operation !== (args.provision ? "provision" : "release"))
  )
    throw new Error("Saved plan identity mismatch");
  const raw = args.manifest
    ? await deps.readManifest(args.manifest)
    : (saved?.manifest ??
      Object.fromEntries(
        [
          "version",
          "accountId",
          "environment",
          "project",
          "stack",
          "profile",
          "resources",
          "createdAt",
        ]
          .filter((key) => live[key] !== undefined)
          .map((key) => [key, live[key]]),
      ));
  const manifest = validateAdoptionManifest(raw, {
    accountId,
    environment: args.environment,
    checkpoints: context.checkpoints,
  });
  reviewedLiveIdentity(manifest, live);
  if (args.provision && manifest.resources.length)
    throw new Error(
      "Infrastructure provisioning requires an empty environment manifest",
    );
  const manifestHash = adoptionManifestHash(manifest);
  if (args.action === "destroy") {
    const refs = await deps.inspectReferences(manifest);
    const own = new Set(
      manifest.resources
        .filter((row) => row.kind === "worker")
        .map((row) => row.name),
    );
    if (refs.some((row) => !own.has(row.caller)))
      throw new Error(
        "Foreign callers reference resources outside their environment",
      );
    if (!args.apply)
      return deps.planOperation({
        descriptor,
        manifest,
        manifestHash,
        operation: "retire",
        deleteData: args.deleteData,
        args,
        context,
      });
    await deps.retire({
      descriptor,
      manifest,
      manifestHash,
      deleteData: args.deleteData,
      args,
      context,
    });
    if (args.deleteData)
      await deps.destroyData({
        descriptor,
        manifest,
        manifestHash,
        args,
        context,
      });
    return {
      status: args.deleteData ? "deleted" : "maintenance",
      environment: args.environment,
    };
  }
  if (
    args.action === "adopt" &&
    (await deps.alreadyAdopted({ descriptor, manifest, context }))
  )
    return { status: "already-adopted", environment: args.environment };
  if (saved) {
    if (saved.manifestHash !== manifestHash)
      throw new Error("Saved plan manifest identity mismatch");
    return deps.applyPlan(saved, { descriptor, manifest, context, args });
  }
  if (
    args.provision &&
    (manifest.resources.some((row) => row.kind === "worker") ||
      context.checkpoint?.stateExport?.deployment?.resources.some(
        (row) => row.type === "pulumi-nodejs:dynamic/runtime:RuntimeRelease",
      ))
  )
    throw new Error(
      "Infrastructure provisioning cannot remove an active or retained runtime; adopt or release it instead",
    );
  const operation = args.provision
    ? "provision"
    : args.action === "adopt"
      ? "adopt"
      : args.artifact
        ? "release"
        : "infrastructure";
  const plan = await deps.planOperation({
    descriptor,
    manifest,
    manifestHash,
    operation,
    args,
    context,
  });
  if (operation === "adopt") assertAdoptionPlan(plan, manifest);
  if (
    plan.accountId !== accountId ||
    plan.environment !== args.environment ||
    plan.manifestHash !== manifestHash ||
    plan.operation !== operation
  )
    throw new Error("Generated plan identity mismatch");
  if ((args.action === "adopt" || args.provision) && args.apply)
    return deps.applyPlan(plan, { descriptor, manifest, context, args });
  return plan;
}
async function main() {
  const args = parseEnvironmentArgs(process.argv.slice(2));
  const { createEnvironmentDependencies, writePrivateJson, inventoryManifest } =
    await import("./environment-operations.mjs");
  const result = await runEnvironmentOperation(
    args,
    createEnvironmentDependencies(),
  );
  if (args.out)
    await writePrivateJson(
      resolve(args.out),
      args.action === "inventory" && !args.all
        ? inventoryManifest(result)
        : result,
    );
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
