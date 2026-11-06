import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.backup-gate-test.jsonc" },
      miniflare: {
        serviceBindings: {
          AUTH: () => new Response(null, { status: 503 }),
          SAVIA_REQUEST: () => new Response(null, { status: 503 }),
          CONNECTOR_GATEWAY: () => new Response(null, { status: 503 }),
        },
      },
    }),
  ],
  test: { include: ["test/backup-gate.native.ts"], testTimeout: 60000 },
});
