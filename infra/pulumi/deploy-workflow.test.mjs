import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

for (const [file, stack] of [
  ["deploy-preview.yml", "preview"],
  ["deploy-cloudflare.yml", "production"],
]) {
  test(`${stack} deployment loads the imported IaC stack before publishing Workers`, async () => {
    const source = await readFile(
      new URL(`../../.github/workflows/${file}`, import.meta.url),
      "utf8",
    );
    assert.match(source, /uses: \.\/\.github\/actions\/pulumi-infrastructure/);
    assert.match(source, new RegExp(`stack: ${stack}`));
    assert.match(
      source,
      /PULUMI_BACKEND_URL: \$\{\{ secrets\.PULUMI_BACKEND_URL \}\}/,
    );
    assert.match(
      source,
      /AWS_SECRET_ACCESS_KEY: \$\{\{ secrets\.R2_STATE_SECRET_ACCESS_KEY \}\}/,
    );
    assert.doesNotMatch(
      source,
      /vars\.SAVIA_(?:AUTH_D1_ID|DOMAIN_D1_ID|DOCUMENTS_BUCKET|PUBLIC_ORIGIN)/,
    );
    const load = source.indexOf("- name: Load infrastructure stack outputs");
    const apply = source.indexOf(
      "- name: Apply infrastructure before Worker deployment",
    );
    const worker = source.indexOf("- name: Deploy savia-auth");
    assert.ok(load >= 0 && apply > load && worker > apply);
    if (stack === "preview") {
      const verify = source.indexOf(
        "- name: Verify isolated preview resources before any mutation",
      );
      assert.ok(verify > load && verify < apply);
    }
    if (stack === "production") {
      const preflight = source.indexOf(
        "- name: Run the production readiness preflight before any mutation",
      );
      const backup = source.indexOf(
        "- name: Capture production backup before apply",
      );
      const encrypted = source.indexOf(
        "- name: Retain and verify encrypted production recovery archive in private R2",
      );
      const applyIndex = source.indexOf(
        "- name: Apply infrastructure before Worker deployment",
      );
      const executor = source.indexOf(
        "- name: Deploy private QuickJS hook executor",
      );
      const flows = source.indexOf("- name: Deploy private Savia Flows");
      const api = source.indexOf("- name: Deploy savia-agencies");
      const gatewayVerification = source.indexOf(
        "- name: Verify deployed gateway",
      );
      const recovery = source.indexOf(
        "- name: Restore production Worker deployments after a failed rollout",
      );
      assert.ok(
        preflight > load &&
          backup > preflight &&
          encrypted > backup &&
          applyIndex > encrypted,
      );
      assert.ok(executor > applyIndex && flows > executor && api > flows);
      assert.ok(recovery > gatewayVerification);
      assert.match(source, /node infra\/pulumi\/production-preflight\.mjs/);
      assert.match(
        source,
        /node scripts\/flows-preview-recovery\.mjs --action capture --environment production/,
      );
      assert.match(source, /node scripts\/production-backup\.mjs --artifact/);
      assert.equal(
        (
          source.match(
            /SAVIA_BACKUP_CONTROL_SECRET: \$\{\{ secrets\.SAVIA_BACKUP_CONTROL_SECRET \}\}/g,
          ) ?? []
        ).length >= 3,
        true,
        "production API upload and both release backup modes need the control secret",
      );
      assert.doesNotMatch(
        source,
        /node infra\/pulumi\/backup\.mjs --stack production --apply/,
      );
      assert.match(source, /node scripts\/verify-flows-preview\.mjs/);
      assert.match(
        source,
        /node scripts\/production-backup-r2\.mjs --artifact[^\n]*--kind release/,
      );
      assert.match(
        source,
        /- name: Remove plaintext production backup material[\s\S]*?if: always\(\)/,
      );
    }
    assert.match(
      source,
      /CLOUDFLARE_DATABASE_ID: \$\{\{ env\.SAVIA_DOMAIN_D1_ID \}\}/,
    );
  });
}

test("temporary previews and the shared registry use the central infrastructure toolchain", async () => {
  for (const file of [
    "preview-environment.yml",
    "preview-quickjs.yml",
    "deploy-plugin-registry.yml",
  ]) {
    const source = await readFile(
      new URL(`../../.github/workflows/${file}`, import.meta.url),
      "utf8",
    );
    assert.match(source, /uses: \.\/\.github\/actions\/install-pulumi/);
    assert.match(
      source,
      /PULUMI_BACKEND_URL: \$\{\{ secrets\.PULUMI_BACKEND_URL \}\}/,
    );
    assert.match(
      source,
      /AWS_SECRET_ACCESS_KEY: \$\{\{ secrets\.R2_STATE_SECRET_ACCESS_KEY \}\}/,
    );
    if (file === "deploy-plugin-registry.yml") {
      assert.match(source, /node infra\/pulumi\/shared-registry\/render\.mjs/);
      assert.match(
        source,
        /wrangler deploy --config wrangler\.production\.jsonc/,
      );
    }
  }
});
