import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  chmod,
  appendFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertBackendConfigured, assertSafePlan } from "./deploy-stack.mjs";
import { renderEnvFromOutputs } from "./outputs.mjs";
import {
  assertAccountId,
  productionBackupLifecycleRule,
  stateBackendUrl,
} from "./naming.mjs";
import { resolveEnvironment, resourcePolicy } from "./environments.mjs";
import { inventoryEnvironment } from "./environment-inventory.mjs";
import {
  validateAdoptionManifest,
  adoptionManifestHash,
  assertAdoptionPlan,
} from "./environment-manifest.mjs";
import {
  validateManagementOutputs,
  settledCheckpoint,
} from "./management-resources.mjs";
import { listEnvironmentCloudResources } from "./environment-cloud.mjs";
import { readStateCatalog, normalizeCheckpoint } from "./environment-state.mjs";
import {
  normalizeEnvironmentPlan,
  assertRetirementPlan,
} from "./environment-plan.mjs";
import { verifyRuntimeArtifact } from "./runtime-publisher.mjs";
import { planRuntimeRetirement } from "./runtime-retirement.mjs";
import { emptyBucketForDestroy } from "./destroy.mjs";
import { createRuntimeCloudClient } from "./runtime-cloud.mjs";
import { execFileWithInput } from "./runtime-publisher-branch.mjs";
import { runWithCommandDiagnostics } from "./command-diagnostics.mjs";
import {
  previewNames,
  slugifyBranch,
} from "../../scripts/preview-environment.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const hash = (value) =>
  createHash("sha256")
    .update(
      typeof value === "string" || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(value),
    )
    .digest("hex");
const canonicalJson = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        )
      : item,
  );
