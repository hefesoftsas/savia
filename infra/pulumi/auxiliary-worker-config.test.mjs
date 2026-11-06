import assert from "node:assert/strict";
import test from "node:test";

import {
  pluginEditorWorkerConfig,
  pluginRegistryWorkerConfig,
} from "./auxiliary-worker-config.mjs";

test("plugin editor preview config points at the generated editor assets", () => {
  const config = pluginEditorWorkerConfig();

  assert.equal(config.name, "savia-plugin-editor-preview");
  assert.equal(config.main, "src/index.ts");
  assert.equal(config.workers_dev, true);
  assert.deepEqual(config.assets, {
    directory: "../admin/dist-plugin-editor",
    binding: "ASSETS",
    run_worker_first: true,
    not_found_handling: "none",
  });
});

test("plugin editor preview config can target a generated deployment root", () => {
  const config = pluginEditorWorkerConfig({
    outputRoot: "/tmp/savia-rendered",
  });

  assert.equal(config.name, "savia-plugin-editor-preview");
  assert.equal(config.assets.directory, "../admin/dist-plugin-editor");
});

test("plugin registry config accepts only protected shared stack outputs", () => {
  const config = pluginRegistryWorkerConfig({
    environment: "shared",
    workerName: "savia-plugin-registry",
    bucketName: "savia-plugin-registry",
    bucketProtected: true,
  });

  assert.equal(config.name, "savia-plugin-registry");
  assert.equal(config.main, "src/index.ts");
  assert.deepEqual(config.r2_buckets, [
    { binding: "PLUGIN_REGISTRY", bucket_name: "savia-plugin-registry" },
  ]);
  assert.equal(config.workers_dev, true);
});

test("plugin registry config rejects environment drift and unprotected storage", () => {
  for (const outputs of [
    {
      environment: "preview",
      workerName: "savia-plugin-registry",
      bucketName: "savia-plugin-registry",
      bucketProtected: true,
    },
    {
      environment: "shared",
      workerName: "savia-plugin-registry",
      bucketName: "savia-plugin-registry",
      bucketProtected: false,
    },
  ]) {
    assert.throws(() => pluginRegistryWorkerConfig(outputs));
  }
});
