import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCliPreflight } from "./cli-preflight.mjs";

const pulumi = process.env.SAVIA_PULUMI_COMMAND ?? "pulumi";

test("real CLI verifies empty exports, isolated config recovery and protected state movement", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "savia-preflight-test-"));
  const credentials = [
    "CLOUDFLARE_API_TOKEN",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "GITHUB_TOKEN",
  ];
  const previous = new Map(credentials.map((key) => [key, process.env[key]]));
  for (const key of credentials)
    process.env[key] = "fixture-canary-must-not-be-inherited";
  try {
    const result = await runCliPreflight({ pulumi, tempRoot });
    assert.equal(result.status, "passed");
    assert.equal(result.backend, "temporary-file");
    assert.deepEqual(result.checks, {
      emptyCheckpoint: true,
      bookkeepingPlan: true,
      appliedConfiguration: true,
      secretRedaction: true,
      protectedStateMove: true,
      cloudCredentialsExcluded: true,
    });
    assert.equal(result.cleaned, true);
    assert.deepEqual(await readdir(tempRoot), []);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("CLI failure cleans its disposable backend and never falls back to the configured backend", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "savia-preflight-fail-"));
  try {
    await assert.rejects(
      runCliPreflight({ pulumi: join(tempRoot, "missing-pulumi"), tempRoot }),
      /Pulumi CLI preflight failed at version/,
    );
    assert.deepEqual(await readdir(tempRoot), []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
