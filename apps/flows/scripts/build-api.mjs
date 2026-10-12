import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildQuickJsExecutorWorker } from "./build-executor.mjs";

const api = fileURLToPath(new URL("../api", import.meta.url));
// This only bundles locally. It does not deploy or contact a Cloudflare account.
await buildQuickJsExecutorWorker();
const child = spawn(
  process.execPath,
  [
    fileURLToPath(
      new URL("../api/node_modules/wrangler/bin/wrangler.js", import.meta.url),
    ),
    "deploy",
    "--dry-run",
    "--outdir",
    "dist",
  ],
  {
    cwd: api,
    stdio: "inherit",
    env: { ...process.env, CLOUDFLARE_SEND_METRICS: "false" },
  },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
