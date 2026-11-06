import { resourcePolicy } from "./environments.mjs";
const codeOnlyWorkerNames = Object.freeze({
  auth: "savia-auth-preview",
  api: "savia-agencies-preview",
  request: "savia-request-preview",
  connectors: "savia-connectors-preview",
  gateway: "savia-preview",
  pluginEditor: "savia-plugin-editor-preview",
});
const frontendCodeOnlyTargets = Object.freeze(["gateway", "pluginEditor"]);
export function expectedPreviewCodeOnlyWorkers(releaseSource) {
  if (!releaseSource || !Object.hasOwn(releaseSource, "codeOnly")) return null;
  const scope = releaseSource.codeOnly,
    targets = scope?.targets;
  if (
    Object.keys(releaseSource).sort().join(",") !==
      "codeOnly,sourceRevision,version" ||
    releaseSource.version !== 1 ||
    !/^[a-f\d]{40}$/.test(releaseSource.sourceRevision ?? "") ||
    !scope ||
    Object.keys(scope).sort().join(",") !== "base,head,targets" ||
    !/^[a-f\d]{40}$/.test(scope.base ?? "") ||
    !/^[a-f\d]{40}$/.test(scope.head ?? "") ||
    scope.base === scope.head ||
    scope.head !== releaseSource.sourceRevision ||
    !Array.isArray(targets) ||
    !targets.length ||
    targets.some(
      (target) =>
        typeof target !== "string" ||
        !Object.hasOwn(codeOnlyWorkerNames, target),
    ) ||
    (targets.some((target) => frontendCodeOnlyTargets.includes(target)) &&
      (targets.length !== frontendCodeOnlyTargets.length ||
        frontendCodeOnlyTargets.some((target) => !targets.includes(target)))) ||
    new Set(targets).size !== targets.length
  )
    throw new Error("Invalid verified Preview code scope");
  return targets.map((target) => codeOnlyWorkerNames[target]).sort();
}
export function assertRuntimeBindings(inputs, configs, { releaseSource } = {}) {
  const policy = resourcePolicy(
      inputs.environment,
      inputs.adoptionManifest?.profile ?? {},
    ),
    own = new Set(inputs.workers.map((row) => row.name)),
    seen = new Set(),
    resources = inputs.adoptionManifest?.resources ?? [];
  const expected = expectedPreviewCodeOnlyWorkers(releaseSource);
  if (expected && inputs.environment !== "preview")
    throw new Error("Verified code scope is only allowed in Preview");
  const data = (kind, id, byName = false) => {
    if (
      !resources.some(
        (row) => row.kind === kind && (byName ? row.name : row.cloudId) === id,
      )
    )
      throw new Error(
        "Prepared binding targets an unreviewed environment data identity",
      );
  };
  const attachment = (kind, name, parentWorker) => {
    if (!policy.matches({ kind, name, parentWorker }))
      throw new Error(
        "Prepared attachment target is outside the selected environment",
      );
  };
  for (const config of configs) {
    if (
      !own.has(config.name) ||
      seen.has(config.name) ||
      (config.account_id && config.account_id !== inputs.accountId)
    )
      throw new Error("Prepared Worker target/account mismatch");
    seen.add(config.name);
    for (const binding of config.d1_databases ?? [])
      data("d1", binding.database_id);
    for (const binding of config.r2_buckets ?? []) {
      data("r2", binding.bucket_name, true);
      if (binding.jurisdiction && binding.jurisdiction !== "default")
        throw new Error("Unreviewed R2 jurisdiction binding");
    }
    for (const binding of config.kv_namespaces ?? []) data("kv", binding.id);
    for (const binding of config.queues?.producers ?? [])
      data("queue", binding.queue, true);
    for (const binding of config.queues?.consumers ?? []) {
      data("queue", binding.queue, true);
      attachment("consumer", binding.queue, config.name);
      if (binding.dead_letter_queue)
        data("queue", binding.dead_letter_queue, true);
    }
    for (const binding of config.vectorize ?? [])
      data("vectorize", binding.index_name, true);
    for (const binding of config.services ?? [])
      if (
        (!own.has(binding.service) &&
          binding.service !== "savia-plugin-registry") ||
        (binding.environment && binding.environment !== "production")
      )
        throw new Error("Service binding crosses environment ownership");
    for (const binding of config.durable_objects?.bindings ?? []) {
      const host = binding.script_name ?? config.name;
      if (
        !own.has(host) ||
        (binding.environment && binding.environment !== "production")
      )
        throw new Error("Durable Object binding crosses environment ownership");
      attachment("durableObject", `${host}_${binding.class_name}`, host);
    }
    for (const binding of config.workflows ?? [])
      attachment("workflow", binding.name, config.name);
    for (const cron of config.triggers?.crons ?? [])
      attachment("cron", cron, config.name);
    for (const route of [
      ...(config.routes ?? []),
      ...(config.route ? [config.route] : []),
    ]) {
      const row = typeof route === "string" ? { pattern: route } : route;
      if (
        (row.zone_name && row.zone_name !== "hefesoft.com") ||
        (row.zone_id && row.zone_id !== "b3255bc65c2bc8cb8edf33a34e08b255")
      )
        throw new Error("Route binding targets an unreviewed environment zone");
      attachment(
        row.custom_domain ? "domain" : "route",
        row.pattern,
        config.name,
      );
    }
  }
  if (expected) {
    if (
      configs.length !== expected.length ||
      [...seen].sort().join("\n") !== expected.join("\n") ||
      expected.some((name) => !own.has(name))
    )
      throw new Error(
        "Prepared Workers do not exactly match verified code scope",
      );
  } else if (seen.size !== own.size)
    throw new Error("Missing prepared Worker profile");
  return true;
}
