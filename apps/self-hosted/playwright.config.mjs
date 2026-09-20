import { defineConfig } from "@playwright/test";

const origin = process.env.SAVIA_E2E_ORIGIN;
if (
  !origin ||
  !/^http:\/\/localhost:\d+$/.test(origin) ||
  !/^savia-mcp-e2e-[a-z0-9]+$/.test(process.env.SAVIA_E2E_PROJECT ?? "")
)
  throw new Error(
    "Run through pnpm test:e2e:mcp; only disposable loopback fixtures are allowed.",
  );

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.mjs",
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  outputDir: process.env.SAVIA_E2E_OUTPUT,
  reporter: "list",
  use: {
    baseURL: origin,
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
