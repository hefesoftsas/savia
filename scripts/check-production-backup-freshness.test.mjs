import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkProductionBackupFreshness,
  runFreshnessCheck,
} from "./check-production-backup-freshness.mjs";

function response(payload) {
  return { ok: true, json: async () => payload };
}

function apiFixture({
  artifactDate,
  expired = false,
  conclusion = "success",
  artifactName = "production-backup-18-1",
  artifactSize = 64,
}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/workflows/backup-production.yml/runs")) {
      return response({
        workflow_runs: [
          {
            id: 18,
            head_branch: "main",
            conclusion,
            updated_at: artifactDate,
          },
          {
            id: 17,
            head_branch: "feature",
            conclusion: "success",
            updated_at: artifactDate,
          },
        ],
      });
    }
    return response({
      artifacts: [
        {
          id: 44,
          name: artifactName,
          expired,
          size_in_bytes: artifactSize,
          created_at: artifactDate,
          expires_at: "2026-11-17T00:00:00.000Z",
        },
      ],
    });
  };
  return { fetchImpl, calls };
}

test("accepts a recent nonexpired encrypted artifact from a successful main run", async () => {
  const now = new Date("2026-10-17T12:00:00.000Z");
  const artifactDate = "2026-10-17T02:00:00.000Z";
  const root = await mkdtemp(join(tmpdir(), "backup-freshness-"));
  const summaryPath = join(root, "summary.md");
  const { fetchImpl, calls } = apiFixture({ artifactDate });
  try {
    const result = await checkProductionBackupFreshness({
      repository: "example/savia",
      token: "test-token",
      now,
      fetchImpl,
      summaryPath,
    });
    assert.equal(result.fresh, true);
    assert.equal(result.newest.runId, 18);
    assert.equal(calls.length, 2);
    assert.match(calls[0].options.headers.authorization, /^Bearer /);
    assert.ok(
      calls.every(({ options }) => options.signal instanceof AbortSignal),
    );
    assert.match(await readFile(summaryPath, "utf8"), /10\.0 hours old/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects future, malformed, and empty artifact records", async () => {
  const now = new Date("2026-10-17T12:00:00.000Z");
  const cases = [
    apiFixture({ artifactDate: "2026-10-17T12:01:00.000Z" }),
    apiFixture({
      artifactDate: "2026-10-17T03:00:00.000Z",
      artifactName: "production-backup-18-1-extra",
    }),
    apiFixture({
      artifactDate: "2026-10-17T03:00:00.000Z",
      artifactSize: 0,
    }),
  ];
  for (const { fetchImpl } of cases) {
    const result = await checkProductionBackupFreshness({
      repository: "example/savia",
      token: "test-token",
      now,
      fetchImpl,
    });
    assert.equal(result.fresh, false);
    assert.equal(result.newest, null);
  }
});

test("rejects an invalid freshness clock", async () => {
  await assert.rejects(
    checkProductionBackupFreshness({
      repository: "example/savia",
      token: "test-token",
      now: new Date("invalid"),
      fetchImpl: async () => {
        throw new Error("must not make a request");
      },
    }),
    /check time is invalid/,
  );
});

test("writes a generic summary when GitHub denies the API request", async () => {
  const root = await mkdtemp(join(tmpdir(), "backup-freshness-denied-"));
  const summaryPath = join(root, "summary.md");
  try {
    await assert.rejects(
      runFreshnessCheck({
        repository: "example/savia",
        token: "test-token",
        summaryPath,
        fetchImpl: async () => ({
          ok: false,
          json: async () => ({ message: "credential contents must not leak" }),
        }),
      }),
      /could not be verified/,
    );
    const summary = await readFile(summaryPath, "utf8");
    assert.match(summary, /Could not verify retained backup status/);
    assert.doesNotMatch(summary, /credential contents/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails when the only successful run has no retained artifact or is stale", async () => {
  const now = new Date("2026-10-17T12:00:00.000Z");
  const root = await mkdtemp(join(tmpdir(), "backup-freshness-failed-"));
  const summaryPath = join(root, "summary.md");
  try {
    const stale = apiFixture({ artifactDate: "2026-10-15T23:00:00.000Z" });
    const staleResult = await checkProductionBackupFreshness({
      repository: "example/savia",
      token: "test-token",
      now,
      fetchImpl: stale.fetchImpl,
      summaryPath,
    });
    assert.equal(staleResult.fresh, false);
    assert.match(await readFile(summaryPath, "utf8"), /limit is 36 hours/);

    const expired = apiFixture({
      artifactDate: "2026-10-17T03:00:00.000Z",
      expired: true,
    });
    const expiredResult = await checkProductionBackupFreshness({
      repository: "example/savia",
      token: "test-token",
      now,
      fetchImpl: expired.fetchImpl,
    });
    assert.equal(expiredResult.fresh, false);
    assert.equal(expiredResult.newest, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not treat a failed backup run as a recovery point", async () => {
  const { fetchImpl } = apiFixture({
    artifactDate: "2026-10-17T03:00:00.000Z",
    conclusion: "failure",
  });
  const result = await checkProductionBackupFreshness({
    repository: "example/savia",
    token: "test-token",
    now: new Date("2026-10-17T12:00:00.000Z"),
    fetchImpl,
  });
  assert.equal(result.fresh, false);
  assert.equal(result.newest, null);
});
