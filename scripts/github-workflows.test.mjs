import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

function workflow(name) {
  return readFile(
    new URL(`../.github/workflows/${name}`, import.meta.url),
    "utf8",
  );
}

test("CI validates main pushes and pull requests without deployment credentials", async () => {
  const ci = await workflow("ci.yml");

  assert.match(ci, /push:\n\s+branches: \[main\]/);
  assert.match(ci, /pull_request:/);
  assert.match(ci, /workflow_call:/);
  assert.doesNotMatch(ci, /paths-ignore:/);
  assert.match(ci, /contents: read/);
  assert.match(
    ci,
    /runs-on: ubuntu-24\.04\n(?:\s+environment: production\n)?\s+env:\n\s+PNPM_CONFIG_STRICT_DEP_BUILDS: "false"\n\s+steps:/,
  );
  assert.match(ci, /^  admin:/m);
  assert.match(ci, /^  api:/m);
  assert.match(ci, /^  workspace:/m);
  assert.match(ci, /^  contracts:/m);
  assert.match(ci, /^  typecheck:/m);
  assert.match(ci, /pnpm run test:unit:admin/);
  assert.match(ci, /pnpm run test:unit:api/);
  assert.match(ci, /pnpm run test:unit:workspace/);
  assert.match(ci, /pnpm run test:contracts/);
  assert.match(ci, /pnpm run typecheck/);
  assert.doesNotMatch(ci, /CLOUDFLARE_API_TOKEN|self-hosted|secrets\./);
});

test("plugin validation is part of the required Contract tests gate", async () => {
  const ci = await workflow("ci.yml");
  const contracts = ci.slice(
    ci.indexOf("  contracts:"),
    ci.indexOf("  typecheck:"),
  );

  assert.match(contracts, /needs:\n\s+- changes\n\s+- plugin-validation/);
  assert.match(contracts, /if: always\(\)/);
  assert.match(
    contracts,
    /needs\.changes\.result != 'success'[\s\S]*needs\.plugin-validation\.result != 'success'/,
  );
  assert.match(contracts, /run: exit 1/);
});

test("production application deployment and backup workflows are retired", async () => {
  for (const name of [
    "deploy-cloudflare.yml",
    "backup-production.yml",
    "check-production-backups.yml",
    "import-savia-request-variables.yml",
  ]) {
    await assert.rejects(
      access(new URL(`../.github/workflows/${name}`, import.meta.url)),
      {
        code: "ENOENT",
      },
    );
  }

  const pulumi = await workflow("pulumi.yml");
  assert.match(pulumi, /options: \[preview, apply\]/);
  assert.match(pulumi, /default: preview/);
  assert.match(pulumi, /environment: preview/);
  assert.match(pulumi, /SAVIA_INFRA_STACK: preview/);
  assert.doesNotMatch(pulumi, /inputs\.stack|production/);
});

test("QuickJS PR previews require an explicit label on same-repository main PRs", async () => {
  const preview = await workflow("preview-quickjs.yml");
  assert.match(preview, /pull_request:/);
  assert.match(preview, /branches: \[main\]/);
  assert.match(preview, /types: \[labeled\]/);
  assert.match(preview, /github\.event\.label\.name == 'quickjs-preview'/);
  assert.match(preview, /head\.repo\.full_name == github\.repository/);
  assert.match(preview, /base\.ref == 'main'/);
  assert.match(preview, /environment: preview/);
  assert.match(preview, /PREVIEW_BRANCH: \$\{\{ github\.head_ref \}\}/);
  assert.match(
    preview,
    /node scripts\/preview-deploy\.mjs --branch "\$PREVIEW_BRANCH"/,
  );
  assert.match(
    preview,
    /name: Verify QuickJS preview through authenticated service/,
  );
  assert.match(
    preview,
    /node scripts\/verify-quickjs-preview\.mjs --branch "\$PREVIEW_BRANCH"/,
  );
  assert.ok(
    preview.indexOf("Deploy explicitly labeled QuickJS branch preview") <
      preview.indexOf("Verify QuickJS preview through authenticated service"),
  );
  assert.doesNotMatch(preview, /synchronize|opened|reopened/);
  assert.doesNotMatch(preview, /cleanup:|preview-destroy\.mjs/);
});

