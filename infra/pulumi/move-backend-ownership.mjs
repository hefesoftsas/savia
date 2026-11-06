import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { assertAccountId, stateBackendUrl } from "./naming.mjs";
import {
  settledCheckpoint,
  validateManagementOutputs,
} from "./management-resources.mjs";
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
const hash = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
const cloudResources = (state) =>
  settledCheckpoint(state).filter(
    (row) =>
      row.type !== "pulumi:pulumi:Stack" &&
      !row.type?.startsWith("pulumi:providers:"),
  );
const fingerprints = (resources) => resources.map((row) => hash(row)).sort();
export function planBackendOwnershipMove({
  source,
  destination,
  backendUrn,
  checkpoints,
}) {
  if (
    !/^[\w.-]+\/savia-cloudflare\/preview$/.test(source) ||
    !destination ||
    destination !== `${source.split("/")[0]}/savia-management/management` ||
    backendUrn !==
      "urn:pulumi:preview::savia-cloudflare::cloudflare:index/r2Bucket:R2Bucket::state-backend"
  )
    throw new Error(
      "Backend move must select exact qualified Preview and management identities",
    );
  if (
    !Array.isArray(checkpoints) ||
    new Set(checkpoints.map((row) => row.stack)).size !== checkpoints.length
  )
    throw new Error("Unique readable checkpoints are required");
  const from = checkpoints.find((row) => row.stack === source),
    to = checkpoints.find((row) => row.stack === destination);
  if (!from || !to)
    throw new Error("Both source and destination checkpoints are required");
  assertAccountId(from.accountId);
  const accountId = from.accountId,
    backendUrl = stateBackendUrl(accountId, "savia-pulumi-state-preview");
  for (const checkpoint of checkpoints) {
    if (
      checkpoint.accountId !== accountId ||
      checkpoint.backendUrl !== backendUrl
    )
      throw new Error("Checkpoint account/backend mismatch");
    settledCheckpoint(checkpoint.stateExport);
  }
  const resources = cloudResources(from.stateExport),
    bucket = resources.find((row) => row.urn === backendUrn);
  if (
    !bucket ||
    bucket.type !== "cloudflare:index/r2Bucket:R2Bucket" ||
    bucket.protect !== true ||
    bucket.inputs?.accountId !== accountId ||
    bucket.outputs?.accountId !== accountId ||
    bucket.inputs?.name !== "savia-pulumi-state-preview" ||
    bucket.outputs?.name !== "savia-pulumi-state-preview" ||
    ![
      "savia-pulumi-state-preview",
      `${accountId}/savia-pulumi-state-preview/default`,
    ].includes(bucket.id)
  )
    throw new Error("Source backend physical identity/protection mismatch");
  const owners = checkpoints.flatMap((checkpoint) =>
    cloudResources(checkpoint.stateExport).filter(
      (row) =>
        row.type === bucket.type && row.outputs?.name === bucket.outputs.name,
    ),
  );
  if (owners.length !== 1 || cloudResources(to.stateExport).length)
    throw new Error("Duplicate ownership or nonempty management destination");
  return {
    version: 1,
    source,
    destination,
    backendUrn,
    accountId,
    backendUrl,
    sourceFingerprint: hash(from.stateExport),
    destinationFingerprint: hash(to.stateExport),
    sourceRemaining: fingerprints(
      resources.filter((row) => row.urn !== backendUrn),
    ),
    destinationExisting: fingerprints(cloudResources(to.stateExport)),
    bucketFingerprint: hash({
      id: bucket.id,
      inputs: bucket.inputs,
      outputs: bucket.outputs,
      protect: bucket.protect,
    }),
  };
}
export async function moveBackendOwnership(
  plan,
  {
    apply = false,
    run,
    journalDir,
    env = process.env,
    freezeJournal,
    verifyFrozen,
    configurationFiles,
  } = {},
) {
  if (!apply) return { applied: false, plan };
  if (!freezeJournal || typeof verifyFrozen !== "function")
    throw new Error("Verified workflow freeze is required");
  const freeze = JSON.parse(await readFile(freezeJournal, "utf8"));
  if (
    freeze.version !== 1 ||
    freeze.frozen !== true ||
    !Array.isArray(freeze.workflows) ||
    !freeze.workflows.length ||
    freeze.workflows.some((row) => row.currentState !== "disabled_manually") ||
    !Array.isArray(freeze.inFlight) ||
    freeze.inFlight.length ||
    (await verifyFrozen(freeze)) !== true
  )
    throw new Error("Workflow freeze is unverified or has in-flight runs");
  if (env.PULUMI_BACKEND_URL !== plan.backendUrl)
    throw new Error("Move execution backend mismatch");
  if (
    !journalDir ||
    !configurationFiles?.[plan.source] ||
    !configurationFiles?.[plan.destination]
  )
    throw new Error("Private journal and configuration copies are required");
  await mkdir(journalDir, { mode: 0o700 });
  await chmod(journalDir, 0o700);
  let stage = "started";
  const journal = async (next) => {
    await writeFile(
      join(journalDir, "journal.json"),
      JSON.stringify({ version: 1, stage: next, plan }, null, 2),
      { mode: 0o600 },
    );
    stage = next;
  };
  const exported = async (stack) =>
    JSON.parse(
      (await run("pulumi", ["stack", "export", "--stack", stack], { env }))
        .stdout,
    );
  try {
    await journal(stage);
    const before = [];
    for (const [label, stack] of [
      ["source", plan.source],
      ["destination", plan.destination],
    ]) {
      const state = await exported(stack);
      settledCheckpoint(state);
      before.push(state);
      await writeFile(
        join(journalDir, `${label}.before.json`),
        JSON.stringify(state),
        { mode: 0o600, flag: "wx" },
      );
      await writeFile(
        join(journalDir, `${label}.config.yaml`),
        await readFile(configurationFiles[stack]),
        { mode: 0o600, flag: "wx" },
      );
    }
    if (
      hash(before[0]) !== plan.sourceFingerprint ||
      hash(before[1]) !== plan.destinationFingerprint
    )
      throw new Error("Checkpoints changed after move planning");
    const freshPlan = planBackendOwnershipMove({
      source: plan.source,
      destination: plan.destination,
      backendUrn: plan.backendUrn,
      checkpoints: before.map((stateExport, index) => ({
        stack: index ? plan.destination : plan.source,
        accountId: plan.accountId,
        backendUrl: plan.backendUrl,
        stateExport,
      })),
    });
    if (hash(freshPlan) !== hash(plan))
      throw new Error(
        "Saved move plan does not match current validated custody",
      );
    await journal("snapshots-written");
    if ((await verifyFrozen(freeze)) !== true)
      throw new Error("Workflow freeze changed before mutation");
    await run(
      "pulumi",
      [
        "state",
        "move",
        plan.backendUrn,
        "--source",
        plan.source,
        "--dest",
        plan.destination,
        "--yes",
        "--non-interactive",
      ],
      { env },
    );
    await journal("state-moved");
    const after = [];
    for (const [label, stack] of [
      ["source", plan.source],
      ["destination", plan.destination],
    ]) {
      const state = await exported(stack);
      settledCheckpoint(state);
      after.push(state);
      await writeFile(
        join(journalDir, `${label}.after.json`),
        JSON.stringify(state),
        { mode: 0o600, flag: "wx" },
      );
    }
    const moved = cloudResources(after[1]).find(
      (row) => row.outputs?.name === "savia-pulumi-state-preview",
    );
    validateManagementOutputs(
      {
        accountId: plan.accountId,
        backendBuckets: ["savia-pulumi-state-preview"],
        protected: true,
        checkpoint: after[1],
      },
      { accountId: plan.accountId, backendUrl: plan.backendUrl },
    );
    if (
      JSON.stringify(fingerprints(cloudResources(after[0]))) !==
        JSON.stringify(plan.sourceRemaining) ||
      JSON.stringify(
        fingerprints(cloudResources(after[1]).filter((row) => row !== moved)),
      ) !== JSON.stringify(plan.destinationExisting) ||
      hash({
        id: moved.id,
        inputs: moved.inputs,
        outputs: moved.outputs,
        protect: moved.protect,
      }) !== plan.bucketFingerprint
    )
      throw new Error("Unexpected resources changed during ownership transfer");
    await journal("verified");
    return { applied: true, journalDir, stage };
  } catch {
    throw new Error(
      `Backend ownership transfer stopped after ${stage}; preserve private recovery evidence in ${journalDir} and inspect both checkpoints before any further mutation`,
    );
  }
}
