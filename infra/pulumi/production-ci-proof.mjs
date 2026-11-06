import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

export async function verifyProductionCi({
  env = process.env,
  run = promisify(execFile),
} = {}) {
  const repository = env.GITHUB_REPOSITORY,
    sha = env.GITHUB_SHA;
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repository ?? "") ||
    repository.split("/").some((p) => p === "." || p === "..") ||
    !/^[a-f\d]{40}$/.test(sha ?? "") ||
    env.GITHUB_REF !== "refs/heads/main" ||
    env.GITHUB_EVENT_NAME !== "workflow_dispatch"
  )
    throw new Error("Production CI proof requires a main manual deployment");
  try {
    const result = await run(
      "gh",
      [
        "api",
        `repos/${repository}/actions/workflows/ci.yml/runs`,
        "--method",
        "GET",
        "-f",
        `head_sha=${sha}`,
        "-f",
        "event=push",
        "-f",
        "per_page=100",
      ],
      { env, maxBuffer: 4 * 1024 * 1024 },
    );
    const payload = JSON.parse(result.stdout);
    const latest = payload.workflow_runs
      .filter(
        (r) =>
          Number.isSafeInteger(r.id) &&
          r.id > 0 &&
          [
            ".github/workflows/ci.yml",
            ".github/workflows/ci.yml@main",
          ].includes(r.path) &&
          r.event === "push" &&
          r.head_sha === sha &&
          r.head_branch === "main" &&
          r.repository?.full_name === repository &&
          r.head_repository?.full_name === repository,
      )
      .sort((a, b) => b.id - a.id)[0];
    if (
      !latest ||
      latest.status !== "completed" ||
      latest.conclusion !== "success"
    )
      throw new Error();
    return { runId: latest.id, sha };
  } catch {
    throw new Error(
      "Successful latest trusted main CI evidence is required for this exact source",
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  verifyProductionCi()
    .then((proof) =>
      console.log(
        `Verified trusted main CI run ${proof.runId} for ${proof.sha}.`,
      ),
    )
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
