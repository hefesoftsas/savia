import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const workflow = (name) =>
  readFile(
    new URL(`../../.github/workflows/${name}.yml`, import.meta.url),
    "utf8",
  );
test("Preview retains only encrypted command diagnostics outside its private recovery directory", async () => {
  const source = await workflow("deploy-preview");
  const start = source.indexOf("- name: Encrypt private command diagnostics");
  assert.notEqual(start, -1);
  const diagnostics = source.slice(
    start,
    source.indexOf("- name: Retain encrypted managed recovery archive", start),
  );
  assert.match(diagnostics, /if: \$\{\{ always\(\) \}\}/);
  assert.match(diagnostics, /-C "\$RUNNER_TEMP\/savia-runtime" command-errors/);
  assert.match(diagnostics, /encrypt-flows-backup\.mjs --action encrypt/);
  assert.match(
    diagnostics,
    /SAVIA_BACKUP_KEY: \$\{\{ secrets\.SAVIA_FLOWS_BACKUP_KEY \}\}/,
  );
  assert.match(
    diagnostics,
    /path: \$\{\{ runner\.temp \}\}\/preview-command-diagnostics\.enc/,
  );
  assert.match(diagnostics, /retention-days: 7/);
  assert.doesNotMatch(diagnostics, /path:.*(?:\.tar|savia-runtime\/)/);
});
test("Production retains encrypted command diagnostics using its own backup key", async () => {
  const source = await workflow("deploy-cloudflare");
  const start = source.indexOf("- name: Encrypt private command diagnostics");
  assert.notEqual(start, -1);
  const diagnostics = source.slice(
    start,
    source.indexOf("- name: Deploy release plugin ZIPs", start),
  );
  assert.match(diagnostics, /if: \$\{\{ always\(\) \}\}/);
  assert.match(diagnostics, /-C "\$RUNNER_TEMP\/savia-runtime" command-errors/);
  assert.match(diagnostics, /encrypt-flows-backup\.mjs --action encrypt/);
  assert.match(
    diagnostics,
    /SAVIA_BACKUP_KEY: \$\{\{ secrets\.SAVIA_BACKUP_KEY \}\}/,
  );
  assert.match(
    diagnostics,
    /path: \$\{\{ runner\.temp \}\}\/production-command-diagnostics\.enc/,
  );
  assert.match(diagnostics, /retention-days: 7/);
  assert.doesNotMatch(diagnostics, /path:.*(?:\.tar|savia-runtime\/)/);
});
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

test("preview retries reuse one encrypted same-run release artifact and make a fresh live-state plan", async () => {
  const source = await workflow("deploy-preview");
  const find = source.indexOf(
    "- name: Find exact same-run Preview release artifact",
  );
  const download = source.indexOf(
    "- name: Download exact same-run Preview release artifact",
  );
  const restore = source.indexOf(
    "- name: Restore encrypted Preview release artifact",
  );
  const prepare = source.indexOf(
    "- name: Prepare one immutable runtime release",
  );
  const plan = source.indexOf("- name: Review the saved managed runtime plan");
  const retain = source.indexOf(
    "- name: Encrypt immutable Preview release artifact",
  );
  const upload = source.indexOf(
    "- name: Retain immutable Preview release for same-run retry",
  );
  const apply = source.indexOf("- name: Apply the exact managed runtime plan");
  assert.ok(
    find >= 0 && find < download && download < restore && restore < prepare,
  );
  assert.ok(
    prepare < retain && retain < upload && upload < plan && plan < apply,
  );
  assert.match(source.slice(find, download), /GITHUB_RUN_ID/);
  assert.match(source.slice(find, download), /GITHUB_SHA|APPROVED_SHA/);
  assert.match(source.slice(find, download), /ambiguous|length > 1/);
  assert.match(
    source.slice(download, restore),
    /artifact-ids: \$\{\{ steps\.find_retry_release\.outputs\.artifact_id \}\}/,
  );
  assert.match(source.slice(download, restore), /merge-multiple: true/);
  const downloadedPath = source
    .slice(download, restore)
    .match(/path: (.+)/)?.[1];
  const uploadedPath = source
    .slice(upload, plan)
    .match(/path: (.+)\/\*\.enc/)?.[1];
  assert.ok(downloadedPath && uploadedPath);
  assert.notEqual(
    downloadedPath,
    uploadedPath,
    "A config-change rebuild must not overwrite exclusive-create retry inputs",
  );
  assert.match(
    source.slice(restore, prepare),
    /runtime-artifact-custody\.mjs restore/,
  );
  assert.match(
    source.slice(restore, prepare),
    /SAVIA_BACKUP_KEY: \$\{\{ secrets\.SAVIA_FLOWS_BACKUP_KEY \}\}/,
  );
  assert.match(source.slice(restore, prepare), /\.restored/);
  assert.match(source.slice(restore, prepare), /unexpected or ambiguous files/);
  assert.match(
    source.slice(prepare, plan),
    /steps\.restore_release\.outputs\.restored != 'true'/,
  );
  assert.match(source.slice(retain, apply), /overwrite: true/);
  assert.match(
    source.slice(retain, apply),
    /SAVIA_BACKUP_KEY: \$\{\{ secrets\.SAVIA_FLOWS_BACKUP_KEY \}\}/,
  );
  assert.match(source.slice(retain, apply), /retention-days: 7/);
  assert.match(source.slice(find, download), /GITHUB_TOKEN/);
  assert.match(source.slice(find, download), /run\?\.head_sha/);
  assert.match(source.slice(plan, apply), /environment\.mjs plan/);
  assert.doesNotMatch(
    source.slice(find, apply),
    /environment\.mjs apply .*--plan.*\.pulumi\.json/,
  );
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

test("reviewed asset extraction cannot overwrite either checkout or local deployment actions", async () => {
  const source = await workflow("preview-quickjs");
  assert.match(
    source,
    /path: \$\{\{ runner\.temp \}\}\/reviewed-quickjs-assets/,
  );
  assert.match(
    source,
    /SAVIA_RELEASE_ASSETS_DIRECTORY: \$\{\{ runner\.temp \}\}\/reviewed-quickjs-assets/,
  );
  assert.doesNotMatch(
    source,
    /path: \$\{\{ env\.SAVIA_RELEASE_SOURCE_ROOT \}\}/,
  );
});
