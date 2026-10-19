// Cloud deletion belongs to native resources. This module removes runtime
// attachments first and leaves namespace hosts alive when retaining data.
export function planRuntimeRetirement(
  manifest,
  {
    deleteData = false,
    retainWorkers = manifest.profile?.retentionWorkerNames ?? [],
  } = {},
) {
  if (typeof deleteData !== "boolean")
    throw new Error("deleteData must be boolean");
  if (["shared", "management"].includes(manifest.environment))
    throw new Error("Environment is protected");
  if (!Array.isArray(manifest.resources))
    throw new Error("Resource manifest required");
  const workers = manifest.resources
    .filter((r) => r.kind === "worker")
    .map((r) => r.name)
    .sort();
  const namespaces = manifest.resources.filter(
    (r) => r.kind === "durableObject",
  );
  if (
    !Array.isArray(retainWorkers) ||
    retainWorkers.some((name) => !workers.includes(name))
  )
    throw new Error("A retained Worker is outside the environment");
  if (namespaces.some((r) => !workers.includes(r.parentWorker)))
    throw new Error("Namespace host is absent from manifest");
  const retainedWorkers = deleteData
    ? []
    : [
        ...new Set([
          ...namespaces.map((r) => r.parentWorker),
          ...retainWorkers,
        ]),
      ].sort();
  return Object.freeze({
    accountId: manifest.accountId,
    environment: manifest.environment,
    manifest,
    deleteData,
    retainedWorkers,
    deletedWorkers: workers.filter((w) => !retainedWorkers.includes(w)),
    retainedNamespaces: deleteData
      ? []
      : namespaces.map((r) => r.cloudId).sort(),
  });
}

export async function retireRuntime(
  state,
  {
    manifest,
    deleteData = false,
    retainWorkers = [
      ...(state.retentionWorkerNames ?? []),
      ...(manifest.profile?.retentionWorkerNames ?? []),
    ],
  },
  deps,
) {
  const plan = planRuntimeRetirement(manifest, { deleteData, retainWorkers });
  const names = new Set([...plan.retainedWorkers, ...plan.deletedWorkers]);
  const references = await deps.inspectReferences(plan);
  if (
    !Array.isArray(references) ||
    references.some((r) => !names.has(r.caller))
  )
    throw new Error(
      "References from outside the environment prevent retirement",
    );
  await deps.stopProducers(plan);
  await deps.removeIngress(plan);
  await deps.maintainHosts(plan);
  await deps.detachReferences(plan);
  await deps.removeWorkflows(plan);
  const live = await deps.readNamespaces(plan);
  const ids = new Set(live.map((r) => r.namespaceId));
  if (plan.retainedNamespaces.some((id) => !ids.has(id)))
    throw new Error("Retained namespace identity changed during maintenance");
  return {
    ...state,
    status: "maintenance",
    retainedWorkers: plan.retainedWorkers,
    deletedWorkers: plan.deletedWorkers,
  };
}
