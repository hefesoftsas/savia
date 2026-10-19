const inputKeys = [
  "accountId",
  "environment",
  "workers",
  "mode",
  "artifactDigest",
  "configDigest",
  "artifactDirectory",
  "adoptionManifest",
  "deleteData",
];
export function validateRuntimeInputs(inputs) {
  if (!inputs || Object.keys(inputs).some((k) => !inputKeys.includes(k)))
    throw new Error("Invalid runtime input fields");
  if (
    typeof inputs.accountId !== "string" ||
    typeof inputs.environment !== "string" ||
    !/^[a-f\d]{32}$/.test(inputs.accountId) ||
    !/^[a-z][a-z0-9-]+$/.test(inputs.environment)
  )
    throw new Error("Invalid runtime identity");
  if (!["adopt", "release"].includes(inputs.mode))
    throw new Error("Invalid runtime mode");
  if (
    !Array.isArray(inputs.workers) ||
    !inputs.workers.length ||
    inputs.workers.some(
      (w) =>
        !w ||
        typeof w.name !== "string" ||
        typeof w.cloudId !== "string" ||
        !/^[a-z0-9][a-z0-9-]+$/.test(w.name) ||
        !/^[a-f\d]{32}$/.test(w.cloudId) ||
        Object.keys(w).some((k) => !["name", "cloudId"].includes(k)),
    )
  )
    throw new Error("Invalid Worker identity");
  if (new Set(inputs.workers.map((w) => w.name)).size !== inputs.workers.length)
    throw new Error("Duplicate Worker identity");
  if (
    new Set(inputs.workers.map((w) => w.cloudId)).size !== inputs.workers.length
  )
    throw new Error("Duplicate cloud identity");
  if (inputs.adoptionManifest) {
    const manifest = inputs.adoptionManifest;
    const allowed = [
      "version",
      "accountId",
      "environment",
      "project",
      "stack",
      "profile",
      "resources",
      "createdAt",
    ];
    if (
      typeof manifest !== "object" ||
      Array.isArray(manifest) ||
      Object.keys(manifest).some((key) => !allowed.includes(key))
    )
      throw new Error("Invalid adoption manifest fields");
    const rowFields = [
      "kind",
      "name",
      "cloudId",
      "ownerStack",
      "parentWorker",
      "versionId",
      "namespaceIds",
      "dependencies",
    ];
    if (
      !Array.isArray(manifest.resources) ||
      manifest.resources.some(
        (row) =>
          !row ||
          Object.keys(row).some((key) => !rowFields.includes(key)) ||
          Object.entries(row).some(([key, value]) => {
            if (["namespaceIds", "dependencies"].includes(key))
              return (
                !Array.isArray(value) ||
                value.some((item) => typeof item !== "string")
              );
            return value !== null && typeof value !== "string";
          }),
      )
    )
      throw new Error("Invalid adoption manifest resource fields");
    if (manifest.profile) {
      const profileKeys = [
        "enabledWorkers",
        "flowsEnabled",
        "searchEnabled",
        "tenantSubdomains",
        "databaseNames",
        "retentionWorkerNames",
      ];
      if (
        Object.keys(manifest.profile).some((key) => !profileKeys.includes(key))
      )
        throw new Error("Invalid adoption manifest fields");
      for (const [key, value] of Object.entries(manifest.profile)) {
        if (
          [
            "enabledWorkers",
            "tenantSubdomains",
            "retentionWorkerNames",
          ].includes(key) &&
          (!Array.isArray(value) ||
            value.some((item) => typeof item !== "string"))
        )
          throw new Error("Invalid adoption manifest fields");
        if (
          ["flowsEnabled", "searchEnabled"].includes(key) &&
          typeof value !== "boolean"
        )
          throw new Error("Invalid adoption manifest fields");
        if (
          key === "databaseNames" &&
          (typeof value !== "object" ||
            Object.keys(value).some(
              (field) => !["auth", "domain"].includes(field),
            ) ||
            Object.values(value).some((item) => typeof item !== "string"))
        )
          throw new Error("Invalid adoption manifest fields");
      }
    }
    for (const key of [
      "accountId",
      "environment",
      "project",
      "stack",
      "createdAt",
    ])
      if (manifest[key] !== undefined && typeof manifest[key] !== "string")
        throw new Error("Invalid adoption manifest fields");
    if (manifest.version !== undefined && manifest.version !== 1)
      throw new Error("Invalid adoption manifest fields");
    if (
      manifest.accountId !== inputs.accountId ||
      manifest.environment !== inputs.environment ||
      inputs.workers.some(
        (w) =>
          !manifest.resources.some(
            (r) =>
              r.kind === "worker" &&
              r.name === w.name &&
              r.cloudId === w.cloudId,
          ),
      )
    )
      throw new Error("Adoption manifest does not match runtime identity");
  }
  for (const key of ["deleteData"])
    if (inputs[key] !== undefined && typeof inputs[key] !== "boolean")
      throw new Error(`Invalid ${key}`);
  if (
    inputs.mode === "release" &&
    (!/^[a-f\d]{64}$/.test(inputs.artifactDigest) ||
      !/^[a-f\d]{64}$/.test(inputs.configDigest) ||
      typeof inputs.artifactDirectory !== "string" ||
      !inputs.artifactDirectory.startsWith("/"))
  )
    throw new Error("Release requires prepared immutable artifacts");
  return inputs;
}
const identity = (x) =>
  JSON.stringify([
    x.accountId,
    x.environment,
    [...x.workers]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ name, cloudId }) => [name, cloudId]),
  ]);
