import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  loadComponentEvidence,
  recordComponentEvidence,
} from "./preview-component-evidence.mjs";

const repo = "owner/savia";
const head = "b".repeat(40);
const sha = "a".repeat(40);
const runId = "12345";

function response(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

function receipt(component, overrides = {}) {
  return {
    id:
      component === "release"
        ? 30
        : { runtime: 10, office: 20, store: 30 }[component],
    environment: "preview",
    task: `savia:preview:component:${component}`,
    ref: sha,
    sha,
    payload: {
      schemaVersion: 1,
      repository: repo,
      environment: "preview",
      branch: "main",
      sha,
      component,
      workflow: ".github/workflows/deploy-preview.yml",
      runId,
      runAttempt: 1,
    },
    ...overrides,
  };
}

function apiFetch({ deployments = [], statuses = {} } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, options });
    if (options.method === "POST" && parsed.pathname.endsWith("/deployments")) {
      const body = JSON.parse(options.body);
      return response({ id: 99, sha: body.ref, ...body }, 201);
    }
    if (parsed.pathname.endsWith("/statuses"))
      return response(statuses[parsed.pathname.split("/").at(-2)] ?? []);
    if (parsed.pathname.endsWith("/deployments")) {
      const task = parsed.searchParams.get("task");
      const page = Number(parsed.searchParams.get("page") ?? 1);
      const filtered = task
        ? deployments.filter((deployment) => deployment.task === task)
        : deployments;
      return response(filtered.slice((page - 1) * 100, page * 100));
    }
    throw new Error(`Unexpected request: ${parsed.pathname}`);
  };
  return { fetchImpl, calls };
}

test("loads durable component receipts after Actions history has been deleted", async () => {
  const { fetchImpl } = apiFetch({
    deployments: [receipt("runtime"), receipt("office"), receipt("store")],
    statuses: {
      10: [{ state: "success" }],
      20: [{ state: "success" }],
      30: [{ state: "success" }],
    },
  });
  const runs = await loadComponentEvidence({
    repository: repo,
    token: "token",
    head,
    isAncestor: (candidate) => candidate === sha,
    fetchImpl,
  });
  assert.deepEqual(runs, [
    {
      id: runId,
      event: "workflow_run",
      head_branch: "main",
      head_sha: sha,
      status: "completed",
      verifiedComponents: ["runtime", "office", "store"],
      durable: true,
    },
  ]);
});

test("maps a release deployment to all three components", async () => {
  const { fetchImpl } = apiFetch({
    deployments: [receipt("release")],
    statuses: { 30: [{ state: "success" }] },
  });
  const runs = await loadComponentEvidence({
    repository: repo,
    token: "token",
    head,
    isAncestor: () => true,
    fetchImpl,
  });
  assert.deepEqual(runs[0].verifiedComponents, ["runtime", "office", "store"]);
});

test("returns independent latest component baselines, newest first", async () => {
  const newer = "c".repeat(40);
  const { fetchImpl } = apiFetch({
    deployments: [
      receipt("runtime", {
        id: 12,
        sha: newer,
        ref: newer,
        created_at: "2026-01-03T00:00:00Z",
        payload: { ...receipt("runtime").payload, sha: newer, runId: "222" },
      }),
      receipt("runtime", { created_at: "2026-01-02T00:00:00Z" }),
      receipt("office", { created_at: "2026-01-01T00:00:00Z" }),
      receipt("store", { id: 31, created_at: "2025-12-31T00:00:00Z" }),
    ],
    statuses: {
      12: [{ state: "success" }],
      10: [{ state: "success" }],
      20: [{ state: "success" }],
      31: [{ state: "success" }],
    },
  });
  const runs = await loadComponentEvidence({
    repository: repo,
    token: "token",
    head,
    isAncestor: (candidate) => candidate === sha || candidate === newer,
    fetchImpl,
  });
  assert.deepEqual(
    runs.map(({ head_sha, verifiedComponents }) => [
      head_sha,
      verifiedComponents,
    ]),
    [
      [newer, ["runtime"]],
      [sha, ["office", "store"]],
    ],
  );
});

