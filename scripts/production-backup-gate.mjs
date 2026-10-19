import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createBackup, parseBackupArgs } from "../infra/pulumi/backup.mjs";

export async function runGatedProductionBackup(
  argv,
  {
    captureBackup = createBackup,
    withGate = withProductionBackupGate,
    env = process.env,
  } = {},
) {
  const plan = parseBackupArgs(argv);
  if (plan.stack !== "production")
    throw new Error("Release backup requires the production stack");
  if (!argv.includes("--apply") || plan.dryRun)
    throw new Error("Release backup requires --apply");
  return withGate(() => captureBackup(plan, { env }), { env });
}

/** Hold a bounded, renewable write barrier only while copying persistence. */
export async function withProductionBackupGate(
  capture,
  {
    env = process.env,
    fetchImpl = fetch,
    now = Date.now,
    sleep = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval,
    ttlMs = 180000,
    renewEveryMs = 30000,
    drainTimeoutMs = 60000,
    maxHoldMs = 15 * 60_000,
  } = {},
) {
  const url = new URL(
    env.SAVIA_BACKUP_CONTROL_URL ??
      "https://savia-backup-coordinator.jose-douglas-dev.workers.dev/api/_internal/backup-gate",
  );
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname.replace(/\/$/, "") !== "/api/_internal/backup-gate"
  )
    throw new Error(
      "Backup controller requires an HTTPS URL without credentials or parameters",
    );
  const secret = env.SAVIA_BACKUP_CONTROL_SECRET;
  if (typeof secret !== "string" || secret.length < 32)
    throw new Error("SAVIA_BACKUP_CONTROL_SECRET is required");
  const owner = randomUUID();
  const hardDeadline = now() + maxHoldMs;
  let expiresAt = 0;
  let lost;
  let timer;
  let renewal = Promise.resolve();
  let started = false;
  let captureError;
  const call = async (action) => {
    const response = await fetchImpl(
      `${url.href.replace(/\/$/, "")}/${action}`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ owner, ttlMs }),
      },
    );
    if (!response.ok)
      throw new Error(`Backup barrier ${action} failed (${response.status})`);
    return response.json();
  };
  const validate = (value) => {
    if (
      value.owner !== owner ||
      !Number.isSafeInteger(value.expiresAt) ||
      value.expiresAt <= now() ||
      !Number.isSafeInteger(value.active) ||
      value.active < 0 ||
      value.drained !== (value.active === 0)
    )
      throw new Error(
        "Backup lease ownership, expiry or drain proof is invalid",
      );
    expiresAt = value.expiresAt;
    return value;
  };
  const checkKnownLease = () => {
    if (lost) throw lost;
    if (now() >= hardDeadline)
      throw new Error("Backup exceeded its maximum maintenance window");
    if (expiresAt <= now())
      throw new Error("Backup lease expired during capture");
  };
  try {
    started = true;
    let status = validate(await call("acquire"));
    timer = setIntervalImpl(() => {
      renewal = renewal
        .then(async () => {
          checkKnownLease();
          validate(await call("renew"));
        })
        .catch((error) => {
          lost = error;
        });
      return renewal;
    }, renewEveryMs);
    const deadline = now() + drainTimeoutMs;
    while (!status.drained) {
      if (now() >= deadline) throw new Error("Backup barrier drain timed out");
      await sleep(1000);
      checkKnownLease();
      status = validate(await call("status"));
    }
    const result = await capture();
    await renewal;
    checkKnownLease();
    status = validate(await call("status"));
    if (!status.drained) throw new Error("Backup lease lost its drained state");
    return result;
  } catch (error) {
    captureError = error;
    throw error;
  } finally {
    if (timer !== undefined) clearIntervalImpl(timer);
    await renewal;
    if (started) {
      try {
        await call("release");
      } catch (error) {
        if (!captureError) throw error;
      }
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runGatedProductionBackup(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
