import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { classifyChanges } from "./preview-change-plan.mjs";

const manifest = (version = "1.0.0", extra = {}) => ({
  format: "savia.extension",
  formatVersion: 1,
  id: "custom.example",
  version,
  label: "Example",
  description: "Example extension",
  requires: [],
  apiVersion: 1,
  ...extra,
});

function fixture(t) {
  const repo = mkdtempSync(join(tmpdir(), "savia-preview-plan-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  const put = (path, content) => {
    const fullPath = join(repo, path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  };
  const commit = (message) => {
    git("add", "--all");
    git("commit", "-m", message);
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repo,
      encoding: "utf8",
    }).trim();
  };

  git("init", "-q");
  git("config", "user.email", "ci@example.invalid");
  git("config", "user.name", "CI Test");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  return { repo, git, put, commit };
}

function addPlugin(f, directory = "packages/plugin-example") {
  f.put(`${directory}/savia-extension.json`, JSON.stringify(manifest()));
  f.put(
    `${directory}/store.json`,
    JSON.stringify({ format: "savia.store", formatVersion: 1 }),
  );
  f.put(
    `${directory}/package.json`,
    JSON.stringify({ name: "@savia/plugin-example" }),
  );
  f.put(`${directory}/entry.tsx`, "export const entry = true;\n");
}

test("eligible plugin source and test changes require an increased strict semver", (t) => {
  const f = fixture(t);
  addPlugin(f);
  const base = f.commit("base");
  f.put("packages/plugin-example/entry.tsx", "export const entry = false;\n");
  f.put(
    "packages/plugin-example/dossier-panel.tsx",
    "export const panel = true;\n",
  );
  f.put("packages/plugin-example/styles.css", ".panel { display: block; }\n");
  f.put("packages/plugin-example/test/example.test.ts", "// test\n");
  f.put(
    "packages/plugin-example/savia-extension.json",
    JSON.stringify(manifest("1.0.1")),
  );
  const head = f.commit("plugin update");

  assert.deepEqual(classifyChanges({ base, head, repo: f.repo }), {
    kind: "plugin",
    flows: false,
    plugins: [
      {
        directory: "packages/plugin-example",
        id: "custom.example",
        version: "1.0.1",
        previousVersion: "1.0.0",
      },
    ],
    plugin_only: true,
    reasons: ["All changed files are eligible plugin source or metadata."],
  });
});

test("store-ports namespace is supported when all required metadata exists", (t) => {
  const f = fixture(t);
  addPlugin(f, "store-ports/example");
  const base = f.commit("base");
  f.put("store-ports/example/README.md", "Updated docs\n");
  f.put(
    "store-ports/example/savia-extension.json",
    JSON.stringify(manifest("2.0.0")),
  );
  const head = f.commit("store port update");

  const plan = classifyChanges({ base, head, repo: f.repo });
  assert.equal(plan.kind, "plugin");
  assert.equal(plan.plugins[0].directory, "store-ports/example");
});

test("known repository documentation may accompany an otherwise eligible plugin release", (t) => {
  const f = fixture(t);
  addPlugin(f);
  f.put("docs/guides/plugin.md", "Plugin guide\n");
  const base = f.commit("base");
  f.put(
    "packages/plugin-example/savia-extension.json",
    JSON.stringify(manifest("1.0.1")),
  );
  f.put(
    "packages/plugin-example/dossier-panel.tsx",
    "export const panel = true;\n",
  );
  f.put("docs/guides/plugin.md", "Updated plugin guide\n");
  const head = f.commit("plugin and guide update");

  const plan = classifyChanges({ base, head, repo: f.repo });
  assert.equal(plan.kind, "plugin");
  assert.equal(plan.flows, false);
  assert.equal(plan.plugins.length, 1);
});

