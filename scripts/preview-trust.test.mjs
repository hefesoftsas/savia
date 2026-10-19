import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const workflowPath = new URL(
  "../.github/workflows/preview-environment.yml",
  import.meta.url,
);
const secretCanary = "preview-test-secret-canary-9f4b";

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")} failed: ${result.stderr}`,
  );
  return result.stdout.trim();
}

function trustedSourceGuard() {
  const workflow = readFileSync(workflowPath, "utf8");
  const lines = workflow.split(/\r?\n/);
  const stepIndex = lines.findIndex((line) =>
    /^      - name: Validate trusted preview source\s*$/.test(line),
  );
  assert.notEqual(
    stepIndex,
    -1,
    "workflow must define the 'Validate trusted preview source' step",
  );

  const stepEnd = lines.findIndex(
    (line, index) => index > stepIndex && /^      - (?:name:|uses:)/.test(line),
  );
  const runIndex = lines.findIndex(
    (line, index) =>
      index > stepIndex &&
      (stepEnd === -1 || index < stepEnd) &&
      /^        run: \|\s*$/.test(line),
  );
  assert.notEqual(
    runIndex,
    -1,
    "trusted source guard must have a bash run block",
  );

  const body = [];
  for (const line of lines.slice(
    runIndex + 1,
    stepEnd === -1 ? undefined : stepEnd,
  )) {
    if (line.trim() && !/^ {10}/.test(line)) break;
    body.push(line.replace(/^ {10}/, ""));
  }
  assert.ok(
    body.some((line) => line.trim()),
    "trusted source guard run block is empty",
  );
  return body.join("\n");
}

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "savia-preview-trust-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const origin = path.join(root, "origin.git");
  const seed = path.join(root, "seed");
  const checkout = path.join(root, "checkout");
  git(root, "init", "--bare", "--initial-branch=main", origin);
  git(root, "init", "--initial-branch=main", seed);
  git(seed, "config", "user.name", "Preview Trust Test");
  git(seed, "config", "user.email", "preview-trust@example.invalid");
  git(seed, "remote", "add", "origin", origin);

  writeFileSync(path.join(seed, "README.md"), "base\n");
  git(seed, "add", "README.md");
  git(seed, "commit", "-m", "base commit");
  const ancestorSha = git(seed, "rev-parse", "HEAD");
  git(seed, "push", "origin", "main");
  git(seed, "push", "origin", "HEAD:refs/heads/preview/good");
  git(seed, "push", "origin", "HEAD:refs/heads/preview/deleted");

  git(seed, "checkout", "-b", "preview/unmerged");
  writeFileSync(
    path.join(seed, "branch-owned-code.sh"),
    `printf executed > '${path.join(root, "branch-code-ran")}'\n`,
  );
  git(seed, "add", "branch-owned-code.sh");
  git(seed, "commit", "-m", "untrusted branch code");
  git(seed, "push", "origin", "preview/unmerged");

  git(seed, "checkout", "main");
  writeFileSync(path.join(seed, "README.md"), "trusted main\n");
  git(seed, "commit", "-am", "trusted main commit");
  const trustedSha = git(seed, "rev-parse", "HEAD");
  git(seed, "push", "origin", "main");
  git(seed, "push", "origin", "--delete", "preview/deleted");
  git(root, "clone", "--branch", "main", origin, checkout);
  git(checkout, "config", "user.name", "Preview Trust Test");
  git(checkout, "config", "user.email", "preview-trust@example.invalid");

  const hookMarker = path.join(root, "post-checkout-hook-ran");
  const hookPath = path.join(checkout, ".git", "hooks", "post-checkout");
  writeFileSync(hookPath, `#!/bin/sh\nprintf executed > '${hookMarker}'\n`);
  chmodSync(hookPath, 0o755);

  return { root, checkout, ancestorSha, trustedSha, hookMarker };
}

function runGuard(
  repo,
  { branch, action = "deploy", initialSha, secret = secretCanary },
) {
  return spawnSync("bash", ["-c", trustedSourceGuard()], {
    cwd: repo.checkout,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_SHA: initialSha ?? repo.trustedSha,
      RUNNER_TEMP: repo.root,
      GITHUB_ENV: path.join(repo.root, "github-env"),
      PREVIEW_BRANCH: branch,
      PREVIEW_ACTION: action,
      CLOUDFLARE_API_TOKEN: secret,
    },
  });
}

