import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const COMPONENTS = ["runtime", "office", "store"];
const RELEASE_COMPONENTS = [...COMPONENTS];
const WORKFLOW = ".github/workflows/deploy-preview.yml";
const API = "https://api.github.com";
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const RUN_ID_PATTERN = /^[1-9][0-9]*$/;
const PAYLOAD_KEYS = [
  "schemaVersion",
  "repository",
  "environment",
  "branch",
  "sha",
  "component",
  "workflow",
  "runId",
  "runAttempt",
].sort();

function assertRepository(repository) {
  if (typeof repository !== "string" || !REPOSITORY_PATTERN.test(repository))
    throw new Error("A valid GitHub repository is required.");
}

function assertSha(sha) {
  if (typeof sha !== "string" || !SHA_PATTERN.test(sha))
    throw new Error("An exact commit SHA is required.");
}

function assertRunId(runId) {
  if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId))
    throw new Error("A valid workflow run ID is required.");
}

function assertToken(token) {
  if (typeof token !== "string" || token.length === 0)
    throw new Error("A GitHub token is required.");
}

function apiUrl(repository, path) {
  return `${API}/repos/${repository.split("/").map(encodeURIComponent).join("/")}${path}`;
}

function headers(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function requestJson(
  fetchImpl,
  url,
  token,
  { method = "GET", body } = {},
) {
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: {
        ...headers(token),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error("GitHub API request failed.");
  }
  if (!response?.ok)
    throw new Error(
      `GitHub API request failed (HTTP ${response?.status ?? "unknown"}).`,
    );
  try {
    return await response.json();
  } catch {
    throw new Error("GitHub API returned invalid JSON.");
  }
}

function payloadFor({ repository, sha, component, runId, runAttempt }) {
  return {
    schemaVersion: 1,
    repository,
    environment: "preview",
    branch: "main",
    sha,
    component,
    workflow: WORKFLOW,
    runId,
    runAttempt,
  };
}

export async function recordComponentEvidence({
  repository,
  token,
  sha,
  component,
  runId,
  runAttempt,
  fetchImpl = fetch,
}) {
  assertRepository(repository);
  assertToken(token);
  assertSha(sha);
  assertRunId(runId);
  if (![...COMPONENTS, "release"].includes(component))
    throw new Error("A valid Preview component is required.");
  if (!Number.isSafeInteger(runAttempt) || runAttempt < 1)
    throw new Error("A positive workflow run attempt is required.");

  const created = await requestJson(
    fetchImpl,
    apiUrl(repository, "/deployments"),
    token,
    {
      method: "POST",
      body: {
        ref: sha,
        auto_merge: false,
        required_contexts: [],
        environment: "preview",
        transient_environment: false,
        production_environment: false,
        task: `savia:preview:component:${component}`,
        payload: payloadFor({ repository, sha, component, runId, runAttempt }),
      },
    },
  );
  if (
    !created ||
    !Number.isSafeInteger(Number(created.id)) ||
    Number(created.id) < 1 ||
    created.sha !== sha ||
    created.ref !== sha
  )
    throw new Error("GitHub did not confirm the exact-SHA deployment receipt.");

  await requestJson(
    fetchImpl,
    apiUrl(repository, `/deployments/${created.id}/statuses`),
    token,
    {
      method: "POST",
      body: {
        state: "success",
        auto_inactive: false,
        log_url: `https://github.com/${repository}/actions/runs/${runId}`,
      },
    },
  );
  return { id: created.id, sha, component, runId };
}

function isRepositoryUrlFor(repository, value) {
  if (value === undefined || value === null) return true;
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.hostname === "api.github.com" &&
      url.pathname.replace(/\/$/, "") === `/repos/${repository}`
    );
  } catch {
    return false;
  }
}

function validReceipt(deployment, repository, component) {
  if (!deployment || typeof deployment !== "object") return false;
  const payload = deployment.payload;
  const receiptComponent =
    deployment.task === "savia:preview:component:release"
      ? "release"
      : component;
  if (
    deployment.environment !== "preview" ||
    ![component, "release"].includes(receiptComponent) ||
    deployment.task !== `savia:preview:component:${receiptComponent}` ||
    !Number.isSafeInteger(Number(deployment.id)) ||
    Number(deployment.id) < 1 ||
    !isRepositoryUrlFor(repository, deployment.repository_url)
  )
    return false;
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    JSON.stringify(Object.keys(payload).sort()) !==
      JSON.stringify(PAYLOAD_KEYS) ||
    payload.schemaVersion !== 1 ||
    payload.repository !== repository ||
    payload.environment !== "preview" ||
    payload.branch !== "main" ||
    payload.component !== receiptComponent ||
    payload.workflow !== WORKFLOW ||
    typeof payload.runAttempt !== "number" ||
    !Number.isSafeInteger(payload.runAttempt) ||
    payload.runAttempt < 1
  )
    return false;
  try {
    assertSha(payload.sha);
    assertRunId(payload.runId);
  } catch {
    return false;
  }
  return deployment.sha === payload.sha && deployment.ref === payload.sha;
}

