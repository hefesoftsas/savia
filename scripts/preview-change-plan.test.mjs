import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { classifyChanges, classifyCiChanges } from "./preview-change-plan.mjs";

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

test("CI classification isolates only infrastructure and documentation changes", (t) => {
  const f = fixture(t);
  f.put("infra/pulumi/project.ts", "export const value = 1;\n");
  f.put("docs/guide.md", "Guide\n");
  const base = f.commit("base");

  const scenarios = [
    ["infra/pulumi/project.ts", "export const value = 2;\n", "infrastructure"],
    ["infra/pulumi/project.test.mjs", "// changed test\n", "infrastructure"],
    ["docs/guide.md", "Updated guide\n", "none"],
    ["apps/admin/src/page.tsx", "export const page = true;\n", "full"],
    ["package.json", "{}\n", "full"],
    ["pnpm-lock.yaml", "lockfileVersion: '9.0'\n", "full"],
    ["packages/shared/src/index.ts", "export {};\n", "full"],
    ["unknown/file.txt", "unknown\n", "full"],
    [".github/workflows/ci.yml", "name: changed\n", "full"],
    ["scripts/preview-change-plan.mjs", "// changed classifier\n", "full"],
  ];

  let scenarioBase = base;
  for (const [path, content, expected] of scenarios) {
    f.put(path, content);
    const head = f.commit(`change ${path}`);
    assert.equal(
      classifyCiChanges({ base: scenarioBase, head, repo: f.repo }).kind,
      expected,
      `${path} should classify as ${expected}`,
    );
    scenarioBase = head;
  }

  f.put("infra/pulumi/project.ts", "export const value = 3;\n");
  f.put("docs/guide.md", "Infra guide update\n");
  let head = f.commit("infrastructure and docs");
  assert.equal(
    classifyCiChanges({ base: scenarioBase, head, repo: f.repo }).kind,
    "infrastructure",
  );

  const mixedBase = head;
  f.put("infra/pulumi/project.ts", "export const value = 4;\n");
  f.put("apps/admin/src/page.tsx", "export const page = false;\n");
  head = f.commit("mixed infrastructure and application");
  assert.equal(
    classifyCiChanges({ base: mixedBase, head, repo: f.repo }).kind,
    "full",
  );

  const unavailable = classifyCiChanges({
    base: "missing",
    head,
    repo: f.repo,
  });
  assert.equal(unavailable.kind, "full");
  assert.equal(unavailable.flows, true);
});

test("the CI command-line mode emits separate outputs and leaves default classification intact", (t) => {
  const f = fixture(t);
  f.put("infra/pulumi/project.ts", "export const value = 1;\n");
  const base = f.commit("base");
  f.put("infra/pulumi/project.ts", "export const value = 2;\n");
  const head = f.commit("infra update");

  const script = fileURLToPath(
    new URL("./preview-change-plan.mjs", import.meta.url),
  );
  const ciOutput = execFileSync(
    process.execPath,
    [script, "--ci", "--base", base, "--head", head, "--repo", f.repo],
    { encoding: "utf8" },
  );
  assert.match(ciOutput, /^ci_kind=infrastructure$/m);
  assert.match(ciOutput, /^ci_flows=false$/m);

  const releaseOutput = execFileSync(
    process.execPath,
    [script, "--base", base, "--head", head, "--repo", f.repo],
    { encoding: "utf8" },
  );
  assert.match(releaseOutput, /^kind=platform$/m);
  assert.doesNotMatch(releaseOutput, /^ci_kind=/m);
});

