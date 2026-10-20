import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  selectPreviewBaseline,
  buildPreviewReleasePlan,
  hasPromotionEvidence,
  releaseAssetFlags,
} from "./preview-release-plan.mjs";

const head = "b".repeat(40),
  prior = "a".repeat(40);
const run = (extra = {}) => ({
  id: 1,
  event: "workflow_run",
  head_branch: "main",
  head_sha: prior,
  status: "completed",
  conclusion: "success",
  promotionVerified: true,
  ...extra,
});

test("selects a successful verified ancestor rather than the previous commit", () => {
  const seen = [];
  assert.equal(
    selectPreviewBaseline([run({ id: 2, conclusion: "failure" }), run()], {
      head,
      currentRunId: 3,
      isAncestor: (sha) => {
        seen.push(sha);
        return sha === prior;
      },
    }),
    prior,
  );
  assert.deepEqual(seen, [prior]);
});
test("ignores current, foreign branch, invalid and non-ancestor runs", () => {
  assert.equal(
    selectPreviewBaseline(
      [
        run({ id: 3 }),
        run({ head_branch: "other" }),
        run({ head_sha: "--unsafe" }),
        run({ head_sha: "c".repeat(40) }),
      ],
      { head, currentRunId: 3, isAncestor: () => false },
    ),
    null,
  );
});
test("missing deployment history or unavailable history uses full release", async () => {
  for (const runs of [[], null]) {
    const classify = () => {
      throw Error("must not classify against HEAD^");
    };
    const plan = await buildPreviewReleasePlan({
      head,
      currentRunId: 3,
      runs,
      isAncestor: () => true,
      classify,
    });
    assert.equal(plan.kind, "platform");
    assert.equal(plan.flows, true);
    assert.equal(plan.base, null);
    assert.equal(plan.officeRuntimeChanged, true);
    assert.equal(plan.storePluginsChanged, true);
  }
});

test("release asset flags identify Office and store plugin changes independently", () => {
  assert.deepEqual(releaseAssetFlags(["apps/auth/src/index.ts"]), {
    officeRuntimeChanged: false,
    storePluginsChanged: false,
  });
  assert.deepEqual(releaseAssetFlags(["apps/admin/office-runtime.json"]), {
    officeRuntimeChanged: true,
    storePluginsChanged: false,
  });
  assert.deepEqual(releaseAssetFlags(["deployment/plugins/sources.json"]), {
    officeRuntimeChanged: false,
    storePluginsChanged: true,
  });
  assert.deepEqual(releaseAssetFlags(null), {
    officeRuntimeChanged: true,
    storePluginsChanged: true,
  });
});

test("release assets compare cumulatively with the verified deployed baseline", async (t) => {
  const repo = mkdtempSync(join(tmpdir(), "savia-release-assets-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  const put = (path, value) => {
    const fullPath = join(repo, path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, value);
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
  put("apps/auth/src/index.ts", "export {}\n");
  const deployed = commit("deployed baseline");
  put("apps/admin/office-runtime.json", "{}\n");
  commit("office update");
  put("apps/auth/src/index.ts", "export const update = true\n");
  const head = commit("auth update");

  const plan = await buildPreviewReleasePlan({
    head,
    currentRunId: 3,
    runs: [run({ head_sha: deployed })],
    isAncestor: () => true,
    repo,
    classify: () => ({
      kind: "platform",
      flows: false,
      plugins: [],
      plugin_only: false,
      reasons: [],
    }),
  });
  assert.equal(plan.officeRuntimeChanged, true);
  assert.equal(plan.storePluginsChanged, false);
});
test("compares against the last deployed ancestor including undeployed core changes", async () => {
  let request;
  const plan = await buildPreviewReleasePlan({
    head,
    currentRunId: 3,
    runs: [run()],
    isAncestor: () => true,
    classify: (value) => {
      request = value;
      return {
        kind: "platform",
        flows: true,
        plugins: [],
        plugin_only: false,
        reasons: ["undeployed core"],
      };
    },
  });
  assert.deepEqual(request, { base: prior, head });
  assert.equal(plan.base, prior);
  assert.equal(plan.kind, "platform");
});
test("retains a plugin plan and exact approved commit", async () => {
  const plugins = [
    {
      directory: "packages/plugin-example",
      id: "custom.example",
      version: "1.0.1",
      previousVersion: "1.0.0",
    },
  ];
  const plan = await buildPreviewReleasePlan({
    head,
    currentRunId: 3,
    runs: [run()],
    isAncestor: () => true,
    classify: () => ({
      kind: "plugin",
      flows: false,
      plugins,
      plugin_only: true,
      reasons: [],
    }),
  });
  assert.equal(plan.kind, "plugin");
  assert.equal(plan.head, head);
  assert.deepEqual(plan.plugins, plugins);
});

test("successful runs without promotion evidence cannot advance the baseline", () => {
  assert.equal(
    selectPreviewBaseline([run({ promotionVerified: false })], {
      head,
      currentRunId: 3,
      isAncestor: () => true,
    }),
    null,
  );
});
test("promotion evidence must be unexpired and belong to the exact main run", () => {
  const artifact = {
    name: "preview-release",
    expired: false,
    workflow_run: { id: 1, head_sha: prior, head_branch: "main" },
  };
  assert.equal(hasPromotionEvidence([artifact], run()), true);
  for (const invalid of [
    { ...artifact, expired: true },
    { ...artifact, name: "other" },
    { ...artifact, workflow_run: { ...artifact.workflow_run, id: 2 } },
    { ...artifact, workflow_run: { ...artifact.workflow_run, head_sha: head } },
    {
      ...artifact,
      workflow_run: { ...artifact.workflow_run, head_branch: "other" },
    },
  ])
    assert.equal(hasPromotionEvidence([invalid], run()), false);
});