async function findTaskReceipt({
  repository,
  token,
  taskComponent,
  head,
  isAncestor,
  fetchImpl,
  statusCache,
}) {
  const task = `savia:preview:component:${taskComponent}`;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = new URL(apiUrl(repository, "/deployments"));
    url.searchParams.set("environment", "preview");
    url.searchParams.set("task", task);
    url.searchParams.set("per_page", String(PAGE_SIZE));
    url.searchParams.set("page", String(page));
    const batch = await requestJson(fetchImpl, url, token);
    if (!Array.isArray(batch))
      throw new Error("GitHub returned invalid deployment data.");
    for (const deployment of newestFirst(batch)) {
      if (
        deployment?.task !== task ||
        !validReceipt(deployment, repository, taskComponent)
      )
        continue;
      let succeeded = statusCache.get(String(deployment.id));
      if (!succeeded) {
        succeeded = succeededOrInactivated({
          repository,
          token,
          deployment,
          fetchImpl,
        });
        statusCache.set(String(deployment.id), succeeded);
      }
      if (!(await succeeded)) continue;
      let ancestor = false;
      try {
        ancestor = Boolean(isAncestor(deployment.sha, head));
      } catch {
        ancestor = false;
      }
      if (ancestor) return deployment;
    }
    if (batch.length < PAGE_SIZE) return null;
    if (page === MAX_PAGES)
      throw new Error(
        "GitHub deployment history exceeded the safety page limit.",
      );
  }
  return null;
}

function newestFirst(items) {
  return [...items].sort((a, b) => {
    const timeA = Date.parse(a.created_at ?? "") || 0;
    const timeB = Date.parse(b.created_at ?? "") || 0;
    return timeB - timeA || Number(b.id) - Number(a.id);
  });
}

async function succeededOrInactivated({
  repository,
  token,
  deployment,
  fetchImpl,
}) {
  const statuses = await requestJson(
    fetchImpl,
    apiUrl(repository, `/deployments/${deployment.id}/statuses?per_page=100`),
    token,
  );
  if (!Array.isArray(statuses))
    throw new Error("GitHub returned invalid deployment status data.");
  const ordered = [...statuses].sort(
    (a, b) =>
      (Date.parse(b?.created_at ?? "") || 0) -
      (Date.parse(a?.created_at ?? "") || 0),
  );
  if (ordered[0]?.state === "success") return true;
  if (ordered[0]?.state !== "inactive") return false;
  for (const status of ordered.slice(1)) {
    if (status?.state === "inactive") continue;
    return status?.state === "success";
  }
  return false;
}

export async function loadComponentEvidence({
  repository,
  token,
  head,
  isAncestor,
  fetchImpl = fetch,
}) {
  assertRepository(repository);
  assertToken(token);
  assertSha(head);
  if (typeof isAncestor !== "function")
    throw new Error("A commit ancestry check is required.");

  const statusCache = new Map();
  const taskReceipts = await Promise.all(
    [...COMPONENTS, "release"].map((taskComponent) =>
      findTaskReceipt({
        repository,
        token,
        taskComponent,
        head,
        isAncestor,
        fetchImpl,
        statusCache,
      }),
    ),
  );
  const [runtime, office, store, release] = taskReceipts;
  const byComponent = new Map([
    ["runtime", newestFirst([runtime, release].filter(Boolean))[0]],
    ["office", newestFirst([office, release].filter(Boolean))[0]],
    ["store", newestFirst([store, release].filter(Boolean))[0]],
  ]);
  const selected = new Map();
  for (const [component, deployment] of byComponent) {
    if (!deployment) continue;
    const key = `${deployment.payload.runId}:${deployment.sha}`;
    let run = selected.get(key);
    if (!run) {
      run = {
        id: deployment.payload.runId,
        event: "workflow_run",
        head_branch: "main",
        head_sha: deployment.sha,
        status: "completed",
        verifiedComponents: [],
        durable: true,
        _createdAt: deployment.created_at ?? "",
        _deploymentId: Number(deployment.id),
      };
      selected.set(key, run);
    }
    run.verifiedComponents.push(component);
  }
  return [...selected.values()]
    .map(({ _createdAt, _deploymentId, ...run }) => run)
    .sort((a, b) => {
      const selectedA = selected.get(`${a.id}:${a.head_sha}`);
      const selectedB = selected.get(`${b.id}:${b.head_sha}`);
      const timeA = Date.parse(selectedA?._createdAt ?? "") || 0;
      const timeB = Date.parse(selectedB?._createdAt ?? "") || 0;
      return (
        timeB - timeA ||
        (selectedB?._deploymentId ?? 0) - (selectedA?._deploymentId ?? 0)
      );
    });
}

function validateWorkflowRunEvent({ repository, sha, runId, event }) {
  const workflowRun = event?.workflow_run;
  if (
    event?.repository?.full_name !== repository ||
    workflowRun?.event !== "push" ||
    workflowRun?.conclusion !== "success" ||
    workflowRun?.head_branch !== "main" ||
    workflowRun?.head_repository?.full_name !== repository ||
    workflowRun?.head_sha !== sha ||
    !workflowRun?.id
  )
    throw new Error(
      "The workflow_run event does not prove a successful same-repository main push for this SHA.",
    );
  assertRunId(runId);
}

async function recordFromEnvironment(component) {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const sha = process.env.APPROVED_SHA;
  const runId = process.env.GITHUB_RUN_ID;
  const runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT);
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error("GITHUB_EVENT_PATH is required.");
  assertRepository(repository);
  assertSha(sha);
  assertRunId(runId);
  let event;
  try {
    event = JSON.parse(readFileSync(eventPath, "utf8"));
  } catch {
    throw new Error(
      "The GitHub workflow event payload is unavailable or invalid.",
    );
  }
  validateWorkflowRunEvent({ repository, sha, runId, event });
  return recordComponentEvidence({
    repository,
    token,
    sha,
    component,
    runId,
    runAttempt,
  });
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const [command, component, ...extra] = process.argv.slice(2);
  if (
    command !== "record" ||
    ![...COMPONENTS, "release"].includes(component) ||
    extra.length
  ) {
    process.stderr.write(
      "Usage: node scripts/preview-component-evidence.mjs record <runtime|office|store|release>\n",
    );
    process.exitCode = 2;
  } else {
    recordFromEnvironment(component).catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : "Preview evidence recording failed."}\n`,
      );
      process.exitCode = 1;
    });
  }
}
