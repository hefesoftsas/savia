import { appendFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { productionBackupLifecycleRule } from "./naming.mjs";
import { buildSecretUploads } from "../../scripts/upload-cloudflare-secrets.mjs";
import { assertBackendConfigured } from "./deploy-stack.mjs";
import { execFileWithInput } from "./runtime-publisher-branch.mjs";

const persistence = [
  [
    "auth-db",
    "d1Database:D1Database",
    "savia-auth-local-canonical-20260913-v2",
  ],
  [
    "domain-db",
    "d1Database:D1Database",
    "savia-agencies-local-canonical-20260913-v2",
  ],
  ["documents", "r2Bucket:R2Bucket", "savia-documents"],
  ["production-backups", "r2Bucket:R2Bucket", "savia-production-backups"],
  ["production-backups-lifecycle", "r2BucketLifecycle:R2BucketLifecycle"],
  ["production-backups-public-access", "r2ManagedDomain:R2ManagedDomain"],
];

export function assertProductionBootstrapPlan(plan, accountId) {
  if (
    !/^[a-f\d]{32}$/.test(accountId ?? "") ||
    plan?.accountId !== accountId ||
    plan.environment !== "production" ||
    plan.operation !== "provision" ||
    !Array.isArray(plan.manifest?.resources) ||
    plan.manifest.resources.length ||
    !Array.isArray(plan.steps)
  )
    throw new Error(
      "Bootstrap requires an empty production manifest and provision plan",
    );
  const remaining = new Set(persistence.map(([logical]) => logical));
  for (const step of plan.steps) {
    if (
      step.type === "pulumi:pulumi:Stack" ||
      step.type === "pulumi:providers:cloudflare"
    ) {
      const prefix = `urn:pulumi:production::savia-cloudflare::${step.type}::`;
      if (
        !step.urn?.startsWith(prefix) ||
        ![
          "create",
          "same",
          "read",
          "refresh",
          "read-discard",
          "update",
        ].includes(step.op)
      )
        throw new Error("Unexpected bootstrap stack or provider mutation");
      continue;
    }
    const match = persistence.find(
      ([logical, type, name]) =>
        step.urn ===
          `urn:pulumi:production::savia-cloudflare::cloudflare:index/${type}::${logical}` &&
        step.type === `cloudflare:index/${type}` &&
        step.accountId === accountId &&
        (name === undefined || step.name === name),
    );
    if (!match || step.op !== "create" || !remaining.delete(match[0]))
      throw new Error(
        "Bootstrap may only create the six declared production persistence resources",
      );
    if (
      (match[0] === "production-backups" && step.storageClass !== "Standard") ||
      (match[0] === "production-backups-lifecycle" &&
        (step.bucketName !== "savia-production-backups" ||
          !isDeepStrictEqual(step.rules, [productionBackupLifecycleRule()]))) ||
      (match[0] === "production-backups-public-access" &&
        (step.bucketName !== "savia-production-backups" ||
          step.enabled !== false))
    )
      throw new Error(
        "Production backups require private access, Standard storage and exact 30-day retention",
      );
  }
  if (remaining.size)
    throw new Error("Production persistence plan is incomplete");
  return true;
}

export function validateBootstrapSecrets(env) {
  if (!env.BETTER_AUTH_BOOTSTRAP_PASSWORD?.trim())
    throw new Error("Production requires BETTER_AUTH_BOOTSTRAP_PASSWORD");
  buildSecretUploads("production", {
    ...env,
    SAVIA_FLOWS_PROVISIONED: "false",
  });
  if (!/^[a-f\d]{64}$/i.test(env.SAVIA_BACKUP_KEY ?? ""))
    throw new Error("Production requires a 256-bit backup encryption key");
  for (const key of ["R2_BACKUP_ACCESS_KEY_ID", "R2_BACKUP_SECRET_ACCESS_KEY"])
    if (!env[key]?.trim()) throw new Error(`Production requires ${key}`);
}

export async function bootstrapProduction({
  planPath,
  env = process.env,
  run = execFileWithInput,
}) {
  if (
    env.PRODUCTION_OPERATIONS_ENABLED !== "true" ||
    env.GITHUB_REF !== "refs/heads/main"
  )
    throw new Error(
      "Production bootstrap requires enabled operations on reviewed main",
    );
  assertBackendConfigured(env);
  validateBootstrapSecrets(env);
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const path = resolve(planPath);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const options = { cwd: root, env, maxBuffer: 32 * 1024 * 1024 };
  const common = [
    "infra/pulumi/environment.mjs",
    "--environment",
    "production",
    "--provision",
    "--plan",
    path,
  ];
  const result = await run(
    process.execPath,
    [common[0], "plan", ...common.slice(1)],
    options,
  );
  const plan = JSON.parse(result.stdout);
  assertProductionBootstrapPlan(plan, env.CLOUDFLARE_ACCOUNT_ID);
  if (env.GITHUB_STEP_SUMMARY)
    await appendFile(
      env.GITHUB_STEP_SUMMARY,
      "### Initial production persistence\n\nReviewed create-only plan: two D1 databases, documents and backup buckets, backup retention, and disabled public backup access. Preview, shared registry, and management resources are excluded.\n",
    );
  await run(
    process.execPath,
    [common[0], "apply", ...common.slice(1), "--apply"],
    options,
  );
  return { status: "provisioned", environment: "production", planPath: path };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  Promise.resolve()
    .then(() => {
      if (process.argv.length !== 4 || process.argv[2] !== "--plan")
        throw new Error("Use --plan <private saved-plan path>");
      return bootstrapProduction({ planPath: process.argv[3] });
    })
    .then((result) => console.log(JSON.stringify(result)))
    .catch(() => {
      console.error(
        "Production initialization failed; runtime publication was not started. Check production-app credentials and the protected persistence plan.",
      );
      process.exitCode = 1;
    });
}
