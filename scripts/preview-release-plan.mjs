import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classifyChanges } from "./preview-change-plan.mjs";
import { loadComponentEvidence } from "./preview-component-evidence.mjs";

const shaPattern = /^[a-f0-9]{40}$/;
const COMPONENTS = {
  runtime: { artifact: "preview-runtime", job: "Deploy preview" },
  office: { artifact: "preview-office", job: "Publish Preview Office" },
  store: { artifact: "preview-store", job: "Publish Preview store plugins" },
};

const RUNTIME_IGNORED_PATHS = new Set([
  ".github/workflows/deploy-preview.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/codeql.yml",
  ".github/workflows/coverage.yml",
  "scripts/codeql-plan.mjs",
  "scripts/admin-test-sequencer.mjs",
  "scripts/admin-vitest.config.mts",
  "scripts/admin-test-durations.json",
  "scripts/contract-check-gate.mjs",
  "scripts/preview-release-plan.mjs",
  "scripts/preview-code-release.mjs",
  "scripts/preview-change-plan.mjs",
  "infra/pulumi/runtime-artifact-custody.mjs",
  "infra/pulumi/prepare-release.mjs",
  "infra/pulumi/runtime-bindings.mjs",
  "infra/pulumi/runtime-publisher-code-only.mjs",
  "infra/pulumi/environment-operations.mjs",
  "infra/pulumi/environment-cloud.mjs",
  "infra/pulumi/runtime-cloud.mjs",
  "infra/pulumi/runtime-timing.mjs",
  "scripts/preview-component-evidence.mjs",
  "scripts/deploy-store-plugins.mjs",
  "scripts/plugin-deployment/worker.ts",
  "apps/admin/office-runtime.json",
  "scripts/prepare-office-runtime.mjs",
  "scripts/package-office-runtime.mjs",
  "scripts/upload-office-runtime.mjs",
]);

function documentationOrTestPath(path) {
  return (
    path.startsWith("docs/") ||
    path.startsWith("documentation/") ||
    /(?:^|\/)(?:test|tests|__tests__)\//.test(path) ||
    /\.(?:test|spec)\.[^/]+$/.test(path)
  );
}

export function releaseAssetFlags(paths) {
  if (!Array.isArray(paths) || paths.some((path) => typeof path !== "string")) {
    return { officeRuntimeChanged: true, storePluginsChanged: true };
  }
  return {
    officeRuntimeChanged: paths.some(
      (path) =>
        path === "apps/admin/office-runtime.json" ||
        /^scripts\/(?:prepare|package|upload)-office-runtime\.mjs$/.test(path),
    ),
    storePluginsChanged: paths.some(
      (path) =>
        path.startsWith("deployment/plugins/") ||
        path.startsWith("store-ports/") ||
        /^scripts\/(?:deploy-store-plugins|pack-store-plugin|publish-store-plugins)\.mjs$/.test(
          path,
        ),
    ),
  };
}

export function releaseRuntimeChanged(paths) {
  if (!Array.isArray(paths) || paths.some((path) => typeof path !== "string"))
    return true;
  return paths.some(
    (path) =>
      !documentationOrTestPath(path) &&
      !RUNTIME_IGNORED_PATHS.has(path) &&
      !path.startsWith("deployment/plugins/") &&
      !path.startsWith("store-ports/"),
  );
}

function changedPaths({ base, head, repo = process.cwd() }) {
  try {
    return execFileSync(
      "git",
      ["diff", "--name-only", "-z", "--no-renames", base, head, "--"],
      { cwd: repo, encoding: "buffer", stdio: ["ignore", "pipe", "ignore"] },
    )
      .toString("utf8")
      .split("\0")
      .filter(Boolean);
  } catch {
    return null;
  }
}

export function selectPreviewBaseline(
  runs,
  { head, currentRunId, isAncestor },
) {
  for (const run of runs ?? []) {
    if (
      String(run.id) === String(currentRunId) ||
      run.event !== "workflow_run" ||
      run.head_branch !== "main" ||
      run.status !== "completed" ||
      run.conclusion !== "success" ||
      run.promotionVerified !== true ||
      !shaPattern.test(run.head_sha ?? "") ||
      run.head_sha === head
    )
      continue;
    try {
      if (isAncestor(run.head_sha, head)) return run.head_sha;
    } catch {
      /* Missing history is not proof of deployment. */
    }
  }
  return null;
}

