import assert from "node:assert/strict";
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
  assert.match(ci, /pnpm run test:unit:admin/);
  assert.match(ci, /pnpm run test:unit:api/);
  assert.match(ci, /pnpm run test:unit:workspace/);
  assert.match(ci, /pnpm run test:contracts/);
  assert.match(ci, /pnpm run typecheck/);
  assert.doesNotMatch(ci, /CLOUDFLARE_API_TOKEN|self-hosted|secrets\./);
});

test("production deployment is limited to main and has ordered Worker stages", async () => {
  const deploy = await workflow("deploy-cloudflare.yml");

  assert.doesNotMatch(deploy, /workflow_run:/);
  assert.match(deploy, /workflow_dispatch:/);
  assert.match(deploy, /group: savia-production/);
  assert.match(deploy, /verify:[\s\S]*?uses: \.\/\.github\/workflows\/ci\.yml/);
  assert.match(deploy, /needs: preview-check/);
  assert.match(deploy, /needs\.verify\.result == 'success'/);
  assert.match(deploy, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(deploy, /deploy:\n\s+needs: verify/);
  assert.match(deploy, /git ls-remote --exit-code origin refs\/heads\/main/);
  assert.doesNotMatch(deploy, /pnpm test && pnpm run typecheck/);
  assert.match(
    deploy,
    /runs-on: ubuntu-24\.04\n\s+environment: production\n\s+env:\n\s+PNPM_CONFIG_STRICT_DEP_BUILDS: "false"\n\s+steps:/,
  );
  assert.match(deploy, /savia-auth/);
  assert.match(deploy, /- name: Deploy private Savia FastMCP/);
  assert.match(deploy, /workingDirectory: apps\/mcp/);
  assert.match(deploy, /SAVIA_MCP_SHARED_SECRET/);
  assert.match(
    deploy,
    /- name: Apply Savia domain migrations\n\s+run: node scripts\/apply-d1-migrations\.mjs/,
  );
  assert.match(deploy, /savia-agencies/);
  assert.match(
    deploy,
    /- name: Deploy private Savia request[\s\S]*?workingDirectory: apps\/savia-request/,
  );
  assert.match(
    deploy,
    /Apply Savia domain migrations[\s\S]*?Deploy private Savia request[\s\S]*?Deploy savia-agencies/,
  );
  assert.match(deploy, /upload-cloudflare-secrets\.mjs/);
  assert.doesNotMatch(deploy, /\n\s+secrets:/);
  assert.match(deploy, /ASSISTANT_SETTINGS_ENCRYPTION_KEY/);
  assert.match(deploy, /NANGO_API_KEY/);
  assert.match(deploy, /deployments status --name savia/);
  assert.match(deploy, /CLOUDFLARE_API_TOKEN/);
  assert.match(deploy, /BETTER_AUTH_SECRET/);
  assert.match(
    deploy,
    /- name: Deploy savia gateway[\s\S]*?command: --cwd \.\.\/admin deploy --config wrangler\.production\.jsonc[\s\S]*?workingDirectory: apps\/api/,
  );
  assert.doesNotMatch(deploy, /branches:\s*\["\*"\]/);
  assert.doesNotMatch(deploy, /curl[^\n]*savia\.app\.hefesoft\.com\/health/);
});

test("production import is disabled unless explicitly enabled", async () => {
  const source = await workflow("import-savia-request-variables.yml");
  assert.match(source, /vars\.PRODUCTION_OPERATIONS_ENABLED == 'true'/);
  assert.match(source, /github\.ref == 'refs\/heads\/main'/);
  assert.match(source, /environment: production/);
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
  for (const name of ["deploy-cloudflare.yml", "deploy-preview.yml"]) {
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
    assert.match(step, /CLOUDFLARE_DATABASE_ID.*vars.SAVIA_DOMAIN_D1_ID/);
    assert.doesNotMatch(
      step,
      /SAVIA_PLUGIN_TARGETS|SAVIA_DEPLOY_EMAIL|SAVIA_DEPLOY_PASSWORD/,
    );
  }
});
