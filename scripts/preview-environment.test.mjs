import { workerConfig } from "./preview-deploy.mjs";
import assert from "node:assert/strict";
import test from "node:test";

import {
  PROTECTED_BRANCHES,
  assertDestroyTarget,
  findDatabaseUuid,
  flagValue,
  hasFlag,
  previewNames,
  slugifyBranch,
} from "./preview-environment.mjs";

test("slugifies branch names into dns-safe preview slugs", () => {
  assert.equal(slugifyBranch("feat/login-form"), "feat-login-form");
  assert.equal(slugifyBranch("Feature_OAuth2"), "feature-oauth2");
  assert.equal(slugifyBranch("  HOTFIX  "), "hotfix");
  assert.equal(slugifyBranch("a".repeat(60)).length <= 24, true);
});

test("refuses protected and empty refs", () => {
  for (const branch of [...PROTECTED_BRANCHES, "", "  ", "x", "a-"]) {
    assert.throws(() => slugifyBranch(branch), /Refusing|slugify/);
  }
  assert.throws(() => slugifyBranch("MAIN"), /protected/);
});

test("derives preview resource names with a shared suffix", () => {
  const names = previewNames("login-form");
  assert.equal(names.suffix, "preview-login-form");
  assert.equal(names.workers.api, "savia-agencies-preview-login-form");
  assert.equal(names.workers.gateway, "savia-preview-login-form");
  assert.equal(
    names.workers.hookExecutor,
    "savia-hook-executor-preview-login-form",
  );
  assert.equal(names.databases.domain, "savia-agencies-preview-login-form");
  assert.equal(names.databases.auth, "savia-auth-preview-login-form");
  assert.equal(names.bucket, "savia-documents-preview-login-form");
});

test("destroy guard only allows its own preview resources", () => {
  assert.equal(
    assertDestroyTarget("savia-agencies-preview-login-form", "login-form"),
    "savia-agencies-preview-login-form",
  );
  for (const name of [
    "savia-agencies",
    "savia-agencies-preview-other",
    "savia-agencies-preview-login-form-evil ../x",
    "",
  ]) {
    assert.throws(() => assertDestroyTarget(name, "login-form"), /Refusing/);
  }
});

test("finds database uuids across wrangler output shapes", () => {
  const rows = [
    { name: "a-preview-x", uuid: "11111111-2222-3333-4444-555555555555" },
  ];
  assert.equal(
    findDatabaseUuid(JSON.stringify(rows), "a-preview-x"),
    "11111111-2222-3333-4444-555555555555",
  );
  assert.equal(
    findDatabaseUuid({ d1_databases: rows }, "a-preview-x"),
    "11111111-2222-3333-4444-555555555555",
  );
  assert.equal(findDatabaseUuid("[]", "missing"), null);
});

test("parses CLI flags", () => {
  assert.equal(flagValue(["--branch", "x"], "--branch"), "x");
  assert.throws(() => flagValue(["--branch"], "--branch"), /Missing/);
  assert.throws(() => flagValue([], "--branch"), /Missing/);
  assert.equal(hasFlag(["--dry-run"], "--dry-run"), true);
  assert.equal(hasFlag([], "--dry-run"), false);
});

test("routes preview download catalogs through the worker before SPA fallback", () => {
  const config = workerConfig(
    "gateway",
    previewNames("download-test"),
    {},
    "https://preview.example.test",
  );
  assert.ok(
    config.assets.run_worker_first.includes("/companion-downloads.json"),
  );
});

test("routes preview short booking URLs through the API before SPA fallback", () => {
  const config = workerConfig(
    "gateway",
    previewNames("booking-links"),
    {},
    "https://preview.example.test",
  );
  assert.ok(config.assets.run_worker_first.includes("/s/*"));
});

test("binds the private branch hook executor to Savia request", () => {
  const names = previewNames("quickjs-hooks");
  const executor = workerConfig(
    "hookExecutor",
    names,
    {},
    "https://preview.example.test",
  );
  const request = workerConfig(
    "request",
    names,
    { domain: "preview-domain-id" },
    "https://preview.example.test",
  );
  assert.equal(executor.name, "savia-hook-executor-preview-quickjs-hooks");
  assert.equal(executor.main.endsWith("apps/hook-executor/src/index.ts"), true);
  assert.equal(executor.compatibility_date, "2026-09-04");
  assert.equal(executor.workers_dev, false);
  assert.equal(executor.preview_urls, false);
  assert.deepEqual(executor.limits, { cpu_ms: 30000 });
  assert.deepEqual(executor.rules, [
    {
      type: "CompiledWasm",
      globs: ["**/*.wasm"],
      fallthrough: true,
    },
  ]);
  assert.deepEqual(Object.keys(executor).sort(), [
    "compatibility_date",
    "limits",
    "main",
    "name",
    "preview_urls",
    "rules",
    "workers_dev",
  ]);
  assert.deepEqual(request.services, [
    {
      binding: "HOOK_SERVICE",
      service: "savia-hook-executor-preview-quickjs-hooks",
    },
  ]);
  assert.equal("worker_loaders" in request, false);
  assert.equal(request.workers_dev, false);
  assert.equal(request.preview_urls, false);
});
