import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        serviceBindings: {
          SAVIA_REQUEST: () =>
            Response.json({ error: "Not configured" }, { status: 503 }),
        },
      },
    }),
  ],
  test: {
    // beforeAll applies every DB migration inside workerd; the 10s default
    // flaked under CI load (hook timed out seeding the principal).
    hookTimeout: 30000,
    testTimeout: 15000,
  },
});