export function selectComponentBaseline(
  runs,
  component,
  { head, currentRunId, isAncestor },
) {
  if (!COMPONENTS[component])
    throw new Error(`Unknown Preview component: ${component}`);
  let selected = null;
  for (const run of runs ?? []) {
    if (
      String(run.id) === String(currentRunId) ||
      run.event !== "workflow_run" ||
      run.head_branch !== "main" ||
      run.status !== "completed" ||
      !Array.isArray(run.verifiedComponents) ||
      !run.verifiedComponents.includes(component) ||
      !shaPattern.test(run.head_sha ?? "")
    )
      continue;
    try {
      if (
        isAncestor(run.head_sha, head) &&
        (!selected ||
          (selected !== run.head_sha && isAncestor(selected, run.head_sha)))
      )
        selected = run.head_sha;
    } catch {
      /* Missing history is not proof of deployment. */
    }
  }
  return selected;
}

export async function buildPreviewReleasePlan({
  head,
  currentRunId,
  runs,
  durableRuns = [],
  isAncestor,
  classify = classifyChanges,
  classifyAssets = releaseAssetFlags,
  repo = process.cwd(),
}) {
  if (!shaPattern.test(head ?? ""))
    throw new Error("An exact approved commit is required.");
  const evidence = [...durableRuns, ...(runs ?? [])];
  const base = selectComponentBaseline(evidence, "runtime", {
    head,
    currentRunId,
    isAncestor,
  });
  const officeRuntimeBase = selectComponentBaseline(evidence, "office", {
    head,
    currentRunId,
    isAncestor,
  });
  const storePluginsBase = selectComponentBaseline(evidence, "store", {
    head,
    currentRunId,
    isAncestor,
  });
  if (!base)
    return {
      kind: "platform",
      flows: true,
      plugins: [],
      plugin_only: false,
      reasons: ["No verified deployed ancestor; full release required."],
      base: null,
      officeRuntimeBase,
      storePluginsBase,
      head,
      runtimeChanged: true,
      officeRuntimeChanged: true,
      storePluginsChanged: true,
    };
  const plan = await classify({ base, head });
  const runtimePaths = changedPaths({ base, head, repo });
  const officePaths = officeRuntimeBase
    ? changedPaths({ base: officeRuntimeBase, head, repo })
    : null;
  const storePaths = storePluginsBase
    ? changedPaths({ base: storePluginsBase, head, repo })
    : null;
  return {
    ...plan,
    runtimeChanged: releaseRuntimeChanged(runtimePaths),
    officeRuntimeBase,
    storePluginsBase,
    officeRuntimeChanged: officeRuntimeBase
      ? classifyAssets(officePaths).officeRuntimeChanged
      : true,
    storePluginsChanged: storePluginsBase
      ? classifyAssets(storePaths).storePluginsChanged
      : true,
    base,
    head,
  };
}

export function hasPromotionEvidence(artifacts, run) {
  return (artifacts ?? []).some(
    (artifact) =>
      artifact.name === "preview-release" &&
      artifact.expired === false &&
      artifact.workflow_run?.head_sha === run.head_sha &&
      String(artifact.workflow_run?.id) === String(run.id) &&
      artifact.workflow_run?.head_branch === "main",
  );
}