export async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(value, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
  await chmod(path, 0o600);
}
export function inventoryManifest(value) {
  return Object.fromEntries(
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
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, value[key]]),
  );
}
export function verifySavedEnvironmentPlan(plan, actual) {
  for (const key of [
    "accountId",
    "environment",
    "operation",
    "checkpointFingerprint",
    "artifactDigest",
    "configDigest",
    "revision",
    "pulumiPlanDigest",
  ])
    if (plan[key] !== actual[key])
      throw new Error(`Saved plan no longer matches ${key}`);
  return true;
}
export function assertProvisionPlan(
  plan,
  environment,
  { accountId, profile = {} } = {},
) {
  const descriptor = resolveEnvironment(environment),
    stackPrefix = `urn:pulumi:${descriptor.stack}::${descriptor.project}::`,
    selectedProfile = {
      ...profile,
      ...(environment === "production" && !profile.databaseNames
        ? {
            databaseNames: {
              auth: "savia-auth-local-canonical-20260913-v2",
              domain: "savia-agencies-local-canonical-20260913-v2",
            },
          }
        : {}),
    },
    policy = resourcePolicy(environment, selectedProfile),
    persistenceTypes = {
      d1: "cloudflare:index/d1Database:D1Database",
      r2: "cloudflare:index/r2Bucket:R2Bucket",
      kv: "cloudflare:index/workersKvNamespace:WorkersKvNamespace",
      queue: "cloudflare:index/queue:Queue",
      vectorize: "savia:vectorize:Index",
    },
    protectedBackupTypes = new Map([
      [
        "cloudflare:index/r2BucketLifecycle:R2BucketLifecycle",
        "production-backups-lifecycle",
      ],
      [
        "cloudflare:index/r2ManagedDomain:R2ManagedDomain",
        "production-backups-public-access",
      ],
    ]),
    unchanged = new Set(["same", "read", "refresh", "read-discard"]);
  if (!Array.isArray(plan?.steps))
    throw new Error("First-install persistence plan is required");
  const hasBackupPolicy = plan.steps.some((step) =>
      protectedBackupTypes.has(step.type),
    ),
    hasProductionBackupBucket = plan.steps.some(
      (step) =>
        step.type === "cloudflare:index/r2Bucket:R2Bucket" &&
        step.name === "savia-production-backups" &&
        step.accountId === accountId &&
        step.storageClass === "Standard",
    );
  if (
    hasBackupPolicy &&
    descriptor.environment === "production" &&
    !hasProductionBackupBucket
  )
    throw new Error(
      "Production backup policy has no matching protected bucket",
    );
  for (const step of plan.steps) {
    if (typeof step.urn !== "string" || !step.urn.startsWith(stackPrefix))
      throw new Error("Provision plan contains a resource outside its stack");
    if (step.type?.startsWith("pulumi:providers:")) {
      if (
        step.type !== "pulumi:providers:cloudflare" ||
        !["create", "same", "read", "refresh", "read-discard"].includes(step.op)
      )
        throw new Error("Provision plan contains an unsafe provider operation");
      continue;
    }
    if (step.type === "pulumi:pulumi:Stack") {
      if (!["create", "update", "same"].includes(step.op))
        throw new Error("Provision plan contains an unsafe stack operation");
      continue;
    }
    const backupLogicalName = protectedBackupTypes.get(step.type);
    if (
      backupLogicalName &&
      descriptor.environment === "production" &&
      step.urn.endsWith(`::${backupLogicalName}`) &&
      accountId &&
      step.accountId === accountId &&
      step.bucketName === "savia-production-backups" &&
      (step.type !== "cloudflare:index/r2BucketLifecycle:R2BucketLifecycle" ||
        canonicalJson(step.rules) ===
          canonicalJson([productionBackupLifecycleRule()])) &&
      (step.type !== "cloudflare:index/r2ManagedDomain:R2ManagedDomain" ||
        step.enabled === false) &&
      (step.op === "create" || unchanged.has(step.op))
    )
      continue;
    if (
      !Object.hasOwn(persistenceTypes, step.kind) ||
      step.type !== persistenceTypes[step.kind] ||
      !accountId ||
      step.accountId !== accountId ||
      !policy.matches({ kind: step.kind, name: step.name }) ||
      (environment === "production" &&
        selectedProfile.flowsEnabled !== true &&
        step.name.startsWith("savia-flows")) ||
      ["savia-pulumi-state-preview", "savia-pulumi-state"].includes(step.name)
    )
      throw new Error("Provision plan contains a non-persistence resource");
    if (step.op === "create" || unchanged.has(step.op)) continue;
    throw new Error("Provision plan may create persistence only");
  }
  return true;
}
function stackOutputs(checkpoint) {
  return (
    (checkpoint ? settledCheckpoint(checkpoint.stateExport) : []).find(
      (row) => row.type === "pulumi:pulumi:Stack",
    )?.outputs ?? {}
  );
}
function managementProof(checkpoint, accountId, backendUrl) {
  if (!checkpoint)
    throw new Error("Independent management checkpoint is required");
  const outputs = stackOutputs(checkpoint);
  const value = { ...outputs, checkpoint: checkpoint.stateExport };
  validateManagementOutputs(value, { accountId, backendUrl });
  // Persist only the one public custody row, never provider config or secrets.
  return {
    accountId,
    backendBuckets: value.backendBuckets,
    protected: true,
    checkpoint: {
      deployment: {
        resources: settledCheckpoint(checkpoint.stateExport)
          .filter((row) => row.type === "cloudflare:index/r2Bucket:R2Bucket")
          .map((row) => ({
            urn: row.urn,
            type: row.type,
            id: row.id,
            protect: row.protect,
            inputs: { accountId: row.inputs.accountId, name: row.inputs.name },
            outputs: {
              accountId: row.outputs.accountId,
              name: row.outputs.name,
            },
          })),
      },
    },
  };
}
export function retirementRows(
  state,
  manifest,
  { kind, names = [], deleteData = false },
) {
  const rows = settledCheckpoint(state),
    result = [];
  const prefix = `urn:pulumi:${manifest.stack}::${manifest.project}::`;
  for (const row of rows) {
    if (
      row.type === "pulumi:pulumi:Stack" ||
      row.type?.startsWith("pulumi:providers:")
    )
      continue;
    const worker = row.type === "cloudflare:index/worker:Worker";
    if (kind === "workers" && (!worker || !names.includes(row.outputs?.name)))
      continue;
    if (kind === "data" && worker)
      throw new Error("Runtime Workers must retire before data deletion");
    if (
      kind === "workers" &&
      !deleteData &&
      manifest.profile?.retentionWorkerNames?.includes(row.outputs?.name)
    )
      throw new Error(
        "A retained Worker cannot be unprotected without data deletion",
      );
    if (
      !row.urn?.startsWith(prefix) ||
      row.inputs?.accountId !== manifest.accountId ||
      row.outputs?.accountId !== manifest.accountId
    )
      throw new Error("Retirement resource account/identity mismatch");
    const normalized = normalizeCheckpoint({
      qualifiedStack: `organization/${manifest.project}/${manifest.stack}`,
      backendUrl: "private",
      stateExport: { deployment: { resources: [row] } },
      accountId: manifest.accountId,
    }).resources;
    const matched =
      normalized.length === 1 &&
      manifest.resources.some(
        (entry) =>
          entry.kind === normalized[0].kind &&
          entry.name === normalized[0].name &&
          entry.cloudId === normalized[0].cloudId,
      );
    const policy =
      [
        "cloudflare:index/r2BucketLifecycle:R2BucketLifecycle",
        "cloudflare:index/r2ManagedDomain:R2ManagedDomain",
      ].includes(row.type) &&
      manifest.resources.some(
        (entry) =>
          entry.kind === "r2" &&
          entry.name === row.outputs?.bucketName &&
          entry.name === row.inputs?.bucketName,
      );
    if (!matched && !policy)
      throw new Error("Unreviewed resource in environment retirement");
    if (
      kind === "data" &&
      row.type === "pulumi-nodejs:dynamic/vectorize:Index" &&
      row.outputs.deleteData !== true
    )
      throw new Error("Vectorize data deletion was not authorized");
    result.push(row);
  }
  return result;
}