test("the actual CI workflow falls back when trusted CI output is unsupported or inconsistent", (t) => {
  const ci = readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const step = ci.slice(
    ci.indexOf("      - name: Classify changes with trusted base code"),
    ci.indexOf("\n  plugin-validation:"),
  );
  const run = step.slice(
    step.indexOf("        run: |\n") + "        run: |\n".length,
  );
  const workflowRunBlock = run
    .split("\n")
    .map((line) => (line.startsWith("          ") ? line.slice(10) : line))
    .join("\n");
  const scenarios = [
    ["reject", null],
    ["ignore", null],
    ["partial", "ci_kind=infrastructure\n"],
    ["malformed", "ci_kind=other\nci_flows=false\n"],
    ["inconsistent", "ci_kind=full\nci_flows=false\n"],
    ["valid-full", "ci_kind=full\nci_flows=true\n"],
    ["valid-infrastructure", "ci_kind=infrastructure\nci_flows=false\n"],
  ];

  for (const [mode, ciOutput] of scenarios) {
    const f = fixture(t);
    f.put(
      "scripts/preview-change-plan.mjs",
      `import { appendFileSync } from "node:fs";\n` +
        `if (process.argv.includes("--ci")) {\n` +
        `  if (process.env.CI_MODE === "reject") process.exit(1);\n` +
        `  if (process.env.CI_MODE === "ignore") process.exit(0);\n` +
        `  const ciOutput = process.argv[process.argv.indexOf("--output") + 1];\n` +
        `  appendFileSync(ciOutput, ${JSON.stringify(ciOutput ?? "")});\n` +
        `} else {\n` +
        `  const output = process.argv[process.argv.indexOf("--output") + 1];\n` +
        `  appendFileSync(output, "kind=platform\\nflows=false\\nplugins=[]\\nplugin_only=false\\n");\n` +
        `}\n`,
    );
    const base = f.commit("legacy classifier base");
    f.put("apps/admin/src/page.tsx", "export const changed = true;\n");
    const head = f.commit("application change");
    const output = join(f.repo, "github-output");
    const runnerTemp = join(f.repo, "runner-temp");
    mkdirSync(runnerTemp);

    execFileSync("bash", ["-c", workflowRunBlock], {
      cwd: f.repo,
      env: {
        ...process.env,
        CI_MODE: mode,
        EVENT_NAME: "pull_request",
        PR_BASE_SHA: base,
        PUSH_BEFORE_SHA: "",
        HEAD_SHA: head,
        GITHUB_OUTPUT: output,
        RUNNER_TEMP: runnerTemp,
      },
    });

    const result = readFileSync(output, "utf8");
    assert.match(result, /^kind=platform$/m, mode);
    if (mode.startsWith("valid-")) {
      assert.match(result, new RegExp(`^ci_kind=${mode.slice(6)}$`, "m"));
      assert.match(result, /^ci_flows=(?:true|false)$/m);
    } else {
      assert.match(result, /^ci_kind=full$/m, mode);
      assert.match(result, /^ci_flows=true$/m, mode);
    }
  }
});

test("the release-facing classifier keeps infrastructure classified as platform", (t) => {
  const f = fixture(t);
  f.put("infra/pulumi/project.ts", "export const value = 1;\n");
  const base = f.commit("base");
  f.put("infra/pulumi/project.ts", "export const value = 2;\n");
  const head = f.commit("infra update");

  assert.equal(classifyChanges({ base, head, repo: f.repo }).kind, "platform");
  assert.equal(
    classifyCiChanges({ base, head, repo: f.repo }).kind,
    "infrastructure",
  );
});

test("CI routes infrastructure contracts through the existing required gate", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const contracts = workflow.slice(
    workflow.indexOf("  contracts:"),
    workflow.indexOf("  typecheck:"),
  );

  assert.match(workflow, /node "\$trusted_script" --ci --base/);
  assert.match(workflow, /echo 'ci_kind=full'/);
  assert.match(contracts, /needs:\n\s+- changes\n\s+- plugin-validation/);
  assert.match(contracts, /run: pnpm run test:contracts/);
  assert.match(
    contracts,
    /Run offline Flows recovery contracts for infrastructure changes/,
  );
  assert.match(
    contracts,
    /if: needs\.changes\.outputs\.ci_kind == 'infrastructure'/,
  );
  assert.match(contracts, /scripts\/flows-maintenance\/\*\.test\.mjs/);
  assert.match(workflow, /ci_flows == 'true'/);
  assert.doesNotMatch(
    workflow,
    /runs: pnpm run test:unit:workspace|typecheck:plugins && pnpm run typecheck:companion/,
  );
});
