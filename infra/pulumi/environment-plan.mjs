import { adoptionManifestHash } from "./environment-manifest.mjs";
function plannedImportIdentity(state, kind, name, accountId) {
  if (
    state.outputs?.accountId !== undefined &&
    state.outputs.accountId !== accountId
  )
    throw new Error("Import output account mismatch");
  if (state.importID === undefined) return undefined;
  if (
    typeof state.importID !== "string" ||
    !/^[a-f0-9]{32}$/.test(accountId ?? "")
  )
    throw new Error("Import requires a concrete account-qualified identity");
  const parts = state.importID.split("/");
  if (
    parts[0] !== accountId ||
    !parts[1] ||
    (kind === "r2"
      ? parts.length !== 3 || parts[1] !== name || parts[2] !== "default"
      : !["worker", "d1", "kv", "queue"].includes(kind) || parts.length !== 2)
  )
    throw new Error("Import identity account or resource path mismatch");
  const id = parts[1],
    known = [
      state.id,
      state.outputs?.id,
      ...(kind === "d1" ? [state.outputs?.uuid] : []),
    ];
  if (
    known.some(
      (value) =>
        value !== undefined && value !== id && value !== state.importID,
    )
  )
    throw new Error("Planned import disagrees with resolved physical identity");
  return id;
}
export function normalizeEnvironmentPlan(raw) {
  if (!Array.isArray(raw?.steps) || !raw.changeSummary)
    throw new Error("Detailed Pulumi preview is required");
  const kinds = {
    "cloudflare:index/worker:Worker": "worker",
    "cloudflare:index/d1Database:D1Database": "d1",
    "cloudflare:index/r2Bucket:R2Bucket": "r2",
    "cloudflare:index/workersKvNamespace:WorkersKvNamespace": "kv",
    "cloudflare:index/queue:Queue": "queue",
    "pulumi-nodejs:dynamic/vectorize:Index": "vectorize",
  };
  return {
    changeSummary: raw.changeSummary,
    steps: raw.steps.map((step) => {
      const state = step.newState ?? step.oldState ?? {},
        inputs = state.inputs ?? {},
        outputs = state.outputs ?? {};
      const inputChanges = [
        ...new Set([
          ...Object.keys(step.oldState?.inputs ?? {}),
          ...Object.keys(inputs),
        ]),
      ].filter(
        (key) =>
          JSON.stringify(step.oldState?.inputs?.[key]) !==
          JSON.stringify(inputs[key]),
      );
      const result = {
        inputChanges,
        op: step.op,
        type: state.type,
        urn: step.urn,
        kind: kinds[state.type],
        accountId: inputs.accountId ?? outputs.accountId,
        name:
          inputs.name ??
          inputs.queueName ??
          inputs.title ??
          outputs.name ??
          outputs.title ??
          outputs.queueName,
      };
      result.cloudId =
        result.kind === "r2" || result.kind === "vectorize"
          ? result.name
          : result.kind === "d1"
            ? (outputs.uuid ?? outputs.id ?? state.id)
            : state.id;
      if (step.op === "import") {
        const imported = plannedImportIdentity(
          state,
          result.kind,
          result.name,
          result.accountId,
        );
        if (imported !== undefined) result.cloudId = imported;
      }
      if (state.type === "pulumi-nodejs:dynamic/runtime:RuntimeRelease")
        Object.assign(result, {
          type: "savia:runtime:RuntimeRelease",
          accountId: inputs.accountId,
          environment: inputs.environment,
          mode: inputs.mode,
          deleteData: inputs.deleteData,
          inputChanges: [
            ...new Set([
              ...Object.keys(step.oldState?.inputs ?? {}),
              ...Object.keys(inputs),
            ]),
          ].filter(
            (key) =>
              JSON.stringify(step.oldState?.inputs?.[key]) !==
              JSON.stringify(inputs[key]),
          ),
          manifestHash: inputs.adoptionManifest
            ? adoptionManifestHash(inputs.adoptionManifest)
            : undefined,
        });
      if (state.type === "pulumi-nodejs:dynamic/vectorize:Index")
        Object.assign(result, {
          type: "savia:vectorize:Index",
          accountId: inputs.accountId,
          environment: inputs.environment,
          adoptExisting: inputs.adoptExisting,
          dimensions: inputs.dimensions,
          metric: inputs.metric,
          deleteData: inputs.deleteData,
        });
      return result;
    }),
  };
}

export function assertRetirementPlan(
  plan,
  { allowedDeletes, authorizeRuntime, authorizeResources = [] },
) {
  if (!Array.isArray(plan?.steps) || !Array.isArray(allowedDeletes))
    throw new Error("Reviewed retirement steps are required");
  for (const step of plan.steps) {
    if (["same", "read", "refresh", "read-discard"].includes(step.op)) continue;
    if (step.op === "update" && step.type === "pulumi:pulumi:Stack") continue;
    if (step.op === "delete" && allowedDeletes.includes(step.urn)) continue;
    if (
      step.op === "update" &&
      (step.urn === authorizeRuntime ||
        authorizeResources.includes(step.urn)) &&
      step.deleteData === true &&
      Array.isArray(step.inputChanges) &&
      step.inputChanges.every((key) =>
        ["deleteData", "__provider", "__meta"].includes(key),
      )
    )
      continue;
    throw new Error(`Unreviewed retirement mutation: ${step.op}/${step.urn}`);
  }
  return true;
}
