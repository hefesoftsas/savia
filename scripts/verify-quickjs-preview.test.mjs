import assert from "node:assert/strict";
import test from "node:test";

import { previewSmokeConfig } from "./verify-quickjs-preview.mjs";

test("remote smoke session binds only to the branch-private hook worker", () => {
  const config = previewSmokeConfig("feature-quickjs");
  assert.equal(config.name, "savia-quickjs-smoke-feature-quickjs");
  assert.match(config.main, /scripts\/quickjs-preview-smoke\/worker\.mjs$/);
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.limits, { cpu_ms: 60_000 });
  assert.deepEqual(config.services, [
    {
      binding: "HOOK_SERVICE",
      service: "savia-hook-executor-preview-feature-quickjs",
    },
  ]);
  assert.equal("routes" in config, false);
  assert.equal("SAVIA_REQUEST" in config.services, false);
});
