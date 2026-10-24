import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { parsePolicy } from "./policy.mjs";

process.umask(0o077);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const mode = process.argv[2];
if (!["prepare", "deploy", "check"].includes(mode)) {
  throw new Error(
    "Usage: node scripts/cloudflare-cost-guard/deploy.mjs prepare|deploy|check [credentials-file]",
  );
}
const config = JSON.parse(await readFile(join(here, "wrangler.json"), "utf8"));
const policy = parsePolicy(await readFile(join(here, "policy.json"), "utf8"));
const recovery = join(root, "infra/secrets/cloudflare-cost-guard");
await mkdir(recovery, { recursive: true, mode: 0o700 });
const configPath = join(recovery, "wrangler.private.json");
const wrangler = join(root, "apps/api/node_modules/wrangler/bin/wrangler.js");
const account = config.account_id;
const base = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const generated = {
  ...config,
  main: join(here, "worker.mjs"),
  triggers: { crons: [] },
  vars: { ...config.vars, POLICY: policy },
};
await writeFile(configPath, JSON.stringify(generated, null, 2), {
  mode: 0o600,
});

function command(args, { input } = {}) {
  const run = spawnSync(
    process.execPath,
    [wrangler, ...args, "--config", configPath],
    {
      cwd: root,
      encoding: "utf8",
      input,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  // Deployment output contains resource identifiers, never credential values.
  if (run.status !== 0)
    throw new Error(
      `Wrangler ${args[0]} failed: ${(run.stderr || run.stdout).slice(-1800)}`,
    );
  process.stdout.write(run.stdout);
}

if (mode === "prepare") {
  command(["deploy", "--dry-run", "--outdir", join(recovery, "bundle")]);
  console.log(
    "Prepared a Worker with no active schedule; no runtime credentials were loaded.",
  );
  process.exit(0);
}
const credentialsPath = resolve(
  process.argv[3] ?? join(recovery, "credentials.private.json"),
);
const credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
if (
  typeof credentials.CF_CONTROL_TOKEN !== "string" ||
  credentials.CF_CONTROL_TOKEN.length < 20
)
  throw new Error(
    "A dedicated account API token is required; Wrangler OAuth is not a runtime credential.",
  );
credentials.GUARD_ADMIN_TOKEN ??= randomBytes(32).toString("hex");
await writeFile(credentialsPath, JSON.stringify(credentials), { mode: 0o600 });
await chmod(credentialsPath, 0o600);
const url = `https://${config.name}.jose-douglas-dev.workers.dev`;
async function privateCheck() {
  const response = await fetch(url + "/check", {
    method: "POST",
    headers: { Authorization: `Bearer ${credentials.GUARD_ADMIN_TOKEN}` },
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Guard check returned ${response.status}`);
  const status = await response.json();
  await writeFile(
    join(recovery, "last-status.private.json"),
    JSON.stringify(status, null, 2),
  );
  console.log(JSON.stringify(status, null, 2));
  if (status.actionErrors?.length)
    throw new Error(
      "Some pause actions did not complete; inspect the private status before claiming activation.",
    );
  return status;
}
if (mode === "check") {
  await privateCheck();
  process.exit(0);
}
async function api(path, method = "GET", data) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${credentials.CF_CONTROL_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok || !result.success)
    throw new Error(`Cloudflare ${method} ${path} failed (${response.status})`);
  return result.result;
}
const priorSchedule = await api(
  `/workers/scripts/${config.name}/schedules`,
).catch(() => null);
await writeFile(
  join(recovery, `schedule-before-${Date.now()}.private.json`),
  JSON.stringify(priorSchedule),
);
// The first deploy is intentionally unscheduled; upload durable secrets before arming it.
command(["deploy"]);
command(["secret", "bulk"], {
  input: JSON.stringify({
    CF_CONTROL_TOKEN: credentials.CF_CONTROL_TOKEN,
    GUARD_ADMIN_TOKEN: credentials.GUARD_ADMIN_TOKEN,
  }),
});
await privateCheck();
await api(
  `/workers/scripts/${config.name}/schedules`,
  "PUT",
  config.triggers.crons.map((cron) => ({ cron })),
);
const actual = await api(`/workers/scripts/${config.name}/schedules`);
if (actual.schedules?.[0]?.cron !== config.triggers.crons[0])
  throw new Error("Scheduled trigger verification failed");
console.log(
  "Cost guard deployed, checked, and scheduled every five minutes. No automatic resume is configured.",
);
