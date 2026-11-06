import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
const executorRoot = fileURLToPath(new URL("../../hook-executor", import.meta.url));

/** Build and return the actual shared executor Worker plus its Wasm modules. */
export async function buildQuickJsExecutorWorker() {
  const outdir = join(executorRoot, "dist");
  const wrangler = join(executorRoot, "node_modules/wrangler/bin/wrangler.js");
  await execFileAsync(
    process.execPath,
    [wrangler, "deploy", "--dry-run", "--outdir", outdir],
    {
      cwd: executorRoot,
      env: { ...process.env, CLOUDFLARE_SEND_METRICS: "false" },
    },
  );

  const assets = await readdir(outdir);
  const entrypoint = join(outdir, "index.js");
  const wasmFiles = assets.filter((name) => name.endsWith(".wasm"));
  if (wasmFiles.length === 0)
    throw new Error("QuickJS executor dry run did not emit its Wasm module");

  return {
    name: "savia-hook-executor",
    // The pinned Vitest pool's workerd tops out at this date. The Worker uses
    // no newer platform APIs; Wrangler retains the executor's production date.
    compatibilityDate: "2026-08-06",
    modulesRoot: outdir,
    modules: [
      { type: "ESModule", path: entrypoint },
      ...wasmFiles.map((name) => ({
        type: "CompiledWasm",
        path: join(outdir, name),
      })),
    ],
    limits: { cpuMs: 30_000 },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await buildQuickJsExecutorWorker();
}
