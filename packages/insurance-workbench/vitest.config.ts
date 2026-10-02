import { defineConfig } from "vitest/config";

export default defineConfig({
  // Store entrypoints live outside workspace packages and intentionally have no
  // node_modules. Resolve their React imports through this test workspace.
  resolve: { dedupe: ["react", "react-dom"] },
});
