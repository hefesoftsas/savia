import test from "node:test";
import assert from "node:assert/strict";
import { verifyProductionCi } from "./production-ci-proof.mjs";

const repository = "hefesoftsas/savia",
  sha = "a".repeat(40);
const env = {
  GITHUB_REPOSITORY: repository,
  GITHUB_SHA: sha,
  GITHUB_REF: "refs/heads/main",
  GITHUB_EVENT_NAME: "workflow_dispatch",
};
const trusted = {
  id: 123,
  path: ".github/workflows/ci.yml",
  event: "push",
  head_sha: sha,
  head_branch: "main",
  status: "completed",
  conclusion: "success",
  repository: { full_name: repository },
  head_repository: { full_name: repository },
};
const runFor =
  (...runs) =>
  async () => ({ stdout: JSON.stringify({ workflow_runs: runs }) });

test("production reuses only the latest successful trusted main CI for its exact source", async () => {
  const proof = await verifyProductionCi({
    env,
    run: async (command, args) => {
      assert.equal(command, "gh");
      assert.ok(
        args.includes(`repos/${repository}/actions/workflows/ci.yml/runs`),
      );
      assert.ok(args.includes(`head_sha=${sha}`));
      assert.ok(args.includes("event=push"));
      assert.equal(
        args.some((a) => a.startsWith("status=")),
        false,
      );
      return { stdout: JSON.stringify({ workflow_runs: [trusted] }) };
    },
  });
  assert.deepEqual(proof, { runId: 123, sha });
  assert.deepEqual(
    await verifyProductionCi({
      env,
      run: runFor({ ...trusted, path: ".github/workflows/ci.yml@main" }),
    }),
    proof,
  );
});

test("production rejects untrusted, unrelated, incomplete, and failed CI evidence", async () => {
  for (const change of [
    { path: ".github/workflows/other.yml" },
    { path: ".github/workflows/ci.yml@other" },
    { event: "pull_request" },
    { head_sha: "b".repeat(40) },
    { head_branch: "other" },
    { repository: { full_name: "other/savia" } },
    { head_repository: { full_name: "fork/savia" } },
    { status: "in_progress" },
    { conclusion: "failure" },
    { conclusion: "skipped" },
    { id: 0 },
    { id: "123" },
  ])
    await assert.rejects(
      verifyProductionCi({ env, run: runFor({ ...trusted, ...change }) }),
      /trusted main CI/,
    );
  await assert.rejects(
    verifyProductionCi({ env, run: runFor() }),
    /trusted main CI/,
  );
  for (const latest of [
    { status: "in_progress", conclusion: null },
    { status: "completed", conclusion: "failure" },
  ])
    await assert.rejects(
      verifyProductionCi({
        env,
        run: runFor(trusted, { ...trusted, id: 124, ...latest }),
      }),
      /trusted main CI/,
    );
});

test("production CI proof fails closed before querying outside a main manual deployment", async () => {
  for (const change of [
    { GITHUB_REF: "refs/heads/other" },
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_SHA: "invalid" },
    { GITHUB_REPOSITORY: "../other" },
  ]) {
    let called = false;
    await assert.rejects(
      verifyProductionCi({
        env: { ...env, ...change },
        run: async () => {
          called = true;
        },
      }),
      /main manual deployment/,
    );
    assert.equal(called, false);
  }
  await assert.rejects(
    verifyProductionCi({
      env,
      run: async () => {
        throw Error("CANARY_SECRET");
      },
    }),
    (e) => !e.message.includes("CANARY_SECRET"),
  );
  await assert.rejects(
    verifyProductionCi({ env, run: async () => ({ stdout: "invalid" }) }),
    /trusted main CI/,
  );
});
