import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    testTimeout: 15000,
    hookTimeout: 30000,
    pool: "forks",
    maxWorkers: 1,
  },
});
