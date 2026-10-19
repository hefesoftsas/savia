import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("daily production recovery captures and retains encrypted data without deploying code or applying IaC", async () => {
  const source = await readFile(
    new URL("../../.github/workflows/backup-production.yml", import.meta.url),
    "utf8",
  );
  const runner = await readFile(
    new URL("../../scripts/production-backup.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /schedule:\n\s+- cron:/);
  assert.match(source, /workflow_dispatch:/);
  assert.match(
    source,
    /if: \$\{\{ vars\.PRODUCTION_OPERATIONS_ENABLED == 'true' && github\.ref == 'refs\/heads\/main' \}\}/,
  );
  assert.match(source, /group: savia-production/);
  assert.match(source, /cancel-in-progress: false/);
  assert.match(source, /environment: production-backup/);
  assert.match(source, /uses: \.\/\.github\/actions\/pulumi-infrastructure/);
  assert.match(source, /node infra\/pulumi\/production-preflight\.mjs/);
  assert.match(source, /node scripts\/production-backup\.mjs/);
  assert.match(source, /--artifact "\$RUNNER_TEMP\/production-backup\.enc"/);
  assert.match(
    source,
    /SAVIA_BACKUP_KEY: \$\{\{ secrets\.SAVIA_BACKUP_KEY \}\}/,
  );
  assert.match(source, /node scripts\/production-backup-r2\.mjs --artifact/);
  assert.match(source, /--kind daily/);
  assert.match(source, /R2_BACKUP_ACCESS_KEY_ID:/);
  assert.match(source, /R2_BACKUP_SECRET_ACCESS_KEY:/);
  assert.doesNotMatch(source, /actions\/upload-artifact|retention-days:/);
  assert.match(source, /if: always\(\)/);
  assert.doesNotMatch(
    source,
    /wrangler[^\n]*deploy|deploy-stack\.mjs|pulumi up|--show-secrets/,
  );
  assert.match(source, /flows-maintenance\.mjs --action backup/);
  assert.match(runner, /GITHUB_STEP_SUMMARY/);
});

test("an independent scheduled checker fails when no fresh encrypted backup is retained", async () => {
  const source = await readFile(
    new URL(
      "../../.github/workflows/check-production-backups.yml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /cron: "0 \*\/6 \* \* \*"/);
  assert.match(
    source,
    /if: \$\{\{ vars\.PRODUCTION_OPERATIONS_ENABLED == 'true' && github\.ref == 'refs\/heads\/main' \}\}/,
  );
  assert.doesNotMatch(source, /actions: read|GITHUB_TOKEN:/);
  assert.match(source, /environment: production-backup/);
  assert.match(source, /R2_BACKUP_ACCESS_KEY_ID:/);
  assert.match(source, /R2_BACKUP_SECRET_ACCESS_KEY:/);
  assert.match(source, /node scripts\/check-production-backup-freshness\.mjs/);
});

test("managed releases create the coordinator namespace before dependent storage writers", async () => {
  const { standardReleaseCommands } =
    await import("./runtime-publisher-standard.mjs");
  for (const environment of ["preview", "production"]) {
    const plan = standardReleaseCommands({
      environment,
      provisionedFlows: true,
      desiredFlows: true,
      flowsPolicyGeneration: 100,
      configs: Object.fromEntries(
        [
          "backupCoordinator",
          "api",
          "flows",
          "auth",
          "gateway",
          "request",
          "connectors",
        ].map((role) => [role, `/f/${role}.json`]),
      ),
      recoveryDirectory: "/private/recovery",
    });
    const workers = plan.quiesce
      .filter((step) => step.kind === "wrangler")
      .map((step) => step.worker);
    assert.deepEqual(workers, ["backupCoordinator", "api", "flows"]);
    assert.ok(plan.backup.length > 0);
    assert.equal(plan.deploy.at(-1).worker, "gateway");
  }
});
test("production managed releases retain private R2 recovery before migration, without GitHub backup artifacts", async () => {
  const source = await readFile(
    new URL("../../.github/workflows/deploy-cloudflare.yml", import.meta.url),
    "utf8",
  );
  assert.equal(
    (source.match(/uses: actions\/upload-artifact/g) ?? []).length,
    1,
  );
  assert.match(
    source,
    /name: production-bootstrap-custody\n\s+path: \$\{\{ runner.temp \}\}\/production-bootstrap-custody\.enc/,
  );
  assert.match(
    source,
    /encrypt-flows-backup\.mjs --action encrypt --input.*production-bootstrap-custody\.tar\.gz.*--output.*production-bootstrap-custody\.enc/,
  );
  assert.match(source, /R2_BACKUP_ACCESS_KEY_ID:/);
  assert.match(source, /R2_BACKUP_SECRET_ACCESS_KEY:/);
  const { standardReleaseCommands } =
    await import("./runtime-publisher-standard.mjs");
  const plan = standardReleaseCommands({
    environment: "production",
    configs: {
      api: "/f/api.json",
      auth: "/f/auth.json",
      gateway: "/f/gateway.json",
    },
    recoveryDirectory: "/private/recovery",
  });
  assert.deepEqual(
    plan.backup
      .filter((step) => step.kind === "node")
      .map((step) => step.script),
    ["scripts/production-backup.mjs", "scripts/production-backup-r2.mjs"],
  );
  assert.ok(plan.backup[1].args.includes("release"));
  assert.equal(plan.backup.at(-1).kind, "remove-plaintext");
});
