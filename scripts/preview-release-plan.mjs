import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classifyChanges } from "./preview-change-plan.mjs";

const shaPattern = /^[a-f0-9]{40}$/;

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

export async function buildPreviewReleasePlan({
  head,
  currentRunId,
  runs,
  isAncestor,
  classify = classifyChanges,
  classifyAssets = releaseAssetFlags,
  repo = process.cwd(),
}) {
  if (!shaPattern.test(head ?? ""))
    throw new Error("An exact approved commit is required.");
  const base = selectPreviewBaseline(runs, { head, currentRunId, isAncestor });
  if (!base)
    return {
      kind: "platform",
      flows: true,
      plugins: [],
      plugin_only: false,
      reasons: ["No verified deployed ancestor; full release required."],
      base: null,
      head,
      officeRuntimeChanged: true,
      storePluginsChanged: true,
    };
  const plan = await classify({ base, head });
  return {
    ...plan,
    ...classifyAssets(changedPaths({ base, head, repo })),
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

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const head = process.env.APPROVED_SHA;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? ""))
    throw new Error("A valid repository is required.");
  if (!process.env.GITHUB_TOKEN)
    throw new Error("GitHub read access is required.");
  let runs = null;
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/actions/workflows/deploy-preview.yml/runs?status=success&per_page=100`,
      {
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
        },
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
      },
    );
    if (response.ok) {
      runs = (await response.json()).workflow_runs;
      for (const run of runs ?? []) {
        if (
          run.event !== "workflow_run" ||
          run.head_branch !== "main" ||
          run.head_sha === head ||
          !shaPattern.test(run.head_sha ?? "")
        )
          continue;
        try {
          execFileSync(
            "git",
            ["merge-base", "--is-ancestor", run.head_sha, head],
            { stdio: "ignore" },
          );
          const proof = await fetch(
            `https://api.github.com/repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`,
            {
              headers: {
                Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
                Accept: "application/vnd.github+json",
              },
              signal: AbortSignal.timeout(30_000),
              redirect: "error",
            },
          );
          if (
            proof.ok &&
            hasPromotionEvidence((await proof.json()).artifacts, run)
          ) {
            run.promotionVerified = true;
            break;
          }
        } catch {
          /* An unverified run cannot establish the release baseline. */
        }
      }
    }
  } catch {
    /* A full release is the safe fallback. */
  }
  const plan = await buildPreviewReleasePlan({
    head,
    currentRunId: process.env.GITHUB_RUN_ID,
    runs,
    isAncestor: (base, target) => {
      execFileSync("git", ["merge-base", "--is-ancestor", base, target], {
        stdio: "ignore",
      });
      return true;
    },
  });
  writeFileSync(
    process.env.PREVIEW_PLAN_PATH ?? "preview-release-plan.json",
    JSON.stringify(plan, null, 2) + "\n",
  );
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `kind=${plan.kind}\nplugins=${JSON.stringify(plan.plugins)}\nbase=${plan.base ?? ""}\noffice_runtime_changed=${plan.officeRuntimeChanged}\nstore_plugins_changed=${plan.storePluginsChanged}\n`,
    );
  console.log(
    `Preview release: ${plan.kind}; ${plan.plugins.length} eligible plugin(s).`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
