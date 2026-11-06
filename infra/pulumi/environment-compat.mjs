import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDestroyArgs } from "./destroy.mjs";
import { parseDeployArgs } from "./deploy-stack.mjs";
import {
  slugifyBranch,
  flagValue,
} from "../../scripts/preview-environment.mjs";
import {
  parseEnvironmentArgs,
  runEnvironmentOperation,
} from "./environment.mjs";
import { resolveEnvironment } from "./environments.mjs";
export function legacyDestroyTarget(kind, argv) {
  let environment, apply;
  if (kind === "branch") {
    environment = `branch-${slugifyBranch(flagValue(argv, "--branch"))}`;
    const dry = argv.includes("--dry-run");
    apply = argv.includes("--force");
    if (dry === apply)
      throw new Error("Choose exactly one of --dry-run or --force");
  } else {
    const parsed = parseDestroyArgs(argv);
    environment = parsed.environment;
    apply = !parsed.dryRun;
    if (argv.includes("--dry-run") && argv.includes("--apply"))
      throw new Error("Choose exactly one of --dry-run or --apply");
  }
  if (argv.includes("--delete-data") && argv.includes("--skip-empty-bucket"))
    throw new Error("Data deletion cannot skip bucket emptying");
  return { environment, apply, deleteData: argv.includes("--delete-data") };
}
export async function runLegacyDestroy(kind, argv, deps) {
  const { createEnvironmentDependencies, writePrivateJson, inventoryManifest } =
    await import("./environment-operations.mjs");
  deps ??= createEnvironmentDependencies();
  const target = legacyDestroyTarget(kind, argv),
    directory = await mkdtemp(join(tmpdir(), "savia-retirement-review-"));
  const manifest = join(directory, "manifest.json");
  await writePrivateJson(
    manifest,
    inventoryManifest(await deps.inventory(target.environment)),
  );
  const args = parseEnvironmentArgs([
    "destroy",
    "--environment",
    target.environment,
    "--manifest",
    manifest,
    ...(target.apply
      ? ["--apply"]
      : ["--plan", join(directory, "retirement.json")]),
    ...(target.deleteData ? ["--delete-data"] : []),
  ]);
  return runEnvironmentOperation(args, deps);
}
export async function runLegacyInfrastructure(argv, deps) {
  const { createEnvironmentDependencies } =
    await import("./environment-operations.mjs");
  deps ??= createEnvironmentDependencies();
  const { stack, apply } = parseDeployArgs(argv);
  const args = parseEnvironmentArgs(["plan", "--environment", stack]);
  const plan = await runEnvironmentOperation(args, deps);
  if (!apply) return plan;
  const descriptor = resolveEnvironment(stack),
    context = await deps.context(descriptor);
  return deps.applyPlan(plan, {
    descriptor,
    manifest: plan.manifest,
    context,
    args,
  });
}
