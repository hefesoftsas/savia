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
