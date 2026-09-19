import { Worker } from "node:worker_threads";
import type {
  HookExecutor,
  HookPayload,
  HookResult,
} from "../../savia-request/src/server/env";

export function createNodeHookExecutor(
  options: {
    timeoutMs?: number;
    cpuMs?: number;
    memoryBytes?: number;
    maxConcurrent?: number;
  } = {},
): HookExecutor {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const cpuMs = options.cpuMs ?? 100;
  const memoryBytes = options.memoryBytes ?? 16 * 1024 * 1024;
  const maxConcurrent = options.maxConcurrent ?? 4;
  let active = 0;
  return {
    async execute(code: string, payload: HookPayload): Promise<HookResult> {
      if (
        Buffer.byteLength(code) + Buffer.byteLength(JSON.stringify(payload)) >
        1024 * 1024
      )
        throw new Error("Hook input is too large.");
      if (active >= maxConcurrent)
        throw new Error("Hook execution capacity exceeded.");
      active++;
      try {
        return await new Promise<HookResult>((resolve, reject) => {
          // Node 22+ strips types in this standalone worker. QuickJS owns the guest
          // environment; workerData is serialized data, never a host callback.
          const worker = new Worker(
            new URL("./hook-worker.ts", import.meta.url),
            {
              workerData: { code, payload, cpuMs, memoryBytes },
              execArgv: ["--experimental-strip-types"],
              resourceLimits: {
                maxOldGenerationSizeMb: 64,
                maxYoungGenerationSizeMb: 16,
                stackSizeMb: 2,
              },
            },
          );
          let settled = false;
          const finish = (error?: Error, result?: HookResult) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            void worker.terminate().finally(() => {
              if (error) reject(error);
              else resolve(result!);
            });
          };
          const timer = setTimeout(
            () => finish(new Error("Hook execution timed out.")),
            timeoutMs,
          );
          worker.once("error", () =>
            finish(new Error("Hook execution failed.")),
          );
          worker.once("exit", () =>
            finish(new Error("Hook worker exited without a result.")),
          );
          worker.once(
            "message",
            (message: { result?: HookResult; error?: string }) => {
              if (
                message.error ||
                !message.result ||
                typeof message.result.body !== "string" ||
                !message.result.variables ||
                typeof message.result.variables !== "object" ||
                Array.isArray(message.result.variables) ||
                !Object.values(message.result.variables).every(
                  (value) => typeof value === "string",
                )
              )
                finish(
                  new Error(
                    "El hook rechazó los datos o la respuesta. Revisa los campos y el script.",
                  ),
                );
              else finish(undefined, message.result);
            },
          );
        });
      } finally {
        active--;
      }
    },
  };
}
