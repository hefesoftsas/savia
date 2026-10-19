import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
for (const [file, stack] of [
  ["deploy-preview", "preview"],
  ["deploy-cloudflare", "production"],
]) {
  test(`${stack} loads validated outputs before one immutable managed publication`, async () => {
    const source = await readFile(
      new URL(`../../.github/workflows/${file}.yml`, import.meta.url),
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
    const load = source.indexOf("name: Load infrastructure stack outputs"),
      prepare = source.indexOf("name: Prepare one immutable runtime release"),
      plan = source.indexOf("name: Review the saved managed runtime plan"),
      apply = source.indexOf("name: Apply the exact managed runtime plan");
    assert.ok(load >= 0 && prepare > load && plan > prepare && apply > plan);
    const guard = source.indexOf(
      stack === "preview"
        ? "name: Verify isolated preview resources before any mutation"
        : "name: Run the production readiness preflight before any mutation",
    );
    assert.ok(guard > load && guard < prepare);
    assert.match(
      source,
      new RegExp(
        `environment\\.mjs apply --environment ${stack}.*--artifact.*--plan.*--apply`,
      ),
    );
    assert.doesNotMatch(
      source,
      /command:.*deploy --config|flows-preview-recovery\.mjs --action restore|finalize-domain-transition/,
    );
    if (stack === "production")
      assert.match(
        source,
        /vars\.PRODUCTION_OPERATIONS_ENABLED == 'true'.*github\.ref == 'refs\/heads\/main'/,
      );
    assert.match(
      source,
      /CLOUDFLARE_DATABASE_ID: \$\{\{ env\.SAVIA_DOMAIN_D1_ID \}\}/,
    );
  });
}
test("temporary previews and registry use the central infrastructure toolchain", async () => {
  for (const file of [
    "preview-environment",
    "preview-quickjs",
    "deploy-plugin-registry",
  ]) {
    const source = await readFile(
      new URL(`../../.github/workflows/${file}.yml`, import.meta.url),
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
    if (file === "deploy-plugin-registry") {
      assert.match(source, /environment\.mjs apply --environment shared/);
      assert.match(
        source,
        /REGISTRY_CREDENTIALS: \$\{\{ secrets\.PLUGIN_REGISTRY_CREDENTIALS \}\}/,
      );
      assert.doesNotMatch(source, /wrangler deploy|\.registry-secrets\.json/);
    }
  }
});