test("documentation does not make infrastructure changes eligible for the plugin lane", (t) => {
  const f = fixture(t);
  addPlugin(f);
  f.put("docs/guides/plugin.md", "Plugin guide\n");
  const base = f.commit("base");
  f.put(
    "packages/plugin-example/savia-extension.json",
    JSON.stringify(manifest("1.0.1")),
  );
  f.put(
    "packages/plugin-example/dossier-panel.tsx",
    "export const panel = true;\n",
  );
  f.put("docs/guides/plugin.md", "Updated plugin guide\n");
  f.put("infra/deploy/config.yml", "changed: true\n");
  const head = f.commit("plugin, docs, and infrastructure update");

  const plan = classifyChanges({ base, head, repo: f.repo });
  assert.equal(plan.kind, "platform");
  assert.equal(plan.flows, true);
});

test("manifest metadata changes and missing version bumps fall back to platform", (t) => {
  const f = fixture(t);
  addPlugin(f);
  const base = f.commit("base");
  f.put(
    "packages/plugin-example/savia-extension.json",
    JSON.stringify(manifest("1.0.0", { apiVersion: 2 })),
  );
  const head = f.commit("manifest edit");

  const plan = classifyChanges({ base, head, repo: f.repo });
  assert.equal(plan.kind, "platform");
  assert.equal(plan.plugin_only, false);
  assert.match(plan.reasons.join(" "), /must increase its strict semver/);
});

test("manifest metadata changes remain platform work even with a valid version increase", (t) => {
  const f = fixture(t);
  addPlugin(f);
  const base = f.commit("base");
  f.put(
    "packages/plugin-example/savia-extension.json",
    JSON.stringify(manifest("1.0.1", { apiVersion: 2 })),
  );
  const head = f.commit("manifest metadata update");

  const plan = classifyChanges({ base, head, repo: f.repo });
  assert.equal(plan.kind, "platform");
  assert.match(plan.reasons.join(" "), /fields other than version changed/);
});

test("strict semver comparison preserves large numeric components", (t) => {
  const f = fixture(t);
  f.put(
    "packages/plugin-example/savia-extension.json",
    JSON.stringify(manifest("9007199254740992.0.0")),
  );
  f.put(
    "packages/plugin-example/store.json",
    JSON.stringify({ format: "savia.store", formatVersion: 1 }),
  );
  f.put(
    "packages/plugin-example/package.json",
    JSON.stringify({ name: "@savia/plugin-example" }),
  );
  f.put("packages/plugin-example/entry.tsx", "export {};\n");
  const base = f.commit("base");
  f.put(
    "packages/plugin-example/savia-extension.json",
    JSON.stringify(manifest("9007199254740993.0.0")),
  );
  f.put("packages/plugin-example/entry.tsx", "export const updated = true;\n");
  const head = f.commit("large version bump");

  const plan = classifyChanges({ base, head, repo: f.repo });
  assert.equal(plan.kind, "plugin");
  assert.equal(plan.plugins[0].version, "9007199254740993.0.0");
});

test("plugin IDs outside the publisher's accepted format fall back to platform", (t) => {
  const f = fixture(t);
  addPlugin(f);
  const base = f.commit("base");
  f.put(
    "packages/plugin-example/savia-extension.json",
    JSON.stringify(manifest("1.0.1", { id: "custom_bad-id" })),
  );
  const head = f.commit("invalid plugin ID");

  const plan = classifyChanges({ base, head, repo: f.repo });
  assert.equal(plan.kind, "platform");
});

test("store, package, and configuration changes are never fast-laned", (t) => {
  const f = fixture(t);
  addPlugin(f);
  const base = f.commit("base");
  f.put(
    "packages/plugin-example/store.json",
    JSON.stringify({ format: "savia.store", formatVersion: 1, changed: true }),
  );
  f.put(
    "packages/plugin-example/savia-extension.json",
    JSON.stringify(manifest("1.0.1")),
  );
  const head = f.commit("store edit");

  const plan = classifyChanges({ base, head, repo: f.repo });
  assert.equal(plan.kind, "platform");
  assert.equal(plan.flows, true);
  assert.match(plan.reasons.join(" "), /unsupported files/);
});

