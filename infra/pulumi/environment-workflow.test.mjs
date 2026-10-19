import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const workflow = (name) =>
  readFile(
    new URL(`../../.github/workflows/${name}.yml`, import.meta.url),
    "utf8",
  );
test("platform and registry workflows use immutable lifecycle plans without competing publication or recovery", async () => {
  for (const [file, environment] of [
    ["deploy-preview", "preview"],
    ["deploy-cloudflare", "production"],
    ["deploy-plugin-registry", "shared"],
  ]) {
    const source = await workflow(file);
    assert.match(
      source,
      new RegExp(`environment\\.mjs apply --environment ${environment}`),
    );
    assert.match(source, /prepare-release\.mjs/);
    assert.doesNotMatch(
      source,
      /command:.*deploy --config|wrangler deploy|flows-preview-recovery\.mjs --action restore|finalize-domain-transition/,
    );
  }
});
test("branch operations preserve trusted lifecycle tooling, selected source evidence and explicit data deletion", async () => {
  const manual = await workflow("preview-environment"),
    quick = await workflow("preview-quickjs");
  assert.match(manual, /delete_data:/);
  assert.match(manual, /default: false/);
  for (const source of [manual, quick]) {
    assert.match(source, /SAVIA_RELEASE_SOURCE_ROOT/);
    assert.match(
      source,
      /git -c core\.hooksPath=\/dev\/null worktree add --detach/,
    );
  }
  assert.doesNotMatch(manual, /checkout --detach/);
  assert.match(quick, /ref: main/);
});

test("reviewed PR assets are downloaded by the producing job's immutable artifact ID", async () => {
  const source = await workflow("preview-quickjs");
  assert.match(
    source,
    /artifact_id: \$\{\{ steps\.upload_assets\.outputs\.artifact-id \}\}/,
  );
  assert.match(
    source,
    /artifact-ids: \$\{\{ needs\.build\.outputs\.artifact_id \}\}/,
  );
  assert.match(source, /run-id: \$\{\{ github\.run_id \}\}/);
  const download = source.slice(
    source.indexOf("uses: actions/download-artifact@v4"),
    source.indexOf("- uses: ./.github/actions/install-pulumi"),
  );
  assert.doesNotMatch(download, /\n\s+name: reviewed-quickjs-admin-assets/);
});
