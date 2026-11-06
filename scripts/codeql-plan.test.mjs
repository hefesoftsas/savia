import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolveCodeqlPlan, selectCodeqlLanguages } from "./codeql-plan.mjs";

const allLanguages = ["actions", "javascript-typescript", "python", "rust"];
const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

test("selects languages in stable order across supported source and manifest files", () => {
  assert.deepEqual(
    selectCodeqlLanguages([
      "src/component.vue",
      "web/page.html",
      "web/component.tsx",
      "package.json",
      "pnpm-lock.yaml",
      "service/requirements-dev.txt",
      "service/app.pyi",
      "crates/core/Cargo.toml",
      ".github/actions/setup/action.yml",
      ".github/actions/setup/check.js",
      ".github/workflows/ci.yaml",
    ]),
    allLanguages,
  );
});

test("selects each language from its less common supported file names", () => {
  assert.deepEqual(
    selectCodeqlLanguages([
      "src/main.mjs",
      "src/node.cjs",
      "src/types.mts",
      "src/common.cts",
      "src/page.svelte",
      "yarn.lock",
      "Pipfile.lock",
      "poetry.lock",
      "rust-toolchain.toml",
    ]),
    ["javascript-typescript", "python", "rust"],
  );
});

test("ignores documentation and image-only changes", () => {
  assert.deepEqual(
    selectCodeqlLanguages([
      "docs/guide.md",
      "README.rst",
      "docs/diagram.svg",
      "assets/logo.png",
    ]),
    [],
  );
});

test("detects source files under docs and treats unknown docs files conservatively", () => {
  assert.deepEqual(
    selectCodeqlLanguages(["docs/examples/app.ts", "docs/examples/tool.py"]),
    ["javascript-typescript", "python"],
  );
  assert.deepEqual(
    selectCodeqlLanguages(["docs/design/unknown-diagram.drawio"]),
    allLanguages,
  );
});

test("selects JavaScript alongside Actions for JavaScript action files", () => {
  assert.deepEqual(selectCodeqlLanguages([".github/actions/setup/check.js"]), [
    "actions",
    "javascript-typescript",
  ]);
});

test("selects every language for CodeQL control and unknown non-document files", () => {
  for (const path of [
    ".github/workflows/codeql.yml",
    ".github/codeql/custom.yml",
    "scripts/codeql-plan.mjs",
    "scripts/codeql-plan.test.mjs",
    "infra/new-build-config.toml",
  ]) {
    assert.deepEqual(selectCodeqlLanguages([path]), allLanguages, path);
  }
});

test("PR resolution paginates, includes renamed prior paths, and validates base identity", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    calls.push({ parsed, options });
    if (parsed.pathname.endsWith("/pulls/42"))
      return response({ base: { sha: baseSha }, head: { sha: headSha } });
    const page = Number(parsed.searchParams.get("page"));
    if (page === 1)
      return response(
        Array.from({ length: 100 }, (_, index) => ({
          filename: `docs/change-${index}.md`,
        })),
      );
    return response([
      { filename: "new/renamed.md", previous_filename: "src/legacy.py" },
      { filename: "docs/last.md" },
    ]);
  };
  const plan = await resolveCodeqlPlan({
    env: {
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_REPOSITORY: "owner/repo",
      GITHUB_TOKEN: "test-token",
    },
    event: {
      number: 42,
      pull_request: {
        number: 42,
        head: { repo: { full_name: "fork/repo" }, sha: headSha },
        base: { repo: { full_name: "owner/repo" }, sha: baseSha },
      },
    },
    fetchImpl,
  });

  assert.deepEqual(plan, {
    languages: ["python"],
    shouldScan: true,
  });
  const fileCalls = calls.filter(({ parsed }) =>
    parsed.pathname.endsWith("/files"),
  );
  assert.deepEqual(
    fileCalls.map(({ parsed }) => parsed.searchParams.get("page")),
    ["1", "2"],
  );
  assert.equal(fileCalls[0].parsed.hostname, "api.github.com");
  assert.equal(
    fileCalls[0].parsed.pathname,
    "/repos/owner/repo/pulls/42/files",
  );
  assert.equal(fileCalls[0].options.redirect, "error");
  assert.equal(fileCalls[0].options.headers.authorization, "Bearer test-token");
});

test("rejects a PR whose base repository does not match the workflow repository", async () => {
  await assert.rejects(
    resolveCodeqlPlan({
      env: {
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_REPOSITORY: "owner/repo",
        GITHUB_TOKEN: "test-token",
      },
      event: {
        pull_request: {
          number: 42,
          base: { repo: { full_name: "other/repo" }, sha: baseSha },
          head: { sha: headSha },
        },
      },
      fetchImpl: async () => response([]),
    }),
    /base repository/,
  );
});

