import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
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
  assert.match(ci, /^  runtime-profile:/m);
  assert.match(
    ci,
    /ci_kind=\(infrastructure\|plugin\|none\|auth\|api\|backup-gate\)/,
  );
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
  assert.match(contracts, /if: >-\n\s+always\(\)/);
  assert.match(
    contracts,
    /needs\.changes\.result != 'success'[\s\S]*needs\.plugin-validation\.result != 'success'/,
  );
  assert.match(contracts, /run: exit 1/);
});

test("focused runtime profile failures block the required Contract tests gate", async () => {
  const ci = await workflow("ci.yml");
  const contracts = ci.slice(
    ci.indexOf("  contracts:"),
    ci.indexOf("  typecheck:"),
  );

  assert.match(contracts, /needs:[\s\S]*- runtime-profile/);
  assert.match(contracts, /name: Contract tests[\s\S]*?\n\s+if: always\(\)/);
  assert.match(contracts, /contains\(fromJSON\('[^']*backup-gate/);
  assert.match(contracts, /needs\.runtime-profile\.result != 'success'/);
});

test("long-running CI jobs honor cancellation while Contracts retains its final guard", async () => {
  const ci = await workflow("ci.yml");
  const contracts = ci.slice(
    ci.indexOf("  contracts:"),
    ci.indexOf("  typecheck:"),
  );

  assert.doesNotMatch(ci, /^\s+if: always\(\) &&/m);
  assert.match(contracts, /^    if: always\(\)$/m);
  assert.match(
    contracts,
    /Require a successful change classification[\s\S]*?if: >-[\s\S]*?always\(\)/,
  );
  assert.match(ci, /!cancelled\(\)/);
});

test("production deployment is limited to main and has ordered Worker stages", async () => {
  const deploy = await workflow("deploy-cloudflare.yml");

  assert.doesNotMatch(deploy, /workflow_run:/);
  assert.match(deploy, /workflow_dispatch:/);
  assert.match(deploy, /group: savia-production/);
  assert.match(
    deploy,
    /verify:[\s\S]*?run: node infra\/pulumi\/production-ci-proof\.mjs/,
  );
  assert.doesNotMatch(deploy, /uses: \.\/\.github\/workflows\/ci\.yml/);
  assert.match(deploy, /needs: preview-check/);
  assert.match(deploy, /needs\.verify\.result == 'success'/);
  assert.match(deploy, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(deploy, /deploy:\n\s+needs: verify/);
  assert.match(deploy, /git ls-remote --exit-code origin refs\/heads\/main/);
  assert.doesNotMatch(deploy, /pnpm test && pnpm run typecheck/);
  assert.match(
    deploy,
    /runs-on: ubuntu-24\.04\n\s+environment: production-app\n\s+env:\n\s+PNPM_CONFIG_STRICT_DEP_BUILDS: "false"\n\s+SAVIA_BACKUP_ENVIRONMENT: production\n\s+steps:/,
  );
  assert.match(deploy, /environment\.mjs apply --environment production/);
  assert.match(deploy, /prepare-release\.mjs --environment production/);
  assert.match(deploy, /SAVIA_MCP_SHARED_SECRET/);
  assert.match(deploy, /ASSISTANT_SETTINGS_ENCRYPTION_KEY/);
  assert.match(deploy, /NANGO_API_KEY/);
  assert.match(deploy, /BETTER_AUTH_SECRET/);
  assert.doesNotMatch(deploy, /\n\s+secrets:/);
  assert.doesNotMatch(
    deploy,
    /command:.*deploy --config|finalize-domain-transition/,
  );
  assert.doesNotMatch(deploy, /branches:\s*\["\*"\]/);
  assert.doesNotMatch(deploy, /curl[^\n]*savia\.app\.hefesoft\.com\/health/);
});

test("QuickJS PR previews require an explicit label on same-repository main PRs", async () => {
  const preview = await workflow("preview-quickjs.yml");
  assert.match(preview, /pull_request_target:/);
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

test("production import is disabled unless explicitly enabled", async () => {
  const source = await workflow("import-savia-request-variables.yml");
  assert.match(source, /vars\.PRODUCTION_OPERATIONS_ENABLED == 'true'/);
  assert.match(source, /github\.ref == 'refs\/heads\/main'/);
  assert.match(source, /environment: production/);
});

test("production operations fail closed behind an explicit repository variable", async () => {
  const deploy = await workflow("deploy-cloudflare.yml");
  const backup = await workflow("backup-production.yml");
  const freshness = await workflow("check-production-backups.yml");
  const pulumi = await workflow("pulumi.yml");

  assert.match(
    deploy,
    /if: \$\{\{ vars\.PRODUCTION_OPERATIONS_ENABLED == 'true' && github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/,
  );
  const deployJob = deploy.slice(deploy.indexOf("\n  deploy:"));
  assert.match(
    deployJob,
    /if: \$\{\{ vars\.PRODUCTION_OPERATIONS_ENABLED == 'true' && github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/,
  );
  assert.match(
    backup,
    /if: \$\{\{ vars\.PRODUCTION_OPERATIONS_ENABLED == 'true' && github\.ref == 'refs\/heads\/main' \}\}/,
  );
  assert.match(
    freshness,
    /if: \$\{\{ vars\.PRODUCTION_OPERATIONS_ENABLED == 'true' && github\.ref == 'refs\/heads\/main' \}\}/,
  );
  assert.match(
    pulumi,
    /if: \$\{\{ github\.event_name == 'workflow_dispatch' && \(inputs\.operation == 'preview' \|\| inputs\.operation == 'apply'\) && \(inputs\.stack == 'preview' \|\| \(inputs\.stack == 'production' && vars\.PRODUCTION_OPERATIONS_ENABLED == 'true' && github\.ref == 'refs\/heads\/main'\)\) \}\}/,
  );
  assert.match(pulumi, /options: \[preview, production\]/);
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
  assert.match(preview, /environment\.mjs apply --environment preview/);
  assert.match(preview, /prepare-release\.mjs --environment preview/);
  assert.doesNotMatch(preview, /\n\s+secrets:/);
  assert.doesNotMatch(preview, /command:.*deploy --config/);
  assert.match(preview, /git ls-remote --exit-code origin refs\/heads\/main/);
  assert.doesNotMatch(
    preview,
    /wrangler\.production\.jsonc|reset-d1|environment: production/,
  );
  assert.match(
    preview,
    /SAVIA_PREVIEW_RELEASE_BASE: \$\{\{ needs\.plan\.outputs\.base \}\}/,
  );
  assert.match(
    preview,
    /name: Check out source[\s\S]*?ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}\n\s+fetch-depth: 0/,
  );
  assert.match(
    preview,
    /office_runtime_changed: \$\{\{ steps\.plan\.outputs\.office_runtime_changed \}\}/,
  );
  assert.match(
    preview,
    /store_plugins_changed: \$\{\{ steps\.plan\.outputs\.store_plugins_changed \}\}/,
  );
  assert.match(
    preview,
    /name: Prepare Office runtime assets\n\s+if: \$\{\{ success\(\) && !cancelled\(\) && needs\.plan\.outputs\.office_runtime_changed == 'true' \}\}/,
  );
  assert.match(
    preview,
    /name: Deploy release plugin ZIPs to all workspaces\n\s+if: \$\{\{ success\(\) && !cancelled\(\) && needs\.plan\.outputs\.store_plugins_changed == 'true' \}\}/,
  );
});

test("release plugins deploy to all workspaces using existing environment credentials", async () => {
  for (const name of ["deploy-cloudflare.yml", "deploy-preview.yml"]) {
    const source = await workflow(name);
    assert.ok(
      source.indexOf("name: Apply the exact managed runtime plan") <
        source.indexOf("run: node scripts/deploy-store-plugins.mjs"),
    );
    const step = source.slice(
      source.indexOf("name: Deploy release plugin ZIPs"),
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
  for (const name of ["deploy-preview.yml", "deploy-cloudflare.yml"]) {
    const source = await workflow(name);
    const upload = source.slice(
      source.indexOf("name: Apply the exact managed runtime plan"),
      source.indexOf("name: Deploy release plugin ZIPs"),
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

test("production promotion still requires the full verified Preview job", async () => {
  const production = await workflow("deploy-cloudflare.yml");
  assert.match(production, /Deploy preview/);
  assert.doesNotMatch(production, /Publish changed Preview plugins/);
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

test("Flows CI splits all seven package suites and keeps readiness fail-closed", async () => {
  const ci = await workflow("ci.yml");
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const lanes = ["flows-api", "flows-core", "flows-readiness"];
  const laneBlocks = lanes.map((name) => {
    const start = ci.indexOf(`  ${name}:`);
    assert.notEqual(start, -1, `missing ${name} lane`);
    const rest = ci.slice(start);
    const next = rest.search(/\n  [a-z][\w-]*:\n/);
    return rest.slice(0, next === -1 ? undefined : next);
  });

  assert.deepEqual(
    packageJson.scripts["flows:test:api"],
    "pnpm --filter @savia/flows-api test",
  );
  assert.deepEqual(
    packageJson.scripts["flows:test:core"],
    [
      "pnpm --filter @savia/flows test",
      "pnpm --filter @savia/flows-native test",
      "pnpm --filter @savia/flows-app test",
      "pnpm --filter @savia/flows-runtime test",
      "pnpm --filter @savia/flows-geo test",
      "pnpm --filter @savia/flows-utils test",
    ].join(" && "),
  );
  assert.deepEqual(
    packageJson.scripts["flows:test"],
    "pnpm run flows:test:core && pnpm run flows:test:api",
  );
  assert.match(laneBlocks[0], /pnpm run flows:test:api/);
  assert.match(laneBlocks[1], /pnpm run flows:test:core/);
  assert.match(laneBlocks[1], /flows:verify/);
  assert.doesNotMatch(
    laneBlocks[1],
    /flows:typecheck|Verify infrastructure and recovery/,
  );
  assert.match(laneBlocks[2], /flows:typecheck/);
  assert.match(laneBlocks[2], /hook-executor typecheck/);
  assert.match(laneBlocks[2], /npm ci --prefix infra\/pulumi --ignore-scripts/);
  assert.match(laneBlocks[2], /infra\/pulumi\/\*\.test\.mjs/);

  const gateStart = ci.indexOf("\n  flows:\n");
  const gateEnd = ci.indexOf("\n  publication-safety:", gateStart);
  const gate = ci.slice(gateStart, gateEnd);
  assert.match(gate, /name: Flows runtime and preview readiness/);
  assert.match(
    gate,
    /needs:\n\s+- changes\n\s+- flows-api\n\s+- flows-core\n\s+- flows-readiness/,
  );
  assert.match(gate, /if: \$\{\{ !cancelled\(\)/);
  assert.match(
    gate,
    /needs\.flows-api\.result }}" != "success"[\s\S]*needs\.flows-core\.result }}" != "success"[\s\S]*needs\.flows-readiness\.result }}" != "success"/,
  );
  assert.match(gate, /exit 1/);

  const gateScript = gate
    .match(/        run: \|\n((?:          .*\n)+)/)?.[1]
    ?.replace(/^          /gm, "");
  assert.ok(
    gateScript,
    "aggregate gate must provide an executable shell script",
  );
  const results = ["success", "failure", "cancelled", "skipped"];
  for (const apiResult of results) {
    for (const coreResult of results) {
      for (const readinessResult of results) {
        const script = gateScript
          .replaceAll("${{ needs.flows-api.result }}", apiResult)
          .replaceAll("${{ needs.flows-core.result }}", coreResult)
          .replaceAll("${{ needs.flows-readiness.result }}", readinessResult);
        const result = spawnSync(
          "bash",
          ["-e", "-u", "-o", "pipefail", "-c", script],
          {
            encoding: "utf8",
          },
        );

        assert.equal(
          result.status,
          apiResult === "success" &&
            coreResult === "success" &&
            readinessResult === "success"
            ? 0
            : 1,
          `aggregate gate result for API=${apiResult}, core=${coreResult}, readiness=${readinessResult}`,
        );
      }
    }
  }

  for (const lane of laneBlocks) {
    assert.match(lane, /needs: changes/);
    assert.match(
      lane,
      /if: \$\{\{ !cancelled\(\) && \(needs\.changes\.result != 'success' \|\| needs\.changes\.outputs\.ci_flows == 'true'\) \}\}/,
    );
  }
});

test("focused API validation regenerates and typechecks frontend consumers", async () => {
  const ci = await workflow("ci.yml");
  const profile = ci.split("            api)")[1].split(";;")[0];
  assert.match(profile, /pnpm --filter @savia\/admin typecheck/);
});

test("focused API changes retain all three parallel API test shards", async () => {
  const ci = await workflow("ci.yml");
  const shards = ci.slice(
    ci.indexOf("  api:\n"),
    ci.indexOf("  runtime-profile:\n"),
  );
  assert.equal(
    (shards.match(/contains\(fromJSON\('\["full","api"\]'\)/g) ?? []).length,
    3,
  );
  assert.equal((shards.match(/pnpm run test:unit:api/g) ?? []).length, 3);
  const profile = ci.split("            api)")[1].split(";;")[0];
  assert.doesNotMatch(profile, /@savia\/api test/);
});
