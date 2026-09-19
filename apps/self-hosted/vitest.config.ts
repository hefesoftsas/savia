import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    testTimeout:
      process.env.SAVIA_POSTGRES_TEST_REQUIRED === "1" ? 60000 : 15000,
    hookTimeout: 60000,
  },
});