test("preview deploys only successful same-repository main CI and uses its own environment", async () => {
  const preview = await workflow("deploy-preview.yml");
  assert.match(preview, /workflow_run:/);
  assert.match(preview, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(preview, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(
    preview,
    /github\.event\.workflow_run\.head_repository\.full_name == github\.repository/,
  );
  assert.match(preview, /github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(preview, /name: preview/);
  assert.match(preview, /SAVIA_DEPLOY_ENVIRONMENT: preview/);
  assert.match(preview, /upload-cloudflare-secrets\.mjs/);
  assert.match(preview, /verify-preview-health\.mjs/);
  assert.doesNotMatch(preview, /\n\s+secrets:/);
  assert.match(preview, /wrangler\.preview\.jsonc/);
  assert.match(preview, /git ls-remote --exit-code origin refs\/heads\/main/);
  assert.doesNotMatch(
    preview,
    /wrangler\.production\.jsonc|reset-d1|environment: production/,
  );
});

test("release plugins deploy to all workspaces using existing environment credentials", async () => {
  for (const name of ["deploy-preview.yml"]) {
    const source = await workflow(name);
    assert.ok(
      source.indexOf("name: Deploy savia gateway") <
        source.indexOf("run: node scripts/deploy-store-plugins.mjs"),
    );
    assert.ok(
      source.indexOf("run: node scripts/deploy-store-plugins.mjs") <
        source.indexOf("name: Verify deployed gateway"),
    );
    const step = source.slice(
      source.indexOf("name: Deploy release plugin ZIPs"),
      source.indexOf("name: Verify deployed gateway"),
    );
    assert.match(step, /CLOUDFLARE_API_TOKEN/);
    assert.match(step, /CLOUDFLARE_DATABASE_ID.*env.SAVIA_DOMAIN_D1_ID/);
    assert.doesNotMatch(
      step,
      /SAVIA_PLUGIN_TARGETS|SAVIA_DEPLOY_EMAIL|SAVIA_DEPLOY_PASSWORD/,
    );
  }
});

test("registry deployment exposes Cloudflare credentials only to the deploy step", async () => {
  const registry = await workflow("deploy-plugin-registry.yml");
  const beforeSteps = registry.split("    steps:")[0];
  assert.doesNotMatch(beforeSteps, /CLOUDFLARE_API_TOKEN/);
  assert.match(
    registry,
    /name: Deploy registry[\s\S]*?env:[\s\S]*?CLOUDFLARE_API_TOKEN:/,
  );
  assert.doesNotMatch(registry, /r2 bucket delete|r2 object delete/);
});

test("environment deployments forward the private registry tenant map", async () => {
  for (const name of ["deploy-preview.yml"]) {
    const source = await workflow(name);
    const upload = source.slice(
      source.indexOf("name: Upload secrets"),
      source.indexOf("name: Deploy savia-auth"),
    );
    assert.match(
      upload,
      /PLUGIN_REGISTRY_TENANTS: \$\{\{ secrets\.PLUGIN_REGISTRY_TENANTS \}\}/,
    );
    assert.match(
      upload,
      /WHATSAPP_META_APP_SECRET: \$\{\{ secrets\.WHATSAPP_META_APP_SECRET \}\}/,
    );
    assert.match(
      upload,
      /WHATSAPP_WEBHOOK_VERIFY_TOKEN: \$\{\{ secrets\.WHATSAPP_WEBHOOK_VERIFY_TOKEN \}\}/,
    );
  }
});

test("registry deployment accepts only the current main commit", async () => {
  const registry = await workflow("deploy-plugin-registry.yml");
  assert.match(
    registry,
    /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/,
  );
  assert.match(
    registry,
    /uses: actions\/checkout@v4\n\s+with:\n\s+ref: \$\{\{ github\.sha \}\}/,
  );
  const guardStart = registry.indexOf("name: Reject superseded deployments");
  const deployStart = registry.indexOf("name: Deploy registry");
  assert.ok(
    guardStart >
      registry.indexOf("run: pnpm --filter @savia/plugin-registry typecheck"),
  );
  assert.ok(deployStart > guardStart);
  const guard = registry.slice(guardStart, deployStart);
  assert.match(guard, /git ls-remote --exit-code origin refs\/heads\/main/);
  assert.match(
    guard,
    /if \[ "\$approved_sha" != "\$current_sha" \]; then[\s\S]*exit 1/,
  );
});

test("coverage measures main and manual runs without duplicating required PR tests", async () => {
  const coverage = await workflow("coverage.yml");
  assert.match(coverage, /push:\n\s+branches: \[main\]/);
  assert.match(coverage, /workflow_dispatch:/);
  assert.doesNotMatch(coverage, /pull_request(?:_target)?:/);
  assert.match(coverage, /pnpm test:coverage/);
  assert.match(coverage, /needs: coverage/);
  const ci = await workflow("ci.yml");
  assert.match(ci, /pull_request:/);
  assert.doesNotMatch(ci, /paths-ignore:|continue-on-error: true/);
});

test("Preview lanes are exclusive and plugin health stays within rollback protection", async () => {
  const preview = await workflow("deploy-preview.yml");
  assert.match(preview, /needs\.plan\.outputs\.kind == 'platform'/);
  assert.match(preview, /needs\.plan\.outputs\.kind == 'plugin'/);
  const pluginJob = preview.slice(preview.indexOf("\n  plugins:"));
  assert.match(
    pluginJob,
    /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/,
  );
  assert.match(pluginJob, /verify-preview-resources\.mjs/);
  assert.match(pluginJob, /git ls-remote --exit-code origin refs\/heads\/main/);
  assert.match(pluginJob, /publish-preview-plugins\.mjs --plan/);
  assert.match(pluginJob, /name: preview-plugin-recovery/);
  assert.match(pluginJob, /name: preview-release/);
  assert.doesNotMatch(
    pluginJob,
    /Verify existing Preview remains healthy|pulumi up|backup\.mjs|apply-d1-migrations/,
  );
});

test("manual previews validate trusted source before executing repository code", async () => {
  const preview = await workflow("preview-environment.yml");
  assert.match(
    preview,
    /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/,
  );
  const guard = preview.indexOf("name: Validate trusted preview source");
  const setup = preview.indexOf("name: Set up pnpm");
  assert.ok(guard > 0 && setup > guard);
  const checkout = preview.slice(0, guard);
  assert.match(checkout, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(checkout, /fetch-depth: 0/);
  assert.match(checkout, /persist-credentials: false/);
  assert.doesNotMatch(checkout, /ref: \$\{\{ inputs\.branch \}\}/);
  assert.doesNotMatch(
    preview,
    /run:[\s\S]*?\$\{\{ inputs\.(?:branch|confirm) \}\}/,
  );
});
