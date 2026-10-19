import test from "node:test";
import assert from "node:assert/strict";
import * as publisher from "./runtime-publisher-branch.mjs";
import * as legacy from "../../scripts/preview-deploy.mjs";

test("the legacy branch entrypoint re-exports the extracted publisher helpers", () => {
  for (const name of [
    "workerConfig",
    "workerDeploymentOrder",
    "execFileWithInput",
    "parseWorkersDevUrl",
    "requireGatewayOrigin",
  ])
    assert.equal(legacy[name], publisher[name]);
  assert.equal(typeof publisher.publishBranchPreview, "function");
});
