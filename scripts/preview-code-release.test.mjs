import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyPreviewCodeChanges,
  derivePreviewCodeScope,
} from "./preview-code-release.mjs";
const file = (
  path,
  before = "export const x = 1",
  after = "export const x = 2",
) => ({ path, before, after });
test("isolated source targets and conservative shared coordinator fallback", () => {
  assert.deepEqual(
    classifyPreviewCodeChanges([file("apps/api/src/auth/admin-oauth.ts")]),
    ["api"],
  );
  assert.equal(
    classifyPreviewCodeChanges([file("packages/backup-gate/index.mjs")]),
    null,
  );
});
test("unknown, configuration, schema and entrypoint changes require full publication", () => {
  for (const path of [
    "pnpm-lock.yaml",
    "infra/pulumi/index.ts",
    "apps/auth/src/index.ts",
    "apps/api/src/env.ts",
    "packages/db/migrations/01.sql",
    "apps/admin/vite.config.ts",
    "apps/admin/src/plugin-vscode-runtime.ts",
  ])
    assert.equal(classifyPreviewCodeChanges([file(path)]), null, path);
  for (const source of [
    "CREATE TABLE users",
    "CREATE UNIQUE INDEX users_email",
    "CREATE TEMP TABLE users",
    "ALTER TABLE users",
    "getMigrations(auth)",
    "betterAuth({})",
    "oauthProvider({})",
  ])
    assert.equal(
      classifyPreviewCodeChanges([file("apps/auth/src/session.ts", source)]),
      null,
      source,
    );
  assert.equal(
    classifyPreviewCodeChanges([file("apps/api/src/new.ts", null)]),
    null,
  );
  assert.equal(classifyPreviewCodeChanges([file("docs/guide.md")]), null);
});

test("frontend source freezes both frontend targets and rejects mixed or unproven scopes", () => {
  for (const path of [
    "apps/admin/src/components/Button.tsx",
    "apps/admin/src/app.css",
    "apps/admin/src/i18n/locales/savia.ts",
  ]) {
    assert.deepEqual(classifyPreviewCodeChanges([file(path)]), [
      "pluginEditor",
      "gateway",
    ]);
    assert.equal(classifyPreviewCodeChanges([file(path, null)]), null);
    assert.equal(
      classifyPreviewCodeChanges([
        file(path),
        file("apps/auth/src/session.ts"),
      ]),
      null,
    );
  }
  for (const path of [
    "apps/admin/src/edge-gateway.ts",
    "apps/admin/src/office-gateway.ts",
    "apps/admin/package.json",
    "apps/admin/wrangler.preview.jsonc",
    "apps/admin/build/manual-chunks.ts",
    "apps/admin/vite.config.ts",
  ]) {
    assert.equal(
      classifyPreviewCodeChanges([file("apps/admin/src/app.tsx"), file(path)]),
      null,
    );
  }
});
test("scope requires a verified ancestor and exact source reads; errors fail closed", async () => {
  const base = "a".repeat(40),
    head = "b".repeat(40);
  const calls = [];
  const run = async (_, args) => {
    calls.push(args);
    return {
      stdout:
        args[0] === "diff"
          ? "apps/api/src/auth/admin-oauth.ts\n"
          : args[0] === "show"
            ? "export const x = 1"
            : "",
    };
  };
  assert.deepEqual(await derivePreviewCodeScope({ base, head, run }), {
    base,
    head,
    targets: ["api"],
  });
  assert.equal(calls[0][0], "merge-base");
  assert.equal(
    await derivePreviewCodeScope({
      base,
      head,
      run: async () => {
        throw new Error("missing history");
      },
    }),
    null,
  );
  assert.equal(await derivePreviewCodeScope({ head, run }), null);
});

test("pending compatible code stays scoped across unrelated deployment tooling changes", () => {
  assert.deepEqual(
    classifyPreviewCodeChanges([
      file("apps/auth/src/lib/utils.ts"),
      file("infra/pulumi/runtime-artifact-custody.mjs"),
      file("scripts/preview-code-release.mjs"),
      file("scripts/preview-release-plan.mjs"),
      file(".github/workflows/deploy-preview.yml"),
    ]),
    ["auth"],
  );
  assert.equal(
    classifyPreviewCodeChanges([
      file("apps/auth/src/lib/utils.ts"),
      file("infra/pulumi/worker-config.mjs"),
    ]),
    null,
  );
  assert.equal(
    classifyPreviewCodeChanges([
      file("infra/pulumi/runtime-artifact-custody.mjs"),
    ]),
    null,
  );
});

test("derivation skips non-runtime paths before reading files absent from the baseline", async () => {
  const base = "a".repeat(40),
    head = "b".repeat(40);
  const scope = await derivePreviewCodeScope({
    base,
    head,
    run: async (_, args) => {
      if (args[0] === "diff")
        return {
          stdout: "apps/auth/src/lib/utils.ts\ndocs/new-release-guide.md\n",
        };
      if (args[0] === "show" && args[1].includes("docs/"))
        throw Error("new guide missing from baseline");
      return { stdout: "export const x = 1" };
    },
  });
  assert.deepEqual(scope, { base, head, targets: ["auth"] });
});
