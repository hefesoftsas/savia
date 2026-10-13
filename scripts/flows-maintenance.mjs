// Offline-first client for the paused Flows Durable Object maintenance API.
// Every mutating or status request requires --apply and receives a fresh
// short-lived JWT. This CLI never enables Flows execution.
import { createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PUBLIC_ORIGIN,
  PREVIEW_PUBLIC_ORIGIN,
  normalizeEnvironment,
} from "../infra/pulumi/naming.mjs";
import { validateFlowsSnapshotManifest } from "../infra/pulumi/flows-snapshot.mjs";

const MAX_PAGES = 10_000;
const DEFAULT_DRAIN_TIMEOUT_SECONDS = 1200;
const STATUS_POLL_INTERVAL_MS = 5000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["backup", "restore", "status"]);

export function parseMaintenanceArgs(argv) {
  const values = new Map();
  let apply = false;
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--apply") {
      if (apply) throw new Error("Duplicate flag: --apply");
      apply = true;
      continue;
    }
    if (
      ![
        "--action",
        "--snapshot-file",
        "--snapshot-id",
        "--drain-timeout-seconds",
      ].includes(flag)
    ) {
      throw new Error(`Unknown argument: ${flag}`);
    }
    if (values.has(flag)) throw new Error(`Duplicate flag: ${flag}`);
    const value = argv[index + 1];
    if (typeof value !== "string" || value === "" || value.startsWith("--")) {
      throw new Error(`Missing required value for ${flag}`);
    }
    values.set(flag, value);
    index++;
  }
  const action = values.get("--action");
  if (!ACTIONS.has(action)) {
    throw new Error("--action must be backup, restore, or status");
  }
  const snapshotFile = values.get("--snapshot-file") ?? null;
  const snapshotId = values.get("--snapshot-id")?.toLowerCase() ?? null;
  const drainTimeoutRaw = values.get("--drain-timeout-seconds");
  const drainTimeoutSeconds = drainTimeoutRaw
    ? Number(drainTimeoutRaw)
    : DEFAULT_DRAIN_TIMEOUT_SECONDS;
  if (
    drainTimeoutRaw &&
    (!/^[1-9]\d*$/.test(drainTimeoutRaw) ||
      !Number.isSafeInteger(drainTimeoutSeconds) ||
      drainTimeoutSeconds > DEFAULT_DRAIN_TIMEOUT_SECONDS)
  ) {
    throw new Error("--drain-timeout-seconds must be between 1 and 1200");
  }
  if (action !== "status" && !snapshotFile) {
    throw new Error(`--snapshot-file is required for ${action}`);
  }
  if (action === "status" && (snapshotFile || snapshotId || drainTimeoutRaw)) {
    throw new Error(
      "Snapshot and drain timeout options are only valid for backup or restore",
    );
  }
  if (snapshotId && !UUID_RE.test(snapshotId)) {
    throw new Error("--snapshot-id must be a UUID");
  }
  return { action, snapshotFile, snapshotId, drainTimeoutSeconds, apply };
}

export function validateMaintenanceEnvironment(env) {
  let environment;
  let configuredOrigin;
  try {
    environment = normalizeEnvironment(env?.SAVIA_DEPLOY_ENVIRONMENT);
    configuredOrigin = new URL(env?.SAVIA_PUBLIC_ORIGIN);
  } catch {
    throw new Error(
      "SAVIA_DEPLOY_ENVIRONMENT and SAVIA_PUBLIC_ORIGIN are invalid",
    );
  }
  const expectedOrigin =
    environment === "preview" ? PREVIEW_PUBLIC_ORIGIN : DEFAULT_PUBLIC_ORIGIN;
  if (
    configuredOrigin.protocol !== "https:" ||
    configuredOrigin.origin !== expectedOrigin ||
    configuredOrigin.pathname !== "/" ||
    configuredOrigin.search !== "" ||
    configuredOrigin.hash !== "" ||
    configuredOrigin.username !== "" ||
    configuredOrigin.password !== ""
  ) {
    throw new Error(
      "SAVIA_PUBLIC_ORIGIN must be the exact HTTPS origin for the selected environment",
    );
  }
  const bridgeSecret = env?.SAVIA_FLOWS_BRIDGE_SECRET;
  if (
    typeof bridgeSecret !== "string" ||
    Buffer.byteLength(bridgeSecret, "utf8") < 32
  ) {
    throw new Error("SAVIA_FLOWS_BRIDGE_SECRET must contain at least 32 bytes");
  }
  return { environment, origin: expectedOrigin, bridgeSecret };
}

export function buildMaintenanceJwt(secret, now = Date.now()) {
  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("SAVIA_FLOWS_BRIDGE_SECRET must contain at least 32 bytes");
  }
  const issuedAt = Math.floor(now / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: "savia",
      aud: "savia-flows-maintenance",
      iat: issuedAt,
      exp: issuedAt + 60,
    }),
  ).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signature = createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

