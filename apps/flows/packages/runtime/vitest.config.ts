import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: { maxWorkers: 1, fileParallelism: false },
  resolve: {
    alias: {
      // These modules are only available in the Cloudflare Workers runtime.
      // Node tests don't exercise workflow retry semantics or sandbox execution,
      // so we provide minimal stubs to keep the module graph importable.
      "cloudflare:workflows": fileURLToPath(
        new URL("src/__test-stubs__/cloudflare-workflows.ts", import.meta.url),
      ),
      "@cloudflare/sandbox": fileURLToPath(
        new URL("src/__test-stubs__/cloudflare-sandbox.ts", import.meta.url),
      ),
    },
  },
});
