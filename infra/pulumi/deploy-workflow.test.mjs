import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("preview deployment loads its imported IaC stack before publishing Workers", async () => {
  const source = await readFile(
    new URL("../../.github/workflows/deploy-preview.yml", import.meta.url),
    "utf8",
  );
  assert.match(source, /uses: \.\/\.github\/actions\/pulumi-infrastructure/);
  assert.match(source, /stack: preview/);
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
  const verify = source.indexOf(
    "- name: Verify isolated preview resources before any mutation",
  );
  const apply = source.indexOf(
    "- name: Apply infrastructure before Worker deployment",
  );
  const worker = source.indexOf("- name: Deploy savia-auth");
  assert.ok(load >= 0 && verify > load && apply > verify && worker > apply);
  assert.match(
    source,
    /CLOUDFLARE_DATABASE_ID: \$\{\{ env\.SAVIA_DOMAIN_D1_ID \}\}/,
  );
});

test("production application deployment workflow is absent", async () => {
  await assert.rejects(
    access(
      new URL("../../.github/workflows/deploy-cloudflare.yml", import.meta.url),
    ),
    { code: "ENOENT" },
  );
});

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