export function createMaintenanceClient({
  origin,
  bridgeSecret,
  fetchImpl = fetch,
  now = () => Date.now(),
}) {
  const endpoint = `${origin}/api/public/savia-flows/maintenance`;
  return async function request(body) {
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-savia-flows-maintenance": buildMaintenanceJwt(bridgeSecret, now()),
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error(
        `Flows maintenance request failed for action ${body.action}`,
      );
    }
    if (!response?.ok) {
      throw new Error(
        `Flows maintenance API returned HTTP ${response?.status ?? "unknown"}`,
      );
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error("Flows maintenance API returned invalid JSON");
    }
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      payload.success === false
    ) {
      throw new Error(`Flows maintenance API rejected action ${body.action}`);
    }
    return payload;
  };
}

function pausedStatus(payload) {
  if (payload.executionEnabled !== false || payload.maintenance !== true) {
    throw new Error("Flows must be paused with maintenance mode enabled");
  }
  if (!Number.isSafeInteger(payload.activeRuns) || payload.activeRuns < 0) {
    throw new Error(
      "Flows maintenance status returned an invalid active run count",
    );
  }
  return payload;
}

async function waitForMaintenance({
  request,
  timeoutSeconds,
  now,
  sleepImpl,
  log,
}) {
  const startedAt = now();
  const timeoutMs = timeoutSeconds * 1000;
  let previousActiveRuns;
  while (true) {
    const status = pausedStatus(await request({ action: "status" }));
    if (status.activeRuns === 0) return status;
    if (status.activeRuns !== previousActiveRuns) {
      log(`Waiting for ${status.activeRuns} active Flows run(s) to drain`);
      previousActiveRuns = status.activeRuns;
    }
    const remainingMs = timeoutMs - (now() - startedAt);
    if (remainingMs <= 0) {
      throw new Error(
        `Flows remains paused with ${status.activeRuns} active run(s) after ${timeoutSeconds} seconds; no backup or restore was started. Operators may resume service deliberately and rerun after quiescing.`,
      );
    }
    await sleepImpl(Math.min(STATUS_POLL_INTERVAL_MS, remainingMs));
  }
}

function manifestFromResponse(payload) {
  return payload.completeManifest ?? payload.manifest ?? payload;
}

function validateStartedManifest(payload, expectedId = null) {
  const manifest = manifestFromResponse(payload);
  if (
    !manifest ||
    manifest.version !== 2 ||
    manifest.coverage?.version !== 2 ||
    JSON.stringify(manifest.coverage.kinds) !==
      JSON.stringify([
        "database",
        "mailbox",
        "workflow-agent",
        "agent-runner",
        "email-agent-runner",
      ]) ||
    typeof manifest.id !== "string" ||
    !UUID_RE.test(manifest.id) ||
    typeof manifest.createdAt !== "string" ||
    !Number.isFinite(Date.parse(manifest.createdAt)) ||
    manifest.executionEnabled !== false ||
    manifest.complete !== false ||
    !Array.isArray(manifest.objects)
  ) {
    throw new Error(
      "Flows maintenance start returned an invalid snapshot manifest",
    );
  }
  if (expectedId && manifest.id.toLowerCase() !== expectedId) {
    throw new Error("Flows maintenance start returned a different snapshot id");
  }
  const identities = new Set();
  for (const object of manifest.objects) {
    if (
      !object ||
      ![
        "database",
        "mailbox",
        "workflow-agent",
        "agent-runner",
        "email-agent-runner",
      ].includes(object.kind) ||
      typeof object.name !== "string" ||
      object.name.trim() === "" ||
      !Array.isArray(object.pages) ||
      object.pages.length !== 0
    ) {
      throw new Error(
        "Flows maintenance start returned an invalid target inventory",
      );
    }
    const identity = `${object.kind}\0${object.name}`;
    if (identities.has(identity))
      throw new Error("Flows maintenance start repeated a target");
    identities.add(identity);
  }
  return manifest;
}

function validateSnapshotIdFromFile(path, contents, requestedId) {
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error(`Snapshot file is not valid JSON: ${path}`);
  }
  const local = validateFlowsSnapshotManifest(parsed);
  if (requestedId && local.id.toLowerCase() !== requestedId) {
    throw new Error("--snapshot-id does not match the snapshot file");
  }
  return local;
}

