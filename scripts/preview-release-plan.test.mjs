import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  selectPreviewBaseline,
  selectComponentBaseline,
  buildPreviewReleasePlan,
  hasPromotionEvidence,
  hasComponentEvidence,
  releaseRuntimeChanged,
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
  verifiedComponents: ["runtime", "office", "store"],
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

test("durable receipts retain the deployed baseline after Actions history is deleted", async () => {
  let comparedBase;
  const plan = await buildPreviewReleasePlan({
    head,
    currentRunId: 3,
    runs: [],
    durableRuns: [run({ durable: true })],
    isAncestor: () => true,
    classify: ({ base }) => {
      comparedBase = base;
      return { kind: "none", plugins: [], flows: false };
    },
  });
  assert.equal(comparedBase, prior);
  assert.equal(plan.base, prior);
  assert.equal(plan.officeRuntimeBase, prior);
  assert.equal(plan.storePluginsBase, prior);
  assert.equal(plan.kind, "none");
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

test("component evidence is tied to its artifact, exact run, and successful job", () => {
  const artifacts = [
    {
      name: "preview-runtime",
      expired: false,
      workflow_run: { id: 1, head_sha: prior, head_branch: "main" },
    },
  ];
  const jobs = [
    { name: "Deploy preview", status: "completed", conclusion: "success" },
  ];
  assert.equal(hasComponentEvidence(artifacts, run(), jobs, "runtime"), true);
  assert.equal(hasComponentEvidence(artifacts, run(), jobs, "office"), false);
  assert.equal(
    hasComponentEvidence(
      artifacts,
      run(),
      [{ ...jobs[0], conclusion: "failure" }],
      "runtime",
    ),
    false,
  );
  assert.equal(
    hasComponentEvidence(
      [
        {
          ...artifacts[0],
          workflow_run: { ...artifacts[0].workflow_run, id: 9 },
        },
      ],
      run(),
      jobs,
      "runtime",
    ),
    false,
  );
});

test("legacy selective plugin evidence cannot establish a full component baseline", () => {
  const artifacts = [
    {
      name: "preview-release",
      expired: false,
      workflow_run: { id: 1, head_sha: prior, head_branch: "main" },
    },
  ];
  const jobs = [
    {
      name: "Publish changed Preview plugins",
      status: "completed",
      conclusion: "success",
    },
  ];
  assert.equal(hasComponentEvidence(artifacts, run(), jobs, "store"), false);
  assert.equal(hasComponentEvidence(artifacts, run(), jobs, "runtime"), false);
  assert.equal(hasComponentEvidence(artifacts, run(), jobs, "office"), false);
  assert.equal(
    hasComponentEvidence(
      artifacts,
      run(),
      [{ name: "Deploy preview", status: "completed", conclusion: "success" }],
      "runtime",
    ),
    true,
  );
  assert.equal(
    hasComponentEvidence(
      artifacts,
      run(),
      [
        {
          name: "Record complete Preview release",
          status: "completed",
          conclusion: "success",
        },
      ],
      "store",
    ),
    true,
  );
});

test("legacy runtime retry proof requires exact artifact and successful core steps", () => {
  const retryArtifact = {
    name: "preview-runtime-release-1",
    expired: false,
    workflow_run: { id: 1, head_sha: prior, head_branch: "main" },
  };
  const stepNames = [
    "Reject superseded deployments",
    "Validate planned Flows settings and stable keys before mutation",
    "Verify isolated preview resources before any mutation",
    "Review the saved managed runtime plan",
    "Apply the exact managed runtime plan",
  ];
  const failedAfterApply = [
    {
      name: "Deploy preview",
      status: "completed",
      conclusion: "failure",
      steps: stepNames.map((name) => ({ name, conclusion: "success" })),
    },
  ];
  assert.equal(
    hasComponentEvidence([retryArtifact], run(), failedAfterApply, "runtime"),
    true,
  );
  assert.equal(
    hasComponentEvidence(
      [retryArtifact],
      run(),
      [
        {
          ...failedAfterApply[0],
          steps: failedAfterApply[0].steps.map((step) =>
            step.name === "Apply the exact managed runtime plan"
              ? { ...step, conclusion: "failure" }
              : step,
          ),
        },
      ],
      "runtime",
    ),
    false,
  );
});

test("component baselines accept successful component proof on an overall failed run", () => {
  const failedRun = run({
    conclusion: "failure",
    verifiedComponents: ["runtime"],
  });
  assert.equal(
    selectComponentBaseline([failedRun], "runtime", {
      head,
      currentRunId: 3,
      isAncestor: () => true,
    }),
    prior,
  );
  assert.equal(
    selectComponentBaseline([failedRun], "store", {
      head,
      currentRunId: 3,
      isAncestor: () => true,
    }),
    null,
  );
});

test("a newer successful ancestor wins regardless of durable or legacy evidence order", () => {
  const newer = "c".repeat(40);
  const olderReceipt = run({ durable: true });
  const newerLegacy = run({ id: 2, head_sha: newer });
  for (const records of [
    [olderReceipt, newerLegacy],
    [newerLegacy, olderReceipt],
  ]) {
    assert.equal(
      selectComponentBaseline(records, "runtime", {
        head,
        currentRunId: 3,
        isAncestor: (base, target) =>
          target === head || (base === prior && target === newer),
      }),
      newer,
    );
  }
});

test("release planning keeps independent component baselines and pending assets", async () => {
  const repo = mkdtempSync(join(tmpdir(), "savia-component-plan-"));
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
  put("apps/api/src/index.ts", "export {}\n");
  put("apps/admin/office-runtime.json", '{"build":"1"}\n');
  put("deployment/plugins/sources.json", '{"ports":[]}\n');
  commit("base");
  put("apps/admin/office-runtime.json", '{"build":"2"}\n');
  const officeSha = commit("office released");
  put("deployment/plugins/sources.json", '{"ports":["example"]}\n');
  const storeSha = commit("store released");
  put("apps/api/src/index.ts", "export const runtime = 1\n");
  const runtimeSha = commit("runtime released");
  put("apps/admin/office-runtime.json", '{"build":"3"}\n');
  const head = commit("office pending");
  const currentHead = head;
  const cleanup = () => rmSync(repo, { recursive: true, force: true });
  const request = {};
  try {
    const plan = await buildPreviewReleasePlan({
      head: currentHead,
      currentRunId: 3,
      runs: [
        run({ head_sha: runtimeSha, verifiedComponents: ["runtime"] }),
        run({ id: 2, head_sha: officeSha, verifiedComponents: ["office"] }),
        run({ id: 4, head_sha: storeSha, verifiedComponents: ["store"] }),
      ],
      isAncestor: () => true,
      repo,
      classify: (value) => {
        request.base = value.base;
        return {
          kind: "platform",
          flows: true,
          plugins: [],
          plugin_only: false,
          reasons: [],
        };
      },
    });
    assert.equal(request.base, runtimeSha);
    assert.equal(plan.runtimeChanged, false);
    assert.equal(plan.officeRuntimeBase, officeSha);
    assert.equal(plan.storePluginsBase, storeSha);
    assert.equal(plan.officeRuntimeChanged, true);
    assert.equal(plan.storePluginsChanged, false);
    assert.equal(plan.base, runtimeSha);
  } finally {
    cleanup();
  }
});

test("workflow, tests, documentation, and known asset-only files do not require runtime deploy", () => {
  assert.equal(
    releaseRuntimeChanged([
      ".github/workflows/deploy-preview.yml",
      ".github/workflows/ci.yml",
      "scripts/contract-check-gate.mjs",
      "scripts/preview-release-plan.mjs",
      "scripts/preview-component-evidence.mjs",
      "infra/pulumi/environment-operations.mjs",
      "infra/pulumi/environment-cloud.mjs",
      "infra/pulumi/runtime-cloud.mjs",
      "infra/pulumi/runtime-timing.mjs",
      "scripts/deploy-store-plugins.mjs",
      "scripts/plugin-deployment/worker.ts",
      "docs/guides/deploy.md",
      "scripts/preview-release-plan.test.mjs",
      "apps/admin/office-runtime.json",
      "deployment/plugins/sources.json",
    ]),
    false,
  );
  assert.equal(
    releaseRuntimeChanged(["scripts/unknown-deploy-helper.mjs"]),
    true,
  );
  assert.equal(releaseRuntimeChanged(null), true);
  assert.equal(releaseRuntimeChanged(["infra/pulumi/worker-config.mjs"]), true);
});

test("legacy Office success survives a later plugin failure but incomplete uploads do not", () => {
  const artifacts = [
    {
      name: "preview-runtime-release-1",
      expired: false,
      workflow_run: { id: 1, head_sha: prior, head_branch: "main" },
    },
  ];
  const steps = [
    "Reject superseded deployments",
    "Validate planned Flows settings and stable keys before mutation",
    "Verify isolated preview resources before any mutation",
    "Review the saved managed runtime plan",
    "Apply the exact managed runtime plan",
    "Prepare Office runtime assets",
    "Package Office runtime assets",
    "Upload Office runtime assets to preview R2",
  ].map((name) => ({ name, conclusion: "success" }));
  const job = {
    name: "Deploy preview",
    status: "completed",
    conclusion: "failure",
    steps,
  };
  assert.equal(hasComponentEvidence(artifacts, run(), [job], "office"), true);
  assert.equal(
    hasComponentEvidence(
      artifacts,
      run(),
      [
        {
          ...job,
          steps: steps.map((s) =>
            s.name.startsWith("Upload Office")
              ? { ...s, conclusion: "failure" }
              : s,
          ),
        },
      ],
      "office",
    ),
    false,
  );
  assert.equal(hasComponentEvidence(artifacts, run(), [job], "store"), false);
});
