import { parentPort, workerData } from "node:worker_threads";
import { getQuickJS } from "quickjs-emscripten";
import { hookExecutionSource } from "../../savia-request/src/server/hooks.ts";

// Guest source is evaluated only by the WASM engine. No host functions, module
// loader, network, process, timers, or filesystem are installed in its context.
const { code, payload, cpuMs, memoryBytes } = workerData;
try {
  const engine = await getQuickJS();
  const runtime = engine.newRuntime();
  runtime.setMemoryLimit(memoryBytes);
  runtime.setMaxStackSize(256 * 1024);
  const deadline = Date.now() + cpuMs;
  runtime.setInterruptHandler(() => Date.now() >= deadline);
  const context = runtime.newContext();
  try {
    const source = `(async()=>{const data=JSON.parse(${JSON.stringify(JSON.stringify(payload))});${hookExecutionSource(code)}})()`;
    const evaluated = context.evalCode(source, "hook.js");
    if (evaluated.error) {
      evaluated.error.dispose();
      throw new Error("Hook rejected");
    }
    try {
      while (runtime.hasPendingJob()) {
        if (Date.now() >= deadline) throw new Error("Hook deadline exceeded");
        const jobs = runtime.executePendingJobs(1);
        if (jobs.error) {
          jobs.error.dispose();
          throw new Error("Hook rejected");
        }
      }
      const state = context.getPromiseState(evaluated.value);
      if (state.type === "fulfilled") {
        try {
          const result = context.dump(state.value);
          if (Buffer.byteLength(JSON.stringify(result)) > 1024 * 1024)
            throw new Error("Hook output too large");
          parentPort!.postMessage({ result });
        } finally {
          state.value.dispose();
        }
      } else {
        if (state.type === "rejected") state.error.dispose();
        throw new Error("Hook did not complete");
      }
    } finally {
      evaluated.value.dispose();
    }
  } finally {
    context.dispose();
    runtime.dispose();
  }
} catch {
  parentPort!.postMessage({ error: "Hook execution failed" });
}
