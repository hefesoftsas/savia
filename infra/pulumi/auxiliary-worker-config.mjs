import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const registryWorker = "savia-plugin-registry";
const registryBucket = "savia-plugin-registry";

function editorAssetsDirectory(outputRoot) {
  const configFile = join(
    outputRoot,
    "apps",
    "plugin-editor-runtime",
    "wrangler.preview.jsonc",
  );
  const assetsDirectory = join(
    outputRoot,
    "apps",
    "admin",
    "dist-plugin-editor",
  );
  return relative(dirname(configFile), assetsDirectory).split("\\").join("/");
}

export function pluginEditorWorkerConfig({ outputRoot = projectRoot } = {}) {
  return {
    name: "savia-plugin-editor-preview",
    main: "src/index.ts",
    compatibility_date: "2026-08-31",
    workers_dev: true,
    assets: {
      directory: editorAssetsDirectory(outputRoot),
      binding: "ASSETS",
      run_worker_first: true,
      not_found_handling: "none",
    },
  };
}

export function pluginRegistryWorkerConfig(resources) {
  if (
    resources?.environment !== "shared" ||
    resources?.workerName !== registryWorker ||
    resources?.bucketName !== registryBucket ||
    resources?.bucketProtected !== true
  ) {
    throw new Error(
      "Plugin registry deployment requires protected savia-shared-registry shared stack outputs",
    );
  }

  return {
    $schema: "node_modules/wrangler/config-schema.json",
    name: resources.workerName,
    compatibility_date: "2026-08-31",
    main: "src/index.ts",
    workers_dev: true,
    r2_buckets: [
      { binding: "PLUGIN_REGISTRY", bucket_name: resources.bucketName },
    ],
  };
}
