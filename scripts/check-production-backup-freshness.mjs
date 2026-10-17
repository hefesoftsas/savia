import { appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_MAX_AGE_MS = 36 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RUNS_TO_INSPECT = 100;

function apiHeaders(token) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2022-11-28",
  };
}

async function githubJson(url, { token, fetchImpl }) {
  const response = await fetchImpl(url, {
    headers: apiHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("GitHub Actions API request failed");
  return response.json();
}

async function appendFailureSummary(summaryPath) {
  if (!summaryPath) return;
  await appendFile(
    summaryPath,
    "## Production backup freshness check failed\nCould not verify retained backup status from GitHub Actions.\n",
    { mode: 0o600 },
  );
}

export async function checkProductionBackupFreshness({
  repository,
  token,
  apiUrl = "https://api.github.com",
  now = new Date(),
  maxAgeMs = DEFAULT_MAX_AGE_MS,
  fetchImpl = fetch,
  summaryPath = process.env.GITHUB_STEP_SUMMARY,
}) {
  if (!/^[^/]+\/[^/]+$/.test(repository ?? "") || !token)
    throw new Error(
      "Repository and GitHub token are required for freshness checks",
    );
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0)
    throw new Error("Backup freshness threshold must be positive");
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw new Error("Backup freshness check time is invalid");

  const base = `${apiUrl.replace(/\/$/, "")}/repos/${repository}`;
  const runsUrl = new URL(
    `${base}/actions/workflows/backup-production.yml/runs`,
  );
  runsUrl.searchParams.set("branch", "main");
  runsUrl.searchParams.set("per_page", String(MAX_RUNS_TO_INSPECT));
  const payload = await githubJson(runsUrl, { token, fetchImpl });
  if (!Array.isArray(payload.workflow_runs))
    throw new Error("GitHub Actions returned an invalid workflow run list");

  const candidates = payload.workflow_runs
    .filter(
      (run) =>
        run?.head_branch === "main" &&
        run?.conclusion === "success" &&
        Number.isSafeInteger(run?.id) &&
        run.id > 0 &&
        Number.isFinite(Date.parse(run?.updated_at)),
    )
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));

  let newest = null;
  for (let index = 0; index < candidates.length; index += 1) {
    const run = candidates[index];
    const artifactsPayload = await githubJson(
      `${base}/actions/runs/${run.id}/artifacts?per_page=100`,
      { token, fetchImpl },
    );
    if (!Array.isArray(artifactsPayload.artifacts))
      throw new Error("GitHub Actions returned an invalid artifact list");
    const artifacts = artifactsPayload.artifacts.filter(
      (artifact) =>
        typeof artifact?.name === "string" &&
        new RegExp(`^production-backup-${run.id}-[1-9]\\d*$`).test(
          artifact.name,
        ) &&
        artifact.expired === false &&
        Number.isSafeInteger(artifact.size_in_bytes) &&
        artifact.size_in_bytes > 0 &&
        Number.isFinite(Date.parse(artifact.created_at)) &&
        Date.parse(artifact.created_at) <= now.getTime() &&
        Number.isFinite(Date.parse(artifact.expires_at)) &&
        Date.parse(artifact.expires_at) > now.getTime(),
    );
    for (const artifact of artifacts) {
      if (
        !newest ||
        Date.parse(artifact.created_at) > Date.parse(newest.createdAt)
      ) {
        newest = {
          createdAt: artifact.created_at,
          runId: run.id,
          artifactId: artifact.id,
        };
      }
    }
    const nextRun = candidates[index + 1];
    if (
      newest &&
      (!nextRun ||
        Date.parse(newest.createdAt) >= Date.parse(nextRun.updated_at))
    ) {
      break;
    }
  }

  const ageMs = newest ? now.getTime() - Date.parse(newest.createdAt) : null;
  const fresh = ageMs !== null && ageMs <= maxAgeMs;
  const hours = ageMs === null ? null : Math.max(0, ageMs / (60 * 60 * 1000));
  const lines = fresh
    ? [
        "## Production backup freshness",
        `Latest retained successful production backup is ${hours.toFixed(1)} hours old (run ${newest.runId}).`,
      ]
    : [
        "## Production backup freshness check failed",
        newest
          ? `Latest retained successful production backup is ${hours.toFixed(1)} hours old; the limit is 36 hours.`
          : "No nonexpired encrypted production backup artifact is attached to a successful main-branch backup run.",
      ];
  if (summaryPath)
    await appendFile(summaryPath, `${lines.join("\n")}\n`, { mode: 0o600 });
  return { fresh, newest, ageMs };
}

export async function runFreshnessCheck(options) {
  try {
    return await checkProductionBackupFreshness(options);
  } catch {
    await appendFailureSummary(
      options?.summaryPath ?? process.env.GITHUB_STEP_SUMMARY,
    ).catch(() => {});
    throw new Error("Production backup freshness could not be verified");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runFreshnessCheck({
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GITHUB_TOKEN,
    apiUrl: process.env.GITHUB_API_URL,
  })
    .then(({ fresh }) => {
      if (!fresh) process.exitCode = 1;
    })
    .catch(() => {
      process.stderr.write(
        "Production backup freshness could not be verified.\n",
      );
      process.exitCode = 1;
    });
}
