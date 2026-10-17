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
  assert.match(source, /retention-days: 30/);
  assert.match(source, /if-no-files-found: error/);
  assert.match(
    source,
    /path: \$\{\{ runner\.temp \}\}\/production-backup\.enc/,
  );
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
  assert.match(source, /actions: read/);
  assert.match(source, /node scripts\/check-production-backup-freshness\.mjs/);
  assert.doesNotMatch(source, /environment: production-backup/);
});

test("release workflows create the dedicated shared namespace before deploying storage writers", async () => {
  for (const name of ["deploy-cloudflare", "deploy-preview"]) {
    const source = await readFile(
      new URL(`../../.github/workflows/${name}.yml`, import.meta.url),
      "utf8",
    );
    const owner = source.indexOf("- name: Deploy savia backup coordinator");
    assert.ok(owner >= 0, `${name}: dedicated namespace owner is missing`);
    for (const dependent of [
      "Deploy savia-agencies",
      "Deploy savia-auth",
      "Deploy private Savia request",
      "Deploy private Savia connectors",
    ])
      assert.ok(
        owner < source.indexOf(`- name: ${dependent}`),
        `${name}: ${dependent} needs the dedicated namespace first`,
      );
  }
});
