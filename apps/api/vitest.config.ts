import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        workerLoaders: { LOADER: {} },
        serviceBindings: {
          SAVIA_REQUEST: () =>
            Response.json({ error: "Not configured" }, { status: 503 }),
          CONNECTOR_GATEWAY: () =>
            Response.json(
              { error: { code: "CONNECTOR_GATEWAY_UNAVAILABLE" } },
              { status: 503 },
            ),
          AUTH: () => Response.json({ user: null }),
        },
      },
    }),
  ],
  test: {
    // beforeAll hooks apply every DB migration inside workerd; the 10s
    // default flaked under CI load (assistant-service, hubspot-workspace,
    // managed-agencies). Same values as apps/admin.
    hookTimeout: 30000,
    testTimeout: 15000,
  },
});