async function writeSnapshotFile(fsImpl, path, manifest) {
  await fsImpl.mkdir(dirname(path), { recursive: true });
  await fsImpl.writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

async function runBackup({ plan, request, fsImpl, log, now, sleepImpl }) {
  await waitForMaintenance({
    request,
    timeoutSeconds: plan.drainTimeoutSeconds,
    now,
    sleepImpl,
    log,
  });
  const snapshotId = plan.snapshotId ?? randomUUID();
  const started = validateStartedManifest(
    await request({ action: "start", snapshotId }),
    snapshotId,
  );
  let exportedPages = 0;
  for (let target = 0; target < started.objects.length; target++) {
    let page = 0;
    while (true) {
      if (exportedPages >= MAX_PAGES) {
        throw new Error(`Flows maintenance export exceeded ${MAX_PAGES} pages`);
      }
      const result = await request({
        action: "export",
        snapshotId: started.id,
        target,
        page,
      });
      if (result.page !== page || typeof result.done !== "boolean") {
        throw new Error(
          "Flows maintenance export returned an invalid page result",
        );
      }
      exportedPages++;
      if (result.done) break;
      page++;
    }
  }
  const finished = manifestFromResponse(
    await request({ action: "finish", snapshotId: started.id }),
  );
  const manifest = validateFlowsSnapshotManifest(finished);
  if (manifest.id.toLowerCase() !== started.id.toLowerCase()) {
    throw new Error(
      "Flows maintenance finish returned a different snapshot id",
    );
  }
  if (
    manifest.objects.length !== started.objects.length ||
    manifest.objects.some(
      (object, index) =>
        object.kind !== started.objects[index].kind ||
        object.name !== started.objects[index].name,
    )
  ) {
    throw new Error(
      "Flows maintenance finish changed the snapshot target inventory",
    );
  }
  const completedPages = manifest.objects.reduce(
    (sum, object) => sum + object.pages.length,
    0,
  );
  if (completedPages !== exportedPages) {
    throw new Error(
      "Flows maintenance finish returned an unexpected page count",
    );
  }
  await writeSnapshotFile(fsImpl, plan.snapshotFile, manifest);
  log(
    `Flows snapshot ${manifest.id} complete: ${manifest.objects.length} target(s), ${exportedPages} page(s)`,
  );
  return { manifest, exportedPages };
}

async function runRestore({ plan, request, fsImpl, log, now, sleepImpl }) {
  const local = validateSnapshotIdFromFile(
    plan.snapshotFile,
    await fsImpl.readFile(plan.snapshotFile, "utf8"),
    plan.snapshotId,
  );
  await waitForMaintenance({
    request,
    timeoutSeconds: plan.drainTimeoutSeconds,
    now,
    sleepImpl,
    log,
  });
  const inspected = manifestFromResponse(
    await request({ action: "inspect", snapshotId: local.id }),
  );
  const trusted = validateFlowsSnapshotManifest(inspected);
  if (trusted.id.toLowerCase() !== local.id.toLowerCase()) {
    throw new Error(
      "Flows maintenance inspect returned a different snapshot id",
    );
  }
  let restoredPages = 0;
  for (let target = 0; target < trusted.objects.length; target++) {
    const pages = trusted.objects[target].pages;
    for (let page = 0; page < pages.length; page++) {
      if (restoredPages >= MAX_PAGES) {
        throw new Error(
          `Flows maintenance restore exceeded ${MAX_PAGES} pages`,
        );
      }
      const result = await request({
        action: "restore",
        snapshotId: trusted.id,
        target,
        page,
      });
      if (result.restored !== true) {
        throw new Error(
          `Flows maintenance restore failed for target ${target}, page ${page}`,
        );
      }
      restoredPages++;
    }
  }
  const finalStatus = pausedStatus(await request({ action: "status" }));
  if (finalStatus.activeRuns !== 0) {
    throw new Error("Flows restore finished but active runs were reported");
  }
  log(
    `Flows snapshot ${trusted.id} restored: ${restoredPages} page(s); execution remains paused`,
  );
  return { manifest: trusted, restoredPages };
}

export async function runMaintenance({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = fetch,
  fsImpl = { mkdir, readFile, writeFile },
  now = () => Date.now(),
  sleepImpl = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  log = console.log,
} = {}) {
  const plan = parseMaintenanceArgs(argv);
  if (!plan.apply) {
    log(
      `Dry run: would perform Flows maintenance action ${plan.action}${plan.snapshotFile ? ` using ${plan.snapshotFile}` : ""}. No request was sent.`,
    );
    return { dryRun: true };
  }
  const { origin, bridgeSecret } = validateMaintenanceEnvironment(env);
  const request = createMaintenanceClient({
    origin,
    bridgeSecret,
    fetchImpl,
    now,
  });
  if (plan.action === "status") {
    const status = pausedStatus(await request({ action: "status" }));
    log(
      `Flows is paused with maintenance mode enabled; active runs=${status.activeRuns}`,
    );
    return { status };
  }
  if (plan.action === "backup") {
    return runBackup({ plan, request, fsImpl, log, now, sleepImpl });
  }
  return runRestore({ plan, request, fsImpl, log, now, sleepImpl });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMaintenance().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