const digest = async (x) => {
  // Resolve native modules inside the operation so Pulumi's closure serializer
  // does not try to copy Node's native Hash constructor into provider code.
  const { createHash } = await import("node:crypto");
  return createHash("sha256")
    .update(`${x.artifactDigest}:${x.configDigest}`)
    .digest("hex");
};

export function diffRuntimeInputs(previous, next) {
  validateRuntimeInputs(previous);
  validateRuntimeInputs(next);
  if (identity(previous) !== identity(next))
    throw new Error("Runtime identity change requires a separate migration");
  return {
    changes:
      previous.mode !== next.mode ||
      previous.artifactDigest !== next.artifactDigest ||
      previous.configDigest !== next.configDigest ||
      !!previous.deleteData !== !!next.deleteData,
    replaces: [],
  };
}

function cleanSnapshot(snapshot, inputs) {
  if (
    !snapshot ||
    !Array.isArray(snapshot.workerVersions) ||
    !Array.isArray(snapshot.namespaceIds) ||
    !Array.isArray(snapshot.attachments)
  )
    throw new Error("Incomplete runtime snapshot");
  const workerVersions = snapshot.workerVersions.map(
    ({ name, cloudId, versionId }) => {
      if (
        !inputs.workers.some((w) => w.name === name && w.cloudId === cloudId) ||
        typeof versionId !== "string"
      )
        throw new Error("Snapshot Worker identity mismatch");
      return { name, cloudId, versionId };
    },
  );
  if (
    workerVersions.length !== inputs.workers.length ||
    new Set(workerVersions.map((w) => w.name)).size !== workerVersions.length
  )
    throw new Error("Missing runtime Worker");
  const namespaceIds = snapshot.namespaceIds.map(
    ({ workerName, className, namespaceId }) => {
      if (
        !inputs.workers.some((w) => w.name === workerName) ||
        !/^[a-f\d]{32}$/.test(namespaceId) ||
        typeof className !== "string"
      )
        throw new Error("Invalid namespace snapshot");
      return { workerName, className, namespaceId };
    },
  );
  const attachments = snapshot.attachments.map((row) => {
    const clean = {};
    for (const key of ["kind", "name", "cloudId", "parentWorker"]) {
      if (typeof row[key] !== "string")
        throw new Error("Invalid attachment snapshot");
      clean[key] = row[key];
    }
    if (!inputs.workers.some((w) => w.name === clean.parentWorker))
      throw new Error("Foreign runtime attachment");
    return clean;
  });
  const secretWorkerNames = snapshot.secretWorkerNames ?? [];
  if (
    !Array.isArray(secretWorkerNames) ||
    secretWorkerNames.some(
      (name) =>
        typeof name !== "string" ||
        !inputs.workers.some((worker) => worker.name === name),
    )
  )
    throw new Error("Invalid secret host metadata");
  const retentionWorkerNames = [
    ...new Set([
      ...secretWorkerNames,
      ...namespaceIds.map((row) => row.workerName),
    ]),
  ].sort();
  return { workerVersions, namespaceIds, attachments, retentionWorkerNames };
}
const sorted = (rows) =>
  JSON.stringify(
    rows
      .map((row) =>
        Object.fromEntries(
          Object.entries(row).sort(([a], [b]) => a.localeCompare(b)),
        ),
      )
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  );
export async function readRuntime(inputs, previous, deps) {
  validateRuntimeInputs(inputs);
  const live = cleanSnapshot(await deps.readSnapshot(inputs), inputs);
  const drift =
    previous?.status === "ready" &&
    previous.workerVersions &&
    (sorted(previous.workerVersions) !== sorted(live.workerVersions) ||
      sorted(previous.namespaceIds ?? []) !== sorted(live.namespaceIds));
  return {
    runtimeId: `${inputs.accountId}/${inputs.environment}`,
    ...live,
    releaseDigest: previous?.releaseDigest ?? null,
    status: drift ? "maintenance" : (previous?.status ?? "adopted"),
  };
}
export async function adoptRuntime(inputs, deps) {
  validateRuntimeInputs(inputs);
  const manifest = inputs.adoptionManifest;
  if (
    manifest?.accountId !== inputs.accountId ||
    manifest?.environment !== inputs.environment ||
    inputs.workers.some(
      (w) =>
        !manifest.resources?.some(
          (r) =>
            r.kind === "worker" && r.name === w.name && r.cloudId === w.cloudId,
        ),
    )
  )
    throw new Error("Adoption manifest does not match runtime identity");
  return readRuntime(inputs, { status: "adopted" }, deps);
}
export async function releaseRuntime(previous, inputs, deps) {
  validateRuntimeInputs(inputs);
  if (inputs.mode !== "release")
    throw new Error("Explicit release mode required");
  const verified = await deps.verifyArtifact(inputs);
  const bootstrap = deps.bootstrap
    ? await deps.bootstrap(inputs)
    : { createdWorkers: [] };
  if (
    !Array.isArray(bootstrap.createdWorkers) ||
    bootstrap.createdWorkers.some(
      (name) => !inputs.workers.some((worker) => worker.name === name),
    )
  )
    throw new Error("Invalid bootstrap Worker identities");
  const before = await readRuntime(inputs, previous, deps);
  try {
    await deps.publish(inputs, before);
    const after = await readRuntime(inputs, previous, deps);
    const key = (row) => `${row.workerName}/${row.className}`;
    const oldNamespaces = new Map(
      before.namespaceIds.map((row) => [key(row), row.namespaceId]),
    );
    const newNamespaces = new Map(
      after.namespaceIds.map((row) => [key(row), row.namespaceId]),
    );
    if (
      before.namespaceIds.some(
        (row) => newNamespaces.get(key(row)) !== row.namespaceId,
      ) ||
      after.namespaceIds.some(
        (row) =>
          !oldNamespaces.has(key(row)) &&
          !bootstrap.createdWorkers.includes(row.workerName) &&
          !verified?.declaredNamespaces?.some(
            (declared) => key(declared) === key(row),
          ),
      )
    )
      throw new Error("Publication changed namespace identities");
    return { ...after, status: "ready", releaseDigest: await digest(inputs) };
  } catch (publicationError) {
    try {
      await deps.recover(before, inputs);
      const recovered = await readRuntime(inputs, before, deps);
      if (
        sorted(before.workerVersions) !== sorted(recovered.workerVersions) ||
        sorted(before.namespaceIds) !== sorted(recovered.namespaceIds)
      )
        throw new Error("Recovered versions or namespaces differ");
    } catch (recoveryError) {
      try {
        await deps.pause(inputs);
      } catch (pauseError) {
        throw new AggregateError(
          [publicationError, recoveryError, pauseError],
          "Runtime publication failed with incomplete recovery; emergency pause failed",
        );
      }
      throw new AggregateError(
        [publicationError, recoveryError],
        "Runtime publication failed with incomplete recovery; environment paused",
      );
    }
    throw publicationError;
  }
}
