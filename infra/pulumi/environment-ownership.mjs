import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  chmod,
  appendFile,
} from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEnvironmentDependencies,
  inventoryManifest,
  writePrivateJson,
} from "./environment-operations.mjs";
import { listEnvironmentCloudResources } from "./environment-cloud.mjs";
import { readStateCatalog } from "./environment-state.mjs";
import { createRuntimeCloudClient } from "./runtime-cloud.mjs";
import {
  planBackendOwnershipMove,
  moveBackendOwnership,
} from "./move-backend-ownership.mjs";
import { normalizeEnvironmentPlan } from "./environment-plan.mjs";
import { settledCheckpoint } from "./management-resources.mjs";
import { resolveEnvironment } from "./environments.mjs";
import { stateBackendUrl } from "./naming.mjs";
import {
  parseEnvironmentArgs,
  runEnvironmentOperation,
} from "./environment.mjs";
import { execFileWithInput } from "./runtime-publisher-branch.mjs";
const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
export const ownershipWorkflows = [
  "backup-production.yml",
  "check-production-backups.yml",
  "deploy-cloudflare.yml",
  "deploy-plugin-registry.yml",
  "deploy-preview.yml",
  "import-savia-request-variables.yml",
  "preview-environment.yml",
  "preview-quickjs.yml",
  "pulumi.yml",
];
function canonical(value) {
  if (Array.isArray(value))
    return value
      .map(canonical)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export const ownershipFingerprint = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
export function validateWorkflowJournal(rows, actual) {
  if (
    !Array.isArray(rows) ||
    rows.length !== ownershipWorkflows.length ||
    new Set(rows.map((row) => row.path)).size !== rows.length
  )
    throw new Error("Exact original workflow states are required");
  for (const name of ownershipWorkflows) {
    const path = `.github/workflows/${name}`,
      row = rows.find((entry) => entry.path === path),
      live = actual.find((entry) => entry.path === path);
    if (
      !row ||
      !live ||
      row.id !== live.id ||
      !["active", "disabled_manually"].includes(row.originalState) ||
      Object.keys(row).some(
        (key) => !["id", "path", "originalState"].includes(key),
      )
    )
      throw new Error("Workflow identity or original state mismatch");
  }
  for (const name of [
    "backup-production.yml",
    "check-production-backups.yml",
    "deploy-cloudflare.yml",
    "import-savia-request-variables.yml",
  ])
    if (
      rows.find((row) => row.path.endsWith(`/${name}`)).originalState !==
      "disabled_manually"
    )
      throw new Error(
        "Previously disabled production workflows must stay disabled",
      );
  return rows;
}
export function assertBookkeepingPlan(plan) {
  for (const step of plan.steps) {
    if (["same", "read", "refresh", "read-discard"].includes(step.op)) continue;
    if (
      step.type === "pulumi:pulumi:Stack" &&
      ["create", "update"].includes(step.op)
    )
      continue;
    if (
      step.type?.startsWith("pulumi:providers:") &&
      ["create", "update"].includes(step.op)
    )
      continue;
    throw new Error(
      "Ownership verification proposed a cloud resource mutation",
    );
  }
}
export async function auditEnvironmentOwnership({
  env = process.env,
  run = execFileWithInput,
  directory,
  cloud = listEnvironmentCloudResources,
  catalog = readStateCatalog,
  makeClient = createRuntimeCloudClient,
} = {}) {
  let rows, checkpoints;
  const deps = createEnvironmentDependencies({
    env,
    run,
    cloud: async (args) => (rows = await cloud(args)),
    catalog: async (args) => (checkpoints = await catalog(args)),
  });
  const inventory = await deps.inventoryAll();
  for (const checkpoint of checkpoints)
    settledCheckpoint(checkpoint.stateExport);
  const client = makeClient(
    { accountId: env.CLOUDFLARE_ACCOUNT_ID, workers: [] },
    { env },
  );
  const metadata = [];
  for (const row of rows.filter((entry) => entry.kind === "worker")) {
    const settings = await client.api(`/workers/scripts/${row.name}/settings`);
    const subdomain = await client.api(
      `/workers/scripts/${row.name}/subdomain`,
    );
    metadata.push({
      name: row.name,
      fingerprint: ownershipFingerprint({ settings, subdomain }),
    });
  }
  const accounted = new Set(
    inventory.flatMap((item) =>
      (item.resources ?? []).map((row) => `${row.kind}/${row.cloudId}`),
    ),
  );
  const unclassifiedSaviaResources = rows
    .filter(
      (row) =>
        row.name?.startsWith("savia") &&
        !accounted.has(`${row.kind}/${row.cloudId}`) &&
        !(row.kind === "r2" && row.name === "savia-pulumi-state-preview"),
    )
    .map(({ kind, name, cloudId }) => ({ kind, name, cloudId }));
  const result = {
    version: 2,
    unclassifiedSaviaResources,
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    backendUrl: env.PULUMI_BACKEND_URL,
    cloudFingerprint: ownershipFingerprint({ rows, metadata }),
    checkpoints: checkpoints.map((cp) => ({
      qualifiedStack: cp.qualifiedStack,
      backendUrl: cp.backendUrl,
      fingerprint: ownershipFingerprint(cp.stateExport),
    })),
    inventory,
  };
  if (directory) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    await writePrivateJson(join(directory, "audit.json"), result);
    for (const [index, checkpoint] of checkpoints.entries())
      await writePrivateJson(
        join(directory, `checkpoint-${index}.private.json`),
        checkpoint.stateExport,
      );
  }
  return { result, checkpoints };
}
export async function migrateEnvironmentOwnership({
  reviewed,
  originalWorkflows,
  directory,
  env = process.env,
  run = execFileWithInput,
  audit = auditEnvironmentOwnership,
} = {}) {
  if (
    env.GITHUB_REF !== "refs/heads/main" ||
    env.PRODUCTION_OPERATIONS_ENABLED === "true" ||
    env.GITHUB_REPOSITORY !== "hefesoftsas/savia"
  )
    throw new Error(
      "Ownership migration requires reviewed main with production disabled",
    );
  if (!directory || !reviewed)
    throw new Error("Reviewed audit and private operation directory required");
  if (
    reviewed.version !== 2 ||
    !Array.isArray(reviewed.unclassifiedSaviaResources)
  )
    throw new Error(
      "Reviewed version-2 ownership audit is required before any workflow mutation",
    );
  if (reviewed.unclassifiedSaviaResources.length)
    throw new Error(
      "Unclassified Savia resources require reconciliation before ownership migration",
    );
  const backend = stateBackendUrl(
    env.CLOUDFLARE_ACCOUNT_ID,
    "savia-pulumi-state-preview",
  );
  if (env.PULUMI_BACKEND_URL !== backend)
    throw new Error("Existing Preview backend is required");
  await mkdir(directory, { mode: 0o700 });
  const gh = async (args) =>
    JSON.parse(
      (await run("gh", ["api", ...args], { cwd: root, env })).stdout || "null",
    );
  const allWorkflows = async () =>
    (
      await gh([
        `repos/${env.GITHUB_REPOSITORY}/actions/workflows?per_page=100`,
      ])
    ).workflows;
  const originals = validateWorkflowJournal(
    originalWorkflows,
    await allWorkflows(),
  );
  await writePrivateJson(join(directory, "original-workflows.json"), originals);
  const main = await gh([`repos/${env.GITHUB_REPOSITORY}/commits/main`]);
  if (main.sha !== env.GITHUB_SHA)
    throw new Error("Migration source has been superseded on main");
  const freeze = async () => {
    const workflows = await allWorkflows();
    for (const original of originals) {
      const row = workflows.find((entry) => entry.id === original.id);
      if (row?.state !== "disabled_manually") return false;
    }
    for (const original of originals) {
      const runs = (
        await gh([
          `repos/${env.GITHUB_REPOSITORY}/actions/workflows/${original.id}/runs?per_page=100`,
        ])
      ).workflow_runs;
      if (
        runs.some(
          (row) =>
            row.status !== "completed" &&
            !(
              String(row.id) === env.GITHUB_RUN_ID &&
              original.path.endsWith("/pulumi.yml") &&
              row.head_sha === env.GITHUB_SHA &&
              row.event === "workflow_dispatch"
            ),
        )
      )
        return false;
    }
    return true;
  };
  for (const original of originals)
    await gh([
      `repos/${env.GITHUB_REPOSITORY}/actions/workflows/${original.id}/disable`,
      "--method",
      "PUT",
    ]);
  if (!(await freeze()))
    throw new Error(
      "Mutating workflows remain active or have in-flight runs; preserve the freeze and reconcile before retrying",
    );
  const frozen = {
    version: 1,
    frozen: true,
    workflows: originals.map((row) => ({
      ...row,
      currentState: "disabled_manually",
    })),
    inFlight: [],
  };
  const freezePath = join(directory, "freeze.json");
  await writePrivateJson(freezePath, frozen);
  const { result: before, checkpoints } = await audit({
    env,
    run,
    directory: join(directory, "before"),
  });
  if (ownershipFingerprint(before) !== ownershipFingerprint(reviewed))
    throw new Error(
      "Live custody changed since the reviewed audit; keep workflows frozen and review a fresh audit",
    );
  const source = checkpoints.find(
    (cp) => cp.project === "savia-cloudflare" && cp.stack === "preview",
  );
  if (!source) throw new Error("Existing Preview checkpoint required");
  const destination = `${source.qualifiedStack.split("/")[0]}/savia-management/management`,
    management = resolveEnvironment("management");
  const command = (descriptor, args) =>
    run("pulumi", args, {
      cwd: descriptor.projectDir,
      env,
      maxBuffer: 64 * 1024 * 1024,
    });
  const config = (descriptor, key, value) =>
    command(descriptor, [
      "config",
      "set",
      key,
      typeof value === "object" ? JSON.stringify(value) : String(value),
      "--stack",
      descriptor.stack,
      "--non-interactive",
    ]);
  let destinationCheckpoint = checkpoints.find(
    (cp) => cp.qualifiedStack === destination,
  );
  const alreadyMoved = destinationCheckpoint?.resources.some(
    (row) => row.kind === "r2" && row.name === "savia-pulumi-state-preview",
  );
  if (!destinationCheckpoint) {
    await command(management, [
      "stack",
      "init",
      destination,
      "--secrets-provider=passphrase",
      "--non-interactive",
    ]);
    destinationCheckpoint = {
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      backendUrl: backend,
      qualifiedStack: destination,
      stateExport: JSON.parse(
        (await command(management, ["stack", "export", "--stack", destination]))
          .stdout,
      ),
    };
  }
  await config(management, "accountId", env.CLOUDFLARE_ACCOUNT_ID);
  await config(management, "backendBuckets", ["savia-pulumi-state-preview"]);
  if (!alreadyMoved) {
    const plan = planBackendOwnershipMove({
      source: source.qualifiedStack,
      destination,
      backendUrn:
        "urn:pulumi:preview::savia-cloudflare::cloudflare:index/r2Bucket:R2Bucket::state-backend",
      checkpoints: [
        { ...source, stack: source.qualifiedStack },
        { ...destinationCheckpoint, stack: destination },
      ],
    });
    await moveBackendOwnership(plan, {
      apply: true,
      run: (binary, args, options) =>
        run(binary, args, { ...options, cwd: join(root, "infra/pulumi") }),
      journalDir: join(directory, "backend-move"),
      env,
      freezeJournal: freezePath,
      verifyFrozen: freeze,
      configurationFiles: {
        [source.qualifiedStack]: join(root, "infra/pulumi/Pulumi.preview.yaml"),
        [destination]: join(management.projectDir, "Pulumi.management.yaml"),
      },
    });
  }
  const saved = join(directory, "management.pulumi.json");
  const preview = normalizeEnvironmentPlan(
    JSON.parse(
      (
        await command(management, [
          "preview",
          "--stack",
          destination,
          "--refresh",
          "--json",
          "--save-plan",
          saved,
          "--non-interactive",
        ])
      ).stdout,
    ),
  );
  assertBookkeepingPlan(preview);
  await command(management, [
    "up",
    "--stack",
    destination,
    "--plan",
    saved,
    "--skip-preview",
    "--yes",
    "--non-interactive",
  ]);
  for (const item of before.inventory.filter(
    (row) =>
      row.environment !== "management" &&
      row.environment !== "production" &&
      row.status === "present",
  )) {
    if (!(await freeze()))
      throw new Error("Workflow freeze changed before adoption");
    const deps = createEnvironmentDependencies({ env, run }),
      manifest = inventoryManifest(await deps.inventory(item.environment)),
      path = join(directory, `${item.environment}.manifest.json`);
    await writePrivateJson(path, manifest);
    await runEnvironmentOperation(
      parseEnvironmentArgs([
        "adopt",
        "--environment",
        item.environment,
        "--manifest",
        path,
        "--apply",
      ]),
      deps,
    );
  }
  for (let pass = 1; pass <= 2; pass++) {
    const deps = createEnvironmentDependencies({ env, run });
    for (const item of before.inventory.filter(
      (row) =>
        row.environment !== "production" &&
        ["present", "ownership-conflict"].includes(row.status),
    )) {
      const descriptor = resolveEnvironment(item.environment);
      const snapshot = normalizeEnvironmentPlan(
        JSON.parse(
          (
            await command(descriptor, [
              "preview",
              "--stack",
              descriptor.stack,
              "--refresh",
              "--json",
              "--non-interactive",
            ])
          ).stdout,
        ),
      );
      assertBookkeepingPlan(snapshot);
      const path = join(directory, `${item.environment}.refresh-${pass}.json`);
      await writePrivateJson(path, snapshot);
    }
    const after = await audit({
      env,
      run,
      directory: join(directory, `after-${pass}`),
    });
    if (after.result.cloudFingerprint !== before.cloudFingerprint)
      throw new Error(
        "Cloud metadata changed during adoption; preserve the freeze and recovery evidence",
      );
    if (
      after.result.inventory.find((item) => item.environment === "production")
        ?.status !== "defined-not-deployed"
    )
      throw new Error("Production must remain absent");
    for (const item of after.result.inventory.filter(
      (item) => item.environment !== "production" && item.status === "present",
    )) {
      const context = await deps.context(resolveEnvironment(item.environment));
      if (
        item.resources.some(
          (row) =>
            !context.checkpoint.resources.some(
              (owned) =>
                owned.kind === row.kind && owned.cloudId === row.cloudId,
            ),
        )
      )
        throw new Error(
          "Retained resources remain outside their environment ownership",
        );
    }
  }
  if (!(await freeze()))
    throw new Error("Freeze changed before verification completed");
  await run("node", [join(root, "scripts/verify-preview-health.mjs")], {
    cwd: root,
    env,
  });
  await writePrivateJson(join(directory, "migration-complete.json"), {
    version: 1,
    sourceRevision: env.GITHUB_SHA,
    status: "ownership-verified",
    cloudFingerprint: before.cloudFingerprint,
  });
  // Restoration is explicit and happens only after source and checkpoints agree.
  for (const row of originals)
    if (row.originalState === "active")
      await gh([
        `repos/${env.GITHUB_REPOSITORY}/actions/workflows/${row.id}/enable`,
        "--method",
        "PUT",
      ]);
  return { status: "ownership-verified", sourceRevision: env.GITHUB_SHA };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2),
    value = (flag) => {
      const index = argv.indexOf(flag);
      if (index < 0 || !argv[index + 1] || argv[index + 1].startsWith("--"))
        throw new Error(`Missing ${flag}`);
      return argv[index + 1];
    };
  Promise.resolve()
    .then(async () => {
      if (
        argv.length !== (argv[0] === "audit" ? 3 : 5) ||
        argv
          .filter((arg) => arg.startsWith("--"))
          .some((arg) => !["--out", "--reviewed"].includes(arg))
      )
        throw new Error(
          "Use audit --out <directory> or migrate --out <directory> --reviewed <audit.json>",
        );
      const directory = resolve(value("--out"));
      const run = async (binary, args, options) => {
        await mkdir(dirname(directory), { recursive: true, mode: 0o700 });
        const log = join(dirname(directory), "commands.private.jsonl"),
          entry = { binary, operation: args.slice(0, 2) };
        await appendFile(
          log,
          JSON.stringify({ ...entry, status: "started" }) + "\n",
          { mode: 0o600 },
        );
        try {
          const result = await execFileWithInput(binary, args, options);
          await appendFile(
            log,
            JSON.stringify({
              ...entry,
              status: "completed",
              stdout: result.stdout,
              stderr: result.stderr,
            }) + "\n",
            { mode: 0o600 },
          );
          return result;
        } catch (error) {
          await appendFile(
            log,
            JSON.stringify({
              ...entry,
              status: "failed",
              stdout: error.stdout,
              stderr: error.stderr,
            }) + "\n",
            { mode: 0o600 },
          );
          throw new Error(
            `Ownership command failed: ${binary} ${args[0]}; preserve encrypted private evidence`,
          );
        }
      };
      if (argv[0] === "audit")
        return (await auditEnvironmentOwnership({ directory, run })).result;
      if (argv[0] !== "migrate") throw new Error("Choose audit or migrate");
      return migrateEnvironmentOwnership({
        directory,
        run,
        reviewed: JSON.parse(await readFile(value("--reviewed"), "utf8")),
        originalWorkflows: JSON.parse(
          process.env.SAVIA_ORIGINAL_WORKFLOWS ?? "null",
        ),
      });
    })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