export function hasComponentEvidence(artifacts, run, jobs, component) {
  const definition = COMPONENTS[component];
  if (!definition) throw new Error(`Unknown Preview component: ${component}`);
  const exactArtifact = (name) =>
    (artifacts ?? []).some(
      (artifact) =>
        artifact.name === name &&
        artifact.expired === false &&
        artifact.workflow_run?.head_sha === run.head_sha &&
        String(artifact.workflow_run?.id) === String(run.id) &&
        artifact.workflow_run?.head_branch === "main",
    );
  const successfulJob = (name) =>
    (jobs ?? []).some(
      (job) =>
        job.name === name &&
        job.status === "completed" &&
        job.conclusion === "success",
    );

  if (exactArtifact(definition.artifact) && successfulJob(definition.job))
    return true;

  if (
    exactArtifact("preview-release") &&
    successfulJob("Record complete Preview release")
  )
    return true;

  // Legacy full releases used one receipt from the core job after all
  // component steps had completed. Selective plugin receipts do not prove the
  // full release catalog was reconciled.
  if (exactArtifact("preview-release")) {
    if (successfulJob("Deploy preview")) return true;
  }

  if (
    (component === "runtime" || component === "office") &&
    exactArtifact(`preview-runtime-release-${run.id}`)
  ) {
    const coreJob = (jobs ?? []).find((job) => job.name === "Deploy preview");
    const requiredSteps = [
      "Reject superseded deployments",
      "Validate planned Flows settings and stable keys before mutation",
      "Verify isolated preview resources before any mutation",
      "Review the saved managed runtime plan",
      "Apply the exact managed runtime plan",
    ];
    if (component === "office")
      requiredSteps.push(
        "Prepare Office runtime assets",
        "Package Office runtime assets",
        "Upload Office runtime assets to preview R2",
      );
    const steps = new Map(
      (coreJob?.steps ?? []).map((step) => [step.name, step]),
    );
    return (
      coreJob?.status === "completed" &&
      requiredSteps.every((name) => steps.get(name)?.conclusion === "success")
    );
  }
  return false;
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const head = process.env.APPROVED_SHA;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? ""))
    throw new Error("A valid repository is required.");
  if (!process.env.GITHUB_TOKEN)
    throw new Error("GitHub read access is required.");
  const isAncestor = (base, target) => {
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", base, target], {
        stdio: "ignore",
      });
      return true;
    } catch {
      return false;
    }
  };
  // Durable evidence is independent of Actions retention. An API outage must
  // stop planning rather than accidentally select an expensive full release.
  const durableRuns = await loadComponentEvidence({
    repository,
    token: process.env.GITHUB_TOKEN,
    head,
    isAncestor,
  });
  const durableBases = Object.fromEntries(
    Object.keys(COMPONENTS).map((component) => [
      component,
      selectComponentBaseline(durableRuns, component, {
        head,
        currentRunId: process.env.GITHUB_RUN_ID,
        isAncestor,
      }),
    ]),
  );
  let runs = [];
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/actions/workflows/deploy-preview.yml/runs?status=completed&per_page=100`,
      {
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
        },
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
      },
    );
    if (!response.ok)
      throw new Error("Cannot inspect legacy Preview releases.");
    {
      runs = (await response.json()).workflow_runs;
      const verified = new Set();
      for (const run of runs ?? []) {
        if (
          run.event !== "workflow_run" ||
          run.head_branch !== "main" ||
          !shaPattern.test(run.head_sha ?? "") ||
          Object.values(durableBases).every(
            (base) =>
              base &&
              (base === run.head_sha || !isAncestor(base, run.head_sha)),
          )
        )
          continue;
        try {
          execFileSync(
            "git",
            ["merge-base", "--is-ancestor", run.head_sha, head],
            { stdio: "ignore" },
          );
          const [artifacts, jobs] = await Promise.all([
            githubCollection(
              `https://api.github.com/repos/${repository}/actions/runs/${run.id}/artifacts`,
              "artifacts",
            ),
            githubCollection(
              `https://api.github.com/repos/${repository}/actions/runs/${run.id}/jobs`,
              "jobs",
            ),
          ]);
          run.verifiedComponents = Object.keys(COMPONENTS).filter((component) =>
            hasComponentEvidence(artifacts, run, jobs, component),
          );
          for (const component of run.verifiedComponents)
            verified.add(component);
          if (verified.size === Object.keys(COMPONENTS).length) break;
        } catch {
          /* An unverified run cannot establish the release baseline. */
        }
      }
    }
  } catch {
    throw new Error(
      "Preview release history is unavailable; publication was not planned.",
    );
  }
  const plan = await buildPreviewReleasePlan({
    head,
    currentRunId: process.env.GITHUB_RUN_ID,
    runs,
    durableRuns,
    isAncestor,
  });
  writeFileSync(
    process.env.PREVIEW_PLAN_PATH ?? "preview-release-plan.json",
    JSON.stringify(plan, null, 2) + "\n",
  );
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `kind=${plan.kind}\nplugins=${JSON.stringify(plan.plugins)}\nbase=${plan.base ?? ""}\nruntime_changed=${plan.runtimeChanged}\noffice_runtime_base=${plan.officeRuntimeBase ?? ""}\nstore_plugins_base=${plan.storePluginsBase ?? ""}\noffice_runtime_changed=${plan.officeRuntimeChanged}\nstore_plugins_changed=${plan.storePluginsChanged}\n`,
    );
  console.log(
    `Preview release: ${plan.kind}; runtime ${plan.runtimeChanged ? "changed" : "current"}; ${plan.plugins.length} eligible plugin(s).`,
  );
}

async function githubCollection(url, key) {
  const values = [];
  for (let page = 1; page <= 10; page += 1) {
    const response = await fetch(`${url}?per_page=100&page=${page}`, {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
    if (!response.ok) throw new Error(`Cannot inspect Preview ${key}`);
    const body = await response.json();
    const pageValues = body[key];
    if (!Array.isArray(pageValues)) throw new Error(`Invalid Preview ${key}`);
    values.push(...pageValues);
    if (pageValues.length < 100) return values;
  }
  throw new Error(`Preview ${key} pagination exceeded its safety limit`);
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