test("rejects missing, failed, foreign, malformed, and non-ancestor evidence", async () => {
  const { fetchImpl } = apiFetch({
    deployments: [
      receipt("runtime", {
        id: 1,
        payload: { ...receipt("runtime").payload, repository: "other/repo" },
      }),
      receipt("runtime", {
        id: 2,
        payload: { ...receipt("runtime").payload, sha: "x" },
      }),
      receipt("runtime", {
        id: 3,
        sha: "d".repeat(40),
        ref: "d".repeat(40),
        payload: { ...receipt("runtime").payload, sha: "d".repeat(40) },
      }),
      receipt("office", { id: 4 }),
      receipt("store", { id: 5 }),
    ],
    statuses: {
      1: [{ state: "success" }],
      2: [{ state: "success" }],
      3: [{ state: "success" }],
      4: [{ state: "failure" }],
      5: [{ state: "success" }],
    },
  });
  const runs = await loadComponentEvidence({
    repository: repo,
    token: "token",
    head,
    isAncestor: () => false,
    fetchImpl,
  });
  assert.deepEqual(runs, []);
});

test("accepts an auto-inactivated receipt only when it has an earlier success", async () => {
  const { fetchImpl } = apiFetch({
    deployments: [receipt("runtime")],
    statuses: { 10: [{ state: "inactive" }, { state: "success" }] },
  });
  const runs = await loadComponentEvidence({
    repository: repo,
    token: "token",
    head,
    isAncestor: () => true,
    fetchImpl,
  });
  assert.equal(runs.length, 1);
});

test("rejects an inactive receipt whose nearest earlier status is not success", async () => {
  const { fetchImpl } = apiFetch({
    deployments: [receipt("runtime")],
    statuses: {
      10: [
        { state: "inactive", created_at: "2026-01-03T00:00:00Z" },
        { state: "failure", created_at: "2026-01-02T00:00:00Z" },
        { state: "success", created_at: "2026-01-01T00:00:00Z" },
      ],
    },
  });
  const runs = await loadComponentEvidence({
    repository: repo,
    token: "token",
    head,
    isAncestor: () => true,
    fetchImpl,
  });
  assert.deepEqual(runs, []);
});

test("does not accept queued or failed statuses, or generic preview deployments", async () => {
  const { fetchImpl } = apiFetch({
    deployments: [
      receipt("runtime", { id: 11, task: "generic-preview" }),
      receipt("office", { id: 12 }),
      receipt("store", { id: 13 }),
    ],
    statuses: { 12: [{ state: "queued" }], 13: [{ state: "error" }] },
  });
  const runs = await loadComponentEvidence({
    repository: repo,
    token: "token",
    head,
    isAncestor: () => true,
    fetchImpl,
  });
  assert.deepEqual(runs, []);
});

test("creates only exact-SHA, non-merged, non-production deployment receipts", async () => {
  const { fetchImpl, calls } = apiFetch();
  await recordComponentEvidence({
    repository: repo,
    token: "secret",
    sha,
    component: "office",
    runId,
    runAttempt: 2,
    fetchImpl,
  });
  const [deploymentCall, statusCall] = calls;
  const deployment = JSON.parse(deploymentCall.options.body);
  assert.equal(deploymentCall.options.method, "POST");
  assert.equal(deploymentCall.options.redirect, "error");
  assert.ok(deploymentCall.options.signal instanceof AbortSignal);
  assert.deepEqual(deployment, {
    ref: sha,
    auto_merge: false,
    required_contexts: [],
    environment: "preview",
    transient_environment: false,
    production_environment: false,
    task: "savia:preview:component:office",
    payload: {
      schemaVersion: 1,
      repository: repo,
      environment: "preview",
      branch: "main",
      sha,
      component: "office",
      workflow: ".github/workflows/deploy-preview.yml",
      runId,
      runAttempt: 2,
    },
  });
  assert.equal(statusCall.options.method, "POST");
  assert.deepEqual(JSON.parse(statusCall.options.body), {
    state: "success",
    auto_inactive: false,
    log_url: `https://github.com/${repo}/actions/runs/${runId}`,
  });
});

