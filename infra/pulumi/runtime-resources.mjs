import {
  assertAccountId,
  resolveEnvironment,
  resourcePolicy,
} from "./environments.mjs";
import { validateAdoptionManifest } from "./environment-manifest.mjs";
export function workerIdentityArgs({ accountId, name }) {
  assertAccountId(accountId);
  if (
    typeof name !== "string" ||
    !/^savia(?:-[a-z0-9]+)*$/.test(name) ||
    name.length > 63
  )
    throw new Error("Invalid Savia Worker identity");
  return { accountId, name, force: false };
}
export function workerIdentityOptions() {
  return {
    protect: true,
    ignoreChanges: [
      "subdomain",
      "logpush",
      "observability",
      "tags",
      "tailConsumers",
      "previewsBaseConfig",
    ],
  };
}
export function runtimeRegistrationPlan({
  accountId,
  environment,
  manifest,
  profile = manifest?.profile ?? {},
  importExisting = false,
  retired = false,
}) {
  assertAccountId(accountId);
  const descriptor = resolveEnvironment(environment);
  if (descriptor.kind === "management")
    throw new Error("Management has no Worker runtime");
  const validated = manifest
    ? validateAdoptionManifest(manifest, {
        accountId,
        environment,
        checkpoints: [],
      })
    : undefined;
  const enabled =
    profile.enabledWorkers ??
    validated?.resources
      .filter((row) => row.kind === "worker")
      .map((row) => row.name);
  const policy = resourcePolicy(environment, profile);
  if (
    !Array.isArray(enabled) ||
    !enabled.length ||
    new Set(enabled).size !== enabled.length ||
    enabled.some((name) => !policy.rules.get("worker")?.has(name))
  )
    throw new Error("An exact enabled Worker profile is required");
  const retained = profile.retentionWorkerNames ?? [];
  if (
    !Array.isArray(retained) ||
    retained.some((name) => !enabled.includes(name))
  )
    throw new Error("Invalid retained Worker profile");
  if (retired && descriptor.kind === "shared")
    throw new Error("Shared registry retirement is protected");
  const workers = enabled
    .filter((name) => !retired || retained.includes(name))
    .sort()
    .map((name) => {
      const existing = validated?.resources.find(
        (row) => row.kind === "worker" && row.name === name,
      );
      if (importExisting && !existing)
        throw new Error("Missing one-time Worker import identity");
      return {
        logicalName: `runtime-${name}`,
        args: workerIdentityArgs({ accountId, name }),
        options: {
          ...workerIdentityOptions(),
          ...(importExisting
            ? { import: `${accountId}/${existing.cloudId}` }
            : {}),
        },
      };
    });
  return { descriptor, workers, retired, manifest: validated };
}