export function createEnvironmentDependencies({
  env = process.env,
  run: execute = async (binary, args, options) =>
    execFileWithInput(binary, args, options),
  cloud = listEnvironmentCloudResources,
  catalog = readStateCatalog,
  configuration = ({ descriptor }) =>
    readFile(join(descriptor.projectDir, `Pulumi.${descriptor.stack}.yaml`)),
  appliedConfiguration,
  emptyBucket = emptyBucketForDestroy,
  makeClient = createRuntimeCloudClient,
} = {}) {
  const run = (binary, args, options) =>
    runWithCommandDiagnostics({
      execute,
      executable: binary,
      args,
      options,
      directory: env.SAVIA_RUNTIME_OPERATION_DIRECTORY,
      operation: "environment-command",
      publicError: `Environment command failed: ${String(binary).split(/[\\/]/).at(-1)} ${args[0] ?? "command"}`,
    });
  const accountId = assertAccountId(env.CLOUDFLARE_ACCOUNT_ID);
  let dataPromise,
    executionEnv = { ...env };
  const invalidate = () => {
    dataPromise = undefined;
  };
  const data = () =>
    (dataPromise ??= (async () => {
      assertBackendConfigured(env);
      const rows = await cloud({ accountId, env });
      const backends = [
        ...new Set(
          rows
            .filter(
              (row) =>
                row.kind === "r2" &&
                ["savia-pulumi-state-preview", "savia-pulumi-state"].includes(
                  row.name,
                ),
            )
            .map((row) => stateBackendUrl(accountId, row.name)),
        ),
      ];
      if (!backends.includes(env.PULUMI_BACKEND_URL))
        throw new Error(
          "Configured backend is not an existing known account bucket",
        );
      const checkpoints = await catalog({
        accountId,
        backends,
        env,
        run,
        cwd: join(root, "infra/pulumi"),
      });
      return { rows, checkpoints };
    })());
  const inventory = async (environment) => {
    const { rows, checkpoints } = await data(),
      descriptor = resolveEnvironment(environment);
    const checkpoint = checkpoints.find(
        (row) =>
          row.project === descriptor.project && row.stack === descriptor.stack,
      ),
      outputs = stackOutputs(checkpoint);
    const profile = {
      ...(outputs.tenantSubdomains
        ? { tenantSubdomains: outputs.tenantSubdomains }
        : {}),
      ...(outputs.databaseNames
        ? { databaseNames: outputs.databaseNames }
        : {}),
      flowsEnabled: outputs.flowsEnabled ?? false,
      searchEnabled:
        rows.some(
          (row) =>
            row.kind === "vectorize" &&
            row.name === "savia-pages-search-preview",
        ) && environment === "preview",
    };
    return inventoryEnvironment({
      environment,
      accountId,
      profile,
      cloud: { listResources: async () => rows },
      stacks: { listCheckpoints: async () => checkpoints },
    });
  };
  const context = async (descriptor) => {
    const state = await data();
    const management = state.checkpoints.find(
      (row) => row.project === "savia-management" && row.stack === "management",
    );
    const proof = managementProof(
      management,
      accountId,
      env.PULUMI_BACKEND_URL,
    );
    const checkpoint = state.checkpoints.find(
      (row) =>
        row.project === descriptor.project && row.stack === descriptor.stack,
    );
    if (checkpoint && checkpoint.accountId !== accountId)
      throw new Error(
        "Selected checkpoint belongs to another Cloudflare account",
      );
    if (checkpoint && checkpoint.backendUrl !== env.PULUMI_BACKEND_URL)
      throw new Error(
        "Environment checkpoint is in another verified backend; select that backend explicitly",
      );
    return {
      checkpoints: state.checkpoints,
      checkpoint,
      backendUrl: env.PULUMI_BACKEND_URL,
      management: proof,
      qualifiedStack:
        checkpoint?.qualifiedStack ??
        `${management.qualifiedStack.split("/")[0]}/${descriptor.project}/${descriptor.stack}`,
    };
  };
  const options = (descriptor) => ({
    cwd: descriptor.projectDir,
    env: { ...executionEnv, PULUMI_ENABLE_STREAMING_JSON_PREVIEW: undefined },
    maxBuffer: 64 * 1024 * 1024,
  });
  let activeJournal;
  const recordCommand = async (entry) => {
    if (activeJournal)
      await appendFile(
        join(activeJournal, "commands.jsonl"),
        JSON.stringify(entry) + "\n",
        { mode: 0o600 },
      );
  };
  const command = async (descriptor, args) => {
    const entry = {
      operation: args.slice(
        0,
        args[0] === "config" || args[0] === "state" || args[0] === "stack"
          ? 2
          : 1,
      ),
      stack: descriptor.stack,
      ...(args[0] === "config" ? { key: args[2] } : {}),
      ...(args[0] === "state" ? { urn: args[2] } : {}),
    };
    await recordCommand({ ...entry, status: "started" });
    try {
      const result = await run("pulumi", args, options(descriptor));
      await recordCommand({ ...entry, status: "completed" });
      return result;
    } catch {
      await recordCommand({ ...entry, status: "failed" });
      throw new Error(`Environment command failed: pulumi ${args[0]}`);
    }
  };
  const setConfig = async (descriptor, key, value) =>
    command(descriptor, [
      "config",
      "set",
      `${descriptor.project}:${key}`,
      typeof value === "object" ? JSON.stringify(value) : String(value),
      "--stack",
      descriptor.stack,
      "--non-interactive",
    ]);
  const hydrateConfiguration = async (descriptor, ctx, operation) => {
    if (!ctx.checkpoint) return;
    const state = settledCheckpoint(ctx.checkpoint.stateExport);
    const status = stackOutputs(ctx.checkpoint).runtimeStatus;
    const managed =
      state.some(
        (row) => row.type === "pulumi-nodejs:dynamic/runtime:RuntimeRelease",
      ) ||
      (typeof status === "string" && status !== "unmanaged");
    if (managed && operation !== "provision") {
      let cached;
      if (appliedConfiguration)
        cached = await appliedConfiguration({ descriptor, context: ctx });
      else {
        const directory = await mkdtemp(
          join(tmpdir(), "savia-applied-configuration-"),
        );
        const path = join(directory, "configuration.private.yaml");
        try {
          await command(descriptor, [
            "config",
            "refresh",
            "--force",
            "--stack",
            ctx.qualifiedStack,
            "--config-file",
            path,
            "--non-interactive",
          ]);
          await chmod(path, 0o600);
          cached = JSON.parse(
            (
              await command(descriptor, [
                "config",
                "--json",
                "--stack",
                ctx.qualifiedStack,
                "--config-file",
                path,
              ])
            ).stdout,
          );
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      }
      if (
        !cached ||
        Array.isArray(cached) ||
        cached[`${descriptor.project}:runtimeManaged`]?.value !== "true"
      )
        throw new Error(
          "Applied managed configuration is required for this checkpoint",
        );
      const restored = [];
      for (const key of [
        "runtimeManaged",
        "runtimeMode",
        "runtimeProfile",
        "adoptionManifest",
        "runtimeRetired",
        "deleteRuntimeData",
        "environmentDeleted",
        "adoptSearchIndex",
        "artifactDirectory",
        "artifactDigest",
        "configDigest",
        ...(operation === "release" ? [] : ["runtimeBootstrapProof"]),
      ]) {
        const item = cached[`${descriptor.project}:${key}`];
        if (item === undefined) continue;
        if (item.secret || typeof item.value !== "string")
          throw new Error(
            "Runtime configuration must contain only public metadata",
          );
        restored.push([key, item.value]);
      }
      for (const [key, value] of restored)
        await setConfig(descriptor, key, value);
      for (const key of [
        "runtimeRetired",
        "deleteRuntimeData",
        "environmentDeleted",
      ])
        if (cached[`${descriptor.project}:${key}`] === undefined)
          await setConfig(descriptor, key, false);
      if (operation === "release")
        await command(descriptor, [
          "config",
          "rm",
          `${descriptor.project}:runtimeBootstrapProof`,
          "--stack",
          descriptor.stack,
          "--non-interactive",
        ]);
    }
    await setConfig(descriptor, "accountId", accountId);
    if (descriptor.kind === "branch") {
      const names = previewNames(descriptor.environment.slice(7));
      for (const [key, value] of Object.entries({
        branchSlug: names.slug,
        authDatabaseName: names.databases.auth,
        domainDatabaseName: names.databases.domain,
        bucketName: names.bucket,
        importAuthD1Id: "",
        importDomainD1Id: "",
        importBucketId: "",
      }))
        await setConfig(descriptor, key, value);
    }
    if (descriptor.kind === "application") {
      await setConfig(descriptor, "environment", descriptor.environment);
      await setConfig(descriptor, "managementProof", ctx.management);
    }
    await setConfig(descriptor, "importRuntimeWorkers", false);
    if (descriptor.kind === "shared")
      await setConfig(descriptor, "adoptExisting", false);
  };
  const currentExport = async (descriptor) =>
    JSON.parse(
      (
        await command(descriptor, [
          "stack",
          "export",
          "--stack",
          descriptor.stack,
        ])
      ).stdout,
    );
  const revision = async () =>
    (await run("git", ["rev-parse", "HEAD"], { cwd: root, env })).stdout.trim();
  const artifact = async (path, environment) => {
    const dir = resolve(path),
      raw = JSON.parse(
        await readFile(join(dir, "release-manifest.json"), "utf8"),
      );
    const inputs = { ...raw, artifactDirectory: dir, environment };
    await verifyRuntimeArtifact(inputs);
    return inputs;
  };
  const initializeAdoption = async ({ descriptor, manifest, context: ctx }) => {
    if (!ctx.checkpoint) {
      if (!["branch", "shared"].includes(descriptor.kind))
        throw new Error(
          "Application stack is absent; explicit reviewed bootstrap is required",
        );
      if (descriptor.kind === "branch") {
        const names = previewNames(descriptor.environment.slice(7));
        for (const [kind, name] of [
          ["d1", names.databases.auth],
          ["d1", names.databases.domain],
          ["r2", names.bucket],
        ])
          if (
            !manifest.resources.some(
              (row) => row.kind === kind && row.name === name,
            )
          )
            throw new Error(
              "Existing branch persistence must be fully inventoried before adoption",
            );
      }
      await command(descriptor, [
        "stack",
        "init",
        descriptor.stack,
        "--non-interactive",
      ]);
      await setConfig(descriptor, "accountId", accountId);
    }
    if (descriptor.kind === "branch") {
      const names = previewNames(descriptor.environment.slice(7)),
        owned = ctx.checkpoint?.resources ?? [];
      for (const [key, value] of Object.entries({
        branchSlug: names.slug,
        authDatabaseName: names.databases.auth,
        domainDatabaseName: names.databases.domain,
        bucketName: names.bucket,
      }))
        await setConfig(descriptor, key, value);
      for (const [key, kind, name] of [
        ["importAuthD1Id", "d1", names.databases.auth],
        ["importDomainD1Id", "d1", names.databases.domain],
        ["importBucketId", "r2", names.bucket],
      ]) {
        const row = manifest.resources.find(
          (row) => row.kind === kind && row.name === name,
        );
        if (
          row &&
          !owned.some(
            (item) => item.kind === kind && item.cloudId === row.cloudId,
          )
        )
          await setConfig(
            descriptor,
            key,
            kind === "r2"
              ? `${accountId}/${row.name}/default`
              : `${accountId}/${row.cloudId}`,
          );
      }
    }
    if (descriptor.kind === "shared")
      await setConfig(
        descriptor,
        "adoptExisting",
        !ctx.checkpoint?.resources.some(
          (row) => row.kind === "r2" && row.name === "savia-plugin-registry",
        ),
      );
  };
  const prepareConfig = async (
    operation,
    descriptor,
    manifest,
    ctx,
    release,
  ) => {
    if (operation === "provision") {
      if (
        descriptor.kind === "shared" ||
        manifest.resources.some((row) => row.kind === "worker")
      )
        throw new Error("Provisioning cannot replace an existing runtime");
      if (!ctx.checkpoint) {
        if (manifest.resources.length)
          throw new Error("Adopt unmanaged resources before provisioning");
        await command(descriptor, [
          "stack",
          "init",
          descriptor.stack,
          "--non-interactive",
        ]);
        await setConfig(descriptor, "accountId", accountId);
      }
      if (descriptor.kind === "branch") {
        const names = previewNames(descriptor.environment.slice(7));
        for (const [key, value] of Object.entries({
          branchSlug: names.slug,
          authDatabaseName: names.databases.auth,
          domainDatabaseName: names.databases.domain,
          bucketName: names.bucket,
          importAuthD1Id: "",
          importDomainD1Id: "",
          importBucketId: "",
        }))
          await setConfig(descriptor, key, value);
      }
      if (descriptor.kind === "application") {
        await setConfig(
          descriptor,
          "stateBucket",
          new URL(ctx.backendUrl).hostname,
        );
        await setConfig(descriptor, "managementProof", ctx.management);
      }
      await setConfig(descriptor, "environmentDeleted", false);
      await setConfig(descriptor, "runtimeManaged", false);
      return;
    }
    if (operation === "release")
      await setConfig(descriptor, "environmentDeleted", false);
    if (operation === "adopt")
      await initializeAdoption({ descriptor, manifest, context: ctx });
    if (descriptor.kind === "application")
      await setConfig(descriptor, "managementProof", ctx.management);
    if (operation === "infrastructure") return;
    const profile = { ...manifest.profile };
    if (release) {
      const names = [];
      for (const file of release.configs)
        names.push(
          JSON.parse(
            await readFile(join(release.artifactDirectory, file), "utf8"),
          ).name,
        );
      profile.enabledWorkers = names.sort();
      profile.retentionWorkerNames = (
        profile.retentionWorkerNames ?? []
      ).filter((name) => names.includes(name));
    }
    for (const [key, value] of Object.entries({
      runtimeManaged: true,
      runtimeMode: operation === "adopt" ? "adopt" : "release",
      runtimeProfile: profile,
      adoptionManifest: manifest,
      importRuntimeWorkers: operation === "adopt",
      runtimeRetired: false,
      deleteRuntimeData: false,
    }))
      await setConfig(descriptor, key, value);
    if (release && descriptor.kind === "application")
      await setConfig(
        descriptor,
        "adoptSearchIndex",
        manifest.resources.some((row) => row.kind === "vectorize"),
      );
    if (release)
      for (const key of ["artifactDirectory", "artifactDigest", "configDigest"])
        await setConfig(descriptor, key, release[key]);
  };
  const planOperation = async ({
    descriptor,
    manifest,
    manifestHash,
    operation,
    args,
    context: ctx,
  }) => {
    if (operation === "retire") {
      const intent = {
        version: 1,
        operation: "retire",
        accountId,
        environment: descriptor.environment,
        manifestHash,
        deleteData: args.deleteData ?? false,
        ...planRuntimeRetirement(manifest, {
          deleteData: args.deleteData ?? false,
        }),
      };
      if (args.plan) await writePrivateJson(resolve(args.plan), intent);
      return intent;
    }
    const release =
      operation === "release"
        ? await artifact(args.artifact, descriptor.environment)
        : undefined;
    if (release && descriptor.kind === "application")
      executionEnv = {
        ...env,
        ...renderEnvFromOutputs(
          stackOutputs(ctx.checkpoint),
          release.artifactDirectory,
        ),
      };
    await hydrateConfiguration(descriptor, ctx, operation);
    await prepareConfig(operation, descriptor, manifest, ctx, release);
    const directory = await mkdtemp(join(tmpdir(), "savia-environment-plan-")),
      planPath = resolve(args.plan ?? join(directory, "reviewed.json")),
      pulumiPlanPath = `${planPath}.pulumi.json`;
    await mkdir(dirname(planPath), { recursive: true, mode: 0o700 });
    const before = await currentExport(descriptor);
    const raw = JSON.parse(
      (
        await command(descriptor, [
          "preview",
          "--stack",
          descriptor.stack,
          "--refresh",
          "--non-interactive",
          "--save-plan",
          pulumiPlanPath,
          "--json",
        ])
      ).stdout,
    );
    await chmod(pulumiPlanPath, 0o600);
    const normalized = normalizeEnvironmentPlan(raw);
    if (operation === "adopt") assertAdoptionPlan(normalized, manifest);
    else if (operation === "provision") {
      if (manifest.resources.length)
        throw new Error("Provisioning requires an empty environment manifest");
      assertSafePlan(normalized);
      normalized.steps = normalized.steps.map((step, index) => {
        const source = raw.steps[index],
          state = source?.newState ?? source?.oldState ?? {};
        if (
          operation !== "provision" ||
          ![
            "cloudflare:index/r2Bucket:R2Bucket",
            "cloudflare:index/r2BucketLifecycle:R2BucketLifecycle",
            "cloudflare:index/r2ManagedDomain:R2ManagedDomain",
          ].includes(step.type)
        )
          return step;
        const inputs = state.inputs ?? {},
          outputs = state.outputs ?? {};
        return {
          ...step,
          ...(step.type === "cloudflare:index/r2Bucket:R2Bucket"
            ? {
                storageClass: inputs.storageClass ?? outputs.storageClass,
              }
            : {
                bucketName: inputs.bucketName ?? outputs.bucketName,
                ...(step.type ===
                "cloudflare:index/r2BucketLifecycle:R2BucketLifecycle"
                  ? { rules: inputs.rules ?? outputs.rules }
                  : { enabled: inputs.enabled ?? outputs.enabled }),
              }),
        };
      });
      assertProvisionPlan(normalized, descriptor.environment, {
        accountId,
        profile: manifest.profile,
      });
    } else assertSafePlan(normalized);
    const plan = {
      version: 1,
      accountId,
      environment: descriptor.environment,
      operation,
      manifest,
      manifestHash,
      revision: await revision(),
      checkpointFingerprint: hash(before),
      artifactDirectory: release?.artifactDirectory,
      artifactDigest: release?.artifactDigest,
      configDigest: release?.configDigest,
      pulumiPlanPath,
      pulumiPlanDigest: hash(await readFile(pulumiPlanPath)),
      ...normalized,
    };
    await writePrivateJson(planPath, plan);
    return { ...plan, planPath };
  };
  const applyPlan = async (
    plan,
    { descriptor, manifest, context: ctx, args },
  ) => {
    const release =
      plan.operation === "release"
        ? await artifact(args.artifact, descriptor.environment)
        : undefined;
    if (release && descriptor.kind === "application")
      executionEnv = {
        ...env,
        ...renderEnvFromOutputs(
          stackOutputs(ctx.checkpoint),
          release.artifactDirectory,
        ),
      };
    verifySavedEnvironmentPlan(plan, {
      accountId,
      environment: descriptor.environment,
      operation: plan.operation,
      checkpointFingerprint: hash(await currentExport(descriptor)),
      artifactDigest: release?.artifactDigest,
      configDigest: release?.configDigest,
      revision: await revision(),
      pulumiPlanDigest: hash(await readFile(plan.pulumiPlanPath)),
    });
    if (plan.manifestHash !== adoptionManifestHash(manifest))
      throw new Error("Saved plan manifest changed");
    if (plan.operation === "adopt") assertAdoptionPlan(plan, manifest);
    else if (plan.operation === "provision") {
      assertSafePlan(plan);
      assertProvisionPlan(plan, descriptor.environment, {
        accountId,
        profile: manifest.profile,
      });
    } else assertSafePlan(plan);
    validateManagementOutputs(ctx.management, {
      accountId,
      backendUrl: ctx.backendUrl,
    });
    await command(descriptor, [
      "up",
      "--stack",
      descriptor.stack,
      "--plan",
      plan.pulumiPlanPath,
      "--skip-preview",
      "--yes",
      "--non-interactive",
      "--json",
    ]);
    if (
      plan.operation === "provision" &&
      !manifest.resources.length &&
      plan.steps.every(
        (step) =>
          ["create", "same", "read", "refresh", "read-discard"].includes(
            step.op,
          ) ||
          (step.op === "update" && step.type === "pulumi:pulumi:Stack"),
      )
    ) {
      const resources = normalizeCheckpoint({
        qualifiedStack: ctx.qualifiedStack,
        backendUrl: ctx.backendUrl,
        stateExport: await currentExport(descriptor),
        accountId,
      })
        .resources.filter((row) =>
          ["d1", "r2", "kv", "queue", "vectorize"].includes(row.kind),
        )
        .map(({ kind, name, cloudId }) => ({ kind, name, cloudId }));
      await setConfig(descriptor, "runtimeBootstrapProof", {
        version: 1,
        accountId,
        environment: descriptor.environment,
        resources,
        planDigest: plan.pulumiPlanDigest,
      });
    }
    if (plan.operation === "release")
      await command(descriptor, [
        "config",
        "rm",
        `${descriptor.project}:runtimeBootstrapProof`,
        "--stack",
        descriptor.stack,
        "--non-interactive",
      ]);
    if (plan.operation === "adopt") {
      await setConfig(descriptor, "importRuntimeWorkers", false);
      if (descriptor.kind === "shared")
        await setConfig(descriptor, "adoptExisting", false);
      if (descriptor.kind === "branch")
        for (const key of [
          "importAuthD1Id",
          "importDomainD1Id",
          "importBucketId",
        ])
          await setConfig(descriptor, key, "");
    }
    invalidate();
    return {
      status: plan.operation === "adopt" ? "adopted" : "applied",
      environment: descriptor.environment,
    };
  };
  const retirementJournal = async (descriptor, manifest) => {
    const directory = await mkdtemp(
      join(tmpdir(), `savia-retire-${descriptor.environment}-`),
    );
    await writePrivateJson(
      join(directory, "before.private.json"),
      await currentExport(descriptor),
    );
    await writeFile(
      join(directory, "configuration.private.yaml"),
      await configuration({ descriptor }),
      { flag: "wx", mode: 0o600 },
    );
    await writePrivateJson(join(directory, "intent.json"), {
      accountId,
      environment: descriptor.environment,
      manifestHash: adoptionManifestHash(manifest),
    });
    activeJournal = directory;
    return directory;
  };
  const privateStage = async (directory, stage) =>
    writeFile(join(directory, "journal.json"), JSON.stringify({ stage }), {
      mode: 0o600,
    });
  const unprotect = async (descriptor, rows) => {
    for (const row of rows)
      if (row.protect === true)
        await command(descriptor, [
          "state",
          "unprotect",
          row.urn,
          "--stack",
          descriptor.stack,
          "--yes",
          "--non-interactive",
        ]);
  };
  const retirementUpdate = async (
    descriptor,
    directory,
    stage,
    guards,
    beforeApply,
  ) => {
    const file = join(directory, `${stage}.pulumi.json`),
      before = await currentExport(descriptor);
    const raw = JSON.parse(
      (
        await command(descriptor, [
          "preview",
          "--stack",
          descriptor.stack,
          "--refresh",
          "--save-plan",
          file,
          "--json",
          "--non-interactive",
        ])
      ).stdout,
    );
    await chmod(file, 0o600);
    const plan = normalizeEnvironmentPlan(raw);
    assertRetirementPlan(plan, guards);
    const planDigest = hash(await readFile(file));
    await writePrivateJson(join(directory, `${stage}.reviewed.json`), {
      checkpointFingerprint: hash(before),
      pulumiPlanDigest: planDigest,
      ...plan,
    });
    if (
      hash(await currentExport(descriptor)) !== hash(before) ||
      hash(await readFile(file)) !== planDigest
    )
      throw new Error(
        "Retirement checkpoint or saved plan changed before execution",
      );
    await beforeApply?.();
    await command(descriptor, [
      "up",
      "--stack",
      descriptor.stack,
      "--plan",
      file,
      "--skip-preview",
      "--yes",
      "--non-interactive",
      "--json",
    ]);
    await privateStage(directory, stage);
    return currentExport(descriptor);
  };
  const retire = async ({
    descriptor,
    manifest,
    manifestHash,
    deleteData,
    args,
    context: ctx,
  }) => {
    if (!ctx.checkpoint)
      throw new Error("Adopt the existing environment before retirement");
    const plan = planRuntimeRetirement(manifest, { deleteData });
    if (args.plan) {
      const reviewed = JSON.parse(await readFile(args.plan, "utf8"));
      if (
        reviewed.accountId !== accountId ||
        reviewed.environment !== descriptor.environment ||
        reviewed.manifestHash !== manifestHash ||
        reviewed.deleteData !== deleteData ||
        reviewed.operation !== "retire"
      )
        throw new Error("Saved retirement intent identity mismatch");
    }
    await hydrateConfiguration(descriptor, ctx, "retire");
    const directory = await retirementJournal(descriptor, manifest);
    let stage = "snapshots-written";
    try {
      await privateStage(directory, stage);
      let state = await currentExport(descriptor);
      let runtime = state.deployment.resources.find(
        (row) => row.type === "pulumi-nodejs:dynamic/runtime:RuntimeRelease",
      );
      if (!runtime && manifest.resources.some((row) => row.kind === "worker")) {
        // A previously retired environment has host identities but no release.
        // Re-adopt their actual maintenance versions without publishing code.
        const adopted = await planOperation({
          descriptor,
          manifest,
          manifestHash,
          operation: "adopt",
          args: {},
          context: ctx,
        });
        await applyPlan(adopted, {
          descriptor,
          manifest,
          context: ctx,
          args: {},
        });
        state = await currentExport(descriptor);
        runtime = state.deployment.resources.find(
          (row) => row.type === "pulumi-nodejs:dynamic/runtime:RuntimeRelease",
        );
        if (!runtime)
          throw new Error(
            "Runtime re-adoption did not establish managed retirement",
          );
      }
      if (deleteData) {
        await setConfig(descriptor, "deleteRuntimeData", true);
        const authorizations = state.deployment.resources
          .filter((row) =>
            [
              "pulumi-nodejs:dynamic/runtime:RuntimeRelease",
              "pulumi-nodejs:dynamic/vectorize:Index",
            ].includes(row.type),
          )
          .map((row) => row.urn);
        state = await retirementUpdate(
          descriptor,
          directory,
          "data-delete-authorized",
          { allowedDeletes: [], authorizeResources: authorizations },
        );
        stage = "data-delete-authorized";
        runtime = state.deployment.resources.find(
          (row) => row.type === "pulumi-nodejs:dynamic/runtime:RuntimeRelease",
        );
      }
      const workerRows = retirementRows(state, manifest, {
        kind: "workers",
        names: plan.deletedWorkers,
        deleteData,
      });
      await unprotect(descriptor, [
        ...workerRows,
        ...(runtime ? [runtime] : []),
      ]);
      await setConfig(descriptor, "runtimeProfile", {
        ...manifest.profile,
        retentionWorkerNames: plan.retainedWorkers,
      });
      await setConfig(descriptor, "runtimeRetired", true);
      state = await retirementUpdate(descriptor, directory, "runtime-retired", {
        allowedDeletes: [
          ...workerRows.map((row) => row.urn),
          ...(runtime ? [runtime.urn] : []),
        ],
      });
      stage = "runtime-retired";
      const remaining = state.deployment.resources
        .filter((row) => row.type === "cloudflare:index/worker:Worker")
        .map((row) => row.outputs.name)
        .sort();
      if (
        state.deployment.resources.some(
          (row) => row.type === "pulumi-nodejs:dynamic/runtime:RuntimeRelease",
        ) ||
        JSON.stringify(remaining) !==
          JSON.stringify([...plan.retainedWorkers].sort())
      )
        throw new Error(
          "Retired checkpoint does not match retained identities",
        );
      invalidate();
      return { journalDir: directory, status: "maintenance" };
    } catch {
      throw new Error(
        `Environment retirement stopped after ${stage}; preserve private recovery evidence in ${directory}`,
      );
    }
  };
  const destroyData = async ({ descriptor, manifest }) => {
    const directory = await retirementJournal(descriptor, manifest);
    let stage = "snapshots-written";
    try {
      const state = await currentExport(descriptor),
        rows = retirementRows(state, manifest, {
          kind: "data",
          deleteData: true,
        });
      const client = makeClient(
        { accountId, workers: [], environment: descriptor.environment },
        { env },
      );
      const own = new Set(
        manifest.resources
          .filter((row) => row.kind === "worker")
          .map((row) => row.name),
      );
      if (
        (await client.inspectReferences(manifest)).some(
          (row) => !own.has(row.caller),
        )
      )
        throw new Error("Foreign references appeared before data deletion");
      await privateStage(directory, stage);
      await unprotect(descriptor, rows);
      await setConfig(descriptor, "environmentDeleted", true);
      const providerUrns = state.deployment.resources
        .filter((row) => row.type?.startsWith("pulumi:providers:"))
        .map((row) => row.urn);
      const after = await retirementUpdate(
        descriptor,
        directory,
        "data-deleted",
        { allowedDeletes: [...rows.map((row) => row.urn), ...providerUrns] },
        async () => {
          for (const row of rows.filter(
            (row) => row.type === "cloudflare:index/r2Bucket:R2Bucket",
          )) {
            await recordCommand({
              operation: ["r2", "empty"],
              bucket: row.outputs.name,
              status: "started",
            });
            await emptyBucket({
              bucket: row.outputs.name,
              accountId,
              token: env.CLOUDFLARE_API_TOKEN,
            });
            await recordCommand({
              operation: ["r2", "empty"],
              bucket: row.outputs.name,
              status: "completed",
            });
          }
        },
      );
      stage = "data-deleted";
      if (
        settledCheckpoint(after).some(
          (row) =>
            row.type !== "pulumi:pulumi:Stack" &&
            !row.type?.startsWith("pulumi:providers:"),
        )
      )
        throw new Error("Environment checkpoint remains nonempty");
      invalidate();
      return { journalDir: directory, status: "deleted" };
    } catch {
      throw new Error(
        `Environment data deletion stopped after ${stage}; preserve private recovery evidence in ${directory}`,
      );
    }
  };
  return {
    env,
    inventory,
    context,
    planOperation,
    applyPlan,
    inventoryAll: async () => {
      const { rows, checkpoints } = await data(),
        ids = new Set(["preview", "production", "shared", "management"]);
      for (const row of rows) {
        const match = row.name?.match(
          /^(?:savia-(?:auth|agencies|request|hook-executor|connectors|mcp|documents)-preview-|savia-preview-)([a-z0-9-]+)$/,
        );
        if (match && slugifyBranch(match[1]) === match[1])
          ids.add(`branch-${match[1]}`);
      }
      for (const checkpoint of checkpoints)
        if (checkpoint.project === "savia-branch-preview")
          ids.add(checkpoint.stack);
      const results = [];
      for (const id of ids) {
        try {
          results.push(await inventory(id));
        } catch (error) {
          if (id !== "management") throw error;
          results.push({
            environment: id,
            status: "ownership-conflict",
            detail: error.message,
          });
        }
      }
      return results;
    },
    readManifest: async (path) => JSON.parse(await readFile(path, "utf8")),
    readSavedPlan: async (path) => JSON.parse(await readFile(path, "utf8")),
    alreadyAdopted: async ({ descriptor, context: ctx, manifest }) => {
      const adopted =
        !!ctx.checkpoint &&
        manifest.resources.every((row) =>
          ctx.checkpoint.resources.some(
            (actual) =>
              actual.kind === row.kind && actual.cloudId === row.cloudId,
          ),
        ) &&
        settledCheckpoint(ctx.checkpoint.stateExport).some(
          (row) => row.type === "pulumi-nodejs:dynamic/runtime:RuntimeRelease",
        );
      if (adopted)
        await hydrateConfiguration(descriptor, ctx, "infrastructure");
      return adopted;
    },
    inspectReferences: (manifest) =>
      makeClient(
        {
          accountId,
          workers: manifest.resources.filter((row) => row.kind === "worker"),
          environment: manifest.environment,
        },
        { env },
      ).inspectReferences(manifest),
    retire,
    destroyData,
  };
}