test("records the aggregate release component", async () => {
  const { fetchImpl, calls } = apiFetch();
  await recordComponentEvidence({
    repository: repo,
    token: "secret",
    sha,
    component: "release",
    runId,
    runAttempt: 1,
    fetchImpl,
  });
  const deployment = JSON.parse(calls[0].options.body);
  assert.equal(deployment.task, "savia:preview:component:release");
  assert.equal(deployment.payload.component, "release");
});

test("validates write inputs and fails safely without recording success", async () => {
  for (const input of [
    {
      repository: "../repo",
      token: "t",
      sha,
      component: "runtime",
      runId,
      runAttempt: 1,
    },
    {
      repository: repo,
      token: "t",
      sha: "bad",
      component: "runtime",
      runId,
      runAttempt: 1,
    },
    {
      repository: repo,
      token: "t",
      sha,
      component: "all",
      runId,
      runAttempt: 1,
    },
    {
      repository: repo,
      token: "t",
      sha,
      component: "runtime",
      runId: "bad/id",
      runAttempt: 1,
    },
    {
      repository: repo,
      token: "t",
      sha,
      component: "runtime",
      runId,
      runAttempt: 0,
    },
  ]) {
    await assert.rejects(
      recordComponentEvidence({
        ...input,
        fetchImpl: async () => {
          throw Error("should not fetch");
        },
      }),
    );
  }
  const fetchImpl = async () =>
    response({ message: "contains sensitive body" }, 500);
  await assert.rejects(
    recordComponentEvidence({
      repository: repo,
      token: "topsecret",
      sha,
      component: "runtime",
      runId,
      runAttempt: 1,
      fetchImpl,
    }),
    (error) =>
      !error.message.includes("topsecret") &&
      !error.message.includes("sensitive body"),
  );
});

test("bounds deployment pagination and fails closed on API read errors", async () => {
  const { fetchImpl, calls } = apiFetch({
    deployments: Array.from({ length: 1000 }, () =>
      receipt("runtime", { id: 1 }),
    ),
  });
  await assert.rejects(
    loadComponentEvidence({
      repository: repo,
      token: "token",
      head,
      isAncestor: () => false,
      fetchImpl,
    }),
  );
  assert.ok(calls.length <= 20);

  await assert.rejects(
    loadComponentEvidence({
      repository: repo,
      token: "token",
      head,
      isAncestor: () => true,
      fetchImpl: async () => response({ message: "private" }, 503),
    }),
    (error) => !error.message.includes("private"),
  );
});

test("CLI rejects workflow_run evidence that is not a successful same-repository main push", () => {
  const directory = mkdtempSync(join(tmpdir(), "preview-receipt-"));
  try {
    const eventPath = join(directory, "event.json");
    writeFileSync(
      eventPath,
      JSON.stringify({
        repository: { full_name: repo },
        workflow_run: {
          id: 5,
          event: "pull_request",
          conclusion: "success",
          head_branch: "main",
          head_repository: { full_name: repo },
          head_sha: sha,
        },
      }),
    );
    const result = spawnSync(
      process.execPath,
      ["scripts/preview-component-evidence.mjs", "record", "runtime"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_REPOSITORY: repo,
          GITHUB_TOKEN: "must-not-print",
          APPROVED_SHA: sha,
          GITHUB_RUN_ID: runId,
          GITHUB_RUN_ATTEMPT: "1",
          GITHUB_EVENT_PATH: eventPath,
        },
      },
    );
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /does not prove a successful same-repository main push/,
    );
    assert.ok(!result.stderr.includes("must-not-print"));
    const releaseResult = spawnSync(
      process.execPath,
      ["scripts/preview-component-evidence.mjs", "record", "release"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_REPOSITORY: repo,
          GITHUB_TOKEN: "must-not-print",
          APPROVED_SHA: sha,
          GITHUB_RUN_ID: runId,
          GITHUB_RUN_ATTEMPT: "1",
          GITHUB_EVENT_PATH: eventPath,
        },
      },
    );
    assert.equal(releaseResult.status, 1);
    assert.match(releaseResult.stderr, /does not prove a successful/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