test("rejects invalid PR numbers and GitHub API errors", async () => {
  const env = {
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_REPOSITORY: "owner/repo",
    GITHUB_TOKEN: "test-token",
  };
  const event = {
    pull_request: {
      number: 42,
      base: { repo: { full_name: "owner/repo" }, sha: baseSha },
      head: { sha: headSha },
    },
  };
  await assert.rejects(
    resolveCodeqlPlan({
      env,
      event: { ...event, pull_request: { ...event.pull_request, number: 0 } },
      fetchImpl: async () => response([]),
    }),
    /pull request number/,
  );
  await assert.rejects(
    resolveCodeqlPlan({
      env,
      event,
      fetchImpl: async () => response({ message: "denied" }, 403),
    }),
    /GitHub API request failed/,
  );
});

test("rejects when the pull request head changes during file pagination", async () => {
  let stateReads = 0;
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/files"))
      return response([{ filename: "src/app.py" }]);
    stateReads += 1;
    return response({
      base: { sha: baseSha },
      head: { sha: stateReads === 1 ? headSha : "c".repeat(40) },
    });
  };
  await assert.rejects(
    resolveCodeqlPlan({
      env: {
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_REPOSITORY: "owner/repo",
        GITHUB_TOKEN: "test-token",
      },
      event: {
        pull_request: {
          number: 42,
          base: { repo: { full_name: "owner/repo" }, sha: baseSha },
          head: { sha: headSha },
        },
      },
      fetchImpl,
    }),
    /changed while CodeQL files were being selected/,
  );
  assert.equal(stateReads, 2);
});

test("rejects invalid rename paths from the GitHub API", async () => {
  await assert.rejects(
    resolveCodeqlPlan({
      env: {
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_REPOSITORY: "owner/repo",
        GITHUB_TOKEN: "test-token",
      },
      event: {
        pull_request: {
          number: 42,
          base: { repo: { full_name: "owner/repo" }, sha: baseSha },
          head: { sha: headSha },
        },
      },
      fetchImpl: async (url) =>
        new URL(url).pathname.endsWith("/files")
          ? response([{ filename: "src/app.py", previous_filename: "" }])
          : response({ base: { sha: baseSha }, head: { sha: headSha } }),
    }),
    /invalid pull request file entry/,
  );
});

test("rejects truncated PR file listings after the bounded page limit", async () => {
  await assert.rejects(
    resolveCodeqlPlan({
      env: {
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_REPOSITORY: "owner/repo",
        GITHUB_TOKEN: "test-token",
      },
      event: {
        pull_request: {
          number: 42,
          base: { repo: { full_name: "owner/repo" }, sha: baseSha },
          head: { sha: headSha },
        },
      },
      fetchImpl: async (url) =>
        new URL(url).pathname.endsWith("/files")
          ? response(
              Array.from({ length: 100 }, (_, index) => ({
                filename: `f${index}.md`,
              })),
            )
          : response({ base: { sha: baseSha }, head: { sha: headSha } }),
    }),
    /exceeds the supported limit/i,
  );
});

test("manual dispatch defaults to all and accepts only one of the four languages", async () => {
  const base = {
    env: { GITHUB_EVENT_NAME: "workflow_dispatch" },
    event: {},
  };
  assert.deepEqual(await resolveCodeqlPlan(base), {
    languages: allLanguages,
    shouldScan: true,
  });
  assert.deepEqual(
    await resolveCodeqlPlan({
      ...base,
      event: { inputs: { language: "rust" } },
    }),
    { languages: ["rust"], shouldScan: true },
  );
  await assert.rejects(
    resolveCodeqlPlan({
      ...base,
      event: { inputs: { language: "java" } },
    }),
    /unsupported manual language/i,
  );
});

test("rejects unknown event types", async () => {
  await assert.rejects(
    resolveCodeqlPlan({ env: { GITHUB_EVENT_NAME: "push" }, event: {} }),
    /Unsupported GitHub event/,
  );
});

test("CLI writes JSON languages and a boolean should_scan output", () => {
  const directory = mkdtempSync(join(tmpdir(), "codeql-plan-"));
  try {
    const eventPath = join(directory, "event.json");
    const outputPath = join(directory, "output.txt");
    writeFileSync(
      eventPath,
      JSON.stringify({ inputs: { language: "python" } }),
    );
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./codeql-plan.mjs", import.meta.url))],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: "workflow_dispatch",
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_OUTPUT: outputPath,
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(outputPath, "utf8").trim().split("\n"), [
      'languages=["python"]',
      "should_scan=true",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