test("deploy accepts a trusted ancestor, pins its SHA, and disables checkout hooks", (t) => {
  const repo = fixture(t);
  const result = runGuard(repo, { branch: "preview/good" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(git(repo.checkout, "rev-parse", "HEAD"), repo.trustedSha);
  const source = path.join(repo.root, "savia-release-source");
  assert.equal(git(source, "rev-parse", "HEAD"), repo.ancestorSha);
  assert.equal(git(source, "rev-parse", "--abbrev-ref", "HEAD"), "HEAD");
  assert.equal(readFileSync(path.join(source, "README.md"), "utf8"), "base\n");
  assert.match(
    readFileSync(path.join(repo.root, "github-env"), "utf8"),
    new RegExp(`SAVIA_RELEASE_SOURCE_SHA=${repo.ancestorSha}`),
  );
  assert.equal(existsSync(repo.hookMarker), false);
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    new RegExp(secretCanary),
  );
});

test("deploy rejects an unmerged branch without checking out or running its code", (t) => {
  const repo = fixture(t);
  const result = runGuard(repo, { branch: "preview/unmerged" });

  assert.notEqual(result.status, 0);
  assert.equal(git(repo.checkout, "rev-parse", "HEAD"), repo.trustedSha);
  assert.equal(existsSync(path.join(repo.root, "branch-code-ran")), false);
  assert.equal(existsSync(repo.hookMarker), false);
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    new RegExp(secretCanary),
  );
});

test("deploy rejects an invalid branch expression without a shell side effect", (t) => {
  const repo = fixture(t);
  const marker = path.join(repo.root, "injection-ran");
  const result = runGuard(repo, { branch: `preview/good; touch '${marker}'` });

  assert.notEqual(result.status, 0);
  assert.equal(git(repo.checkout, "rev-parse", "HEAD"), repo.trustedSha);
  assert.equal(existsSync(marker), false);
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    new RegExp(secretCanary),
  );
});

test("deploy rejects an empty branch name", (t) => {
  const repo = fixture(t);
  const result = runGuard(repo, { branch: "" });

  assert.notEqual(result.status, 0);
  assert.equal(git(repo.checkout, "rev-parse", "HEAD"), repo.trustedSha);
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    new RegExp(secretCanary),
  );
});

test("deploy rejects a syntactically valid branch missing from origin", (t) => {
  const repo = fixture(t);
  const result = runGuard(repo, { branch: "preview/unknown" });

  assert.notEqual(result.status, 0);
  assert.equal(git(repo.checkout, "rev-parse", "HEAD"), repo.trustedSha);
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    new RegExp(secretCanary),
  );
});

test("deploy rejects a case-insensitive reserved branch name", (t) => {
  const repo = fixture(t);
  const result = runGuard(repo, { branch: "MaIn" });

  assert.notEqual(result.status, 0);
  assert.equal(git(repo.checkout, "rev-parse", "HEAD"), repo.trustedSha);
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    new RegExp(secretCanary),
  );
});

test("destroy accepts a deleted target branch and stays on trusted main", (t) => {
  const repo = fixture(t);
  const result = runGuard(repo, {
    branch: "preview/deleted",
    action: "destroy",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(git(repo.checkout, "rev-parse", "HEAD"), repo.trustedSha);
  assert.equal(git(repo.checkout, "symbolic-ref", "--short", "HEAD"), "main");
  assert.equal(
    readFileSync(path.join(repo.checkout, "README.md"), "utf8"),
    "trusted main\n",
  );
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    new RegExp(secretCanary),
  );
});

test("guard rejects a checkout whose HEAD differs from GITHUB_SHA", (t) => {
  const repo = fixture(t);
  const result = runGuard(repo, {
    branch: "preview/good",
    initialSha: repo.ancestorSha,
  });

  assert.notEqual(result.status, 0);
  assert.equal(git(repo.checkout, "rev-parse", "HEAD"), repo.trustedSha);
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    new RegExp(secretCanary),
  );
});

test("guard rejects an unsupported preview action", (t) => {
  const repo = fixture(t);
  const result = runGuard(repo, {
    branch: "preview/good",
    action: "deploy; touch nope",
  });

  assert.notEqual(result.status, 0);
  assert.equal(git(repo.checkout, "rev-parse", "HEAD"), repo.trustedSha);
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    new RegExp(secretCanary),
  );
});
