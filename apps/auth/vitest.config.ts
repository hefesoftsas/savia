import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        serviceBindings: {
          SAVIA_IDENTITY: () =>
            Response.json({ error: "Not configured" }, { status: 503 }),
        },
      },
    }),
  ],
});