test("unknown namespaces, shared dependencies, and root dependency changes are conservative", (t) => {
  const f = fixture(t);
  addPlugin(f);
  const base = f.commit("base");
  f.put(
    "packages/plugin-example/savia-extension.json",
    JSON.stringify(manifest("1.0.1")),
  );
  f.put("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  const head = f.commit("root dependency change");
  const dependencyPlan = classifyChanges({ base, head, repo: f.repo });
  assert.equal(dependencyPlan.kind, "platform");
  assert.equal(dependencyPlan.flows, true);

  f.put("packages/insurance-example/source.ts", "export {};\n");
  const next = f.commit("unknown package namespace");
  const unknownPlan = classifyChanges({ head, base: head, repo: f.repo });
  assert.equal(unknownPlan.kind, "none");
  const changedUnknown = classifyChanges({
    base: head,
    head: next,
    repo: f.repo,
  });
  assert.equal(changedUnknown.kind, "platform");
  assert.equal(changedUnknown.flows, true);
});

test("unrelated admin changes are platform work without forcing flows", (t) => {
  const f = fixture(t);
  f.put("apps/admin/src/page.tsx", "export const page = true;\n");
  const base = f.commit("base");
  f.put("apps/admin/src/page.tsx", "export const page = false;\n");
  const head = f.commit("admin edit");

  const plan = classifyChanges({ base, head, repo: f.repo });
  assert.equal(plan.kind, "platform");
  assert.equal(plan.flows, false);
});

test("unknown runtime and infrastructure paths force Flows checks", (t) => {
  const f = fixture(t);
  f.put("apps/hook-executor/src/worker.ts", "export {};\n");
  const base = f.commit("base");
  f.put("apps/hook-executor/src/worker.ts", "export const changed = true;\n");
  f.put(".github/actions/custom/action.yml", "name: Custom\n");
  const head = f.commit("runtime and action update");

  const plan = classifyChanges({ base, head, repo: f.repo });
  assert.equal(plan.kind, "platform");
  assert.equal(plan.flows, true);
});

test("test-only plugin changes use platform checks without requiring a version bump", (t) => {
  const f = fixture(t);
  addPlugin(f);
  const base = f.commit("base");
  f.put("packages/plugin-example/test/example.test.ts", "// added test\n");
  const head = f.commit("test-only update");

  const plan = classifyChanges({ base, head, repo: f.repo });
  assert.equal(plan.kind, "platform");
  assert.equal(plan.flows, false);
  assert.equal(plan.plugin_only, false);
  assert.doesNotMatch(
    plan.reasons.join(" "),
    /must increase its strict semver/,
  );
});

test("path traversal shaped names are not accepted by the plugin source allowlist", (t) => {
  const f = fixture(t);
  addPlugin(f);
  const base = f.commit("base");
  f.put("packages/plugin-example/..hidden.ts", "export {};\n");
  f.put(
    "packages/plugin-example/savia-extension.json",
    JSON.stringify(manifest("1.0.1")),
  );
  const head = f.commit("unsafe path shape");

  const plan = classifyChanges({ base, head, repo: f.repo });
  assert.equal(plan.kind, "platform");
  assert.match(plan.reasons.join(" "), /unsupported files/);
});

test("pure docs changes are none and malformed or unavailable git input is full platform CI", (t) => {
  const f = fixture(t);
  f.put("docs/guide.md", "Guide\n");
  const base = f.commit("base");
  f.put("docs/guide.md", "Updated guide\n");
  const head = f.commit("docs change");

  const docsPlan = classifyChanges({ base, head, repo: f.repo });
  assert.equal(docsPlan.kind, "none");
  assert.equal(docsPlan.flows, false);
  const missingPlan = classifyChanges({ base: "missing", head, repo: f.repo });
  assert.equal(missingPlan.kind, "platform");
  assert.equal(missingPlan.flows, false);
  assert.equal(
    classifyChanges({ base: "", head, repo: f.repo }).kind,
    "platform",
  );
});
