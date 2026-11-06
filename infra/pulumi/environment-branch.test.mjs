import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { runBranchDeployment } from "./environment-branch.mjs";
test("legacy branch dry-run freezes credential-free configuration without cloud or infrastructure mutations", async () => {
  let work;
  const result = await runBranchDeployment(
    ["--branch", "feature-login", "--dry-run"],
    {
      env: {},
      run: async () => assert.fail("spawned live build"),
      dependencies: () => assert.fail("created authenticated dependencies"),
      freeze: async (options) => {
        work = options.destination.split("/release")[0];
        assert.equal(options.configs.length, 7);
        for (const path of options.configs) {
          const config = JSON.parse(await readFile(path, "utf8"));
          assert.equal(config.vars?.BETTER_AUTH_BOOTSTRAP_PASSWORD, undefined);
        }
        return {
          artifactDirectory: options.destination,
          artifactDigest: "c".repeat(64),
          configDigest: "d".repeat(64),
        };
      },
    },
  );
  try {
    assert.equal(result.status, "prepared-only");
    assert.equal(result.environment, "branch-feature-login");
  } finally {
    if (work) await rm(work, { recursive: true, force: true });
  }
});
