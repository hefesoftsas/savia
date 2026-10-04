import type { QuickJSWASMModule } from "quickjs-emscripten-core";
import type {
  HookPayload,
  HookResult,
} from "../../savia-request/src/server/env";
import {
  hookExecutionSource,
  isHookResult,
} from "../../savia-request/src/server/hooks";
import {
  MAX_CODE_BYTES,
  MAX_INPUT_BYTES,
  MAX_OUTPUT_BYTES,
  GUEST_MEMORY_BYTES,
  GUEST_STACK_BYTES,
  MAX_INTERRUPTS,
  MAX_PENDING_JOBS,
} from "./limits";

const encoder = new TextEncoder();

export function createQuickJSExecutor(
  loadEngine: () => Promise<QuickJSWASMModule>,
  options: { maxInterrupts?: number; maxPendingJobs?: number } = {},
) {
  return async (code: string, payload: HookPayload): Promise<HookResult> => {
    const serialized = JSON.stringify(payload);
    if (
      encoder.encode(code).length > MAX_CODE_BYTES ||
      encoder.encode(serialized).length > MAX_INPUT_BYTES
    )
      throw new Error("Hook input limit");
    const engine = await loadEngine();
    // Only the immutable engine is cached. Each invocation has a fresh guest heap.
    const runtime = engine.newRuntime();
    runtime.setMemoryLimit(GUEST_MEMORY_BYTES);
    runtime.setMaxStackSize(GUEST_STACK_BYTES);
    let interrupts = 0;
    runtime.setInterruptHandler(
      () => ++interrupts > (options.maxInterrupts ?? MAX_INTERRUPTS),
    );
    const context = runtime.newContext();
    try {
      // Pass serialized data as a guest string, never host objects/functions.
      // Avoid embedding JSON into source, which doubles escaping and memory.
      const input = context.newString(serialized);
      context.setProp(context.global, "__hookInput", input);
      input.dispose();
      const evaluated = context.evalCode(
        `(async()=>{const data=JSON.parse(globalThis.__hookInput);delete globalThis.__hookInput;${hookExecutionSource(code)}})()`,
        "hook.js",
      );
      if (evaluated.error) {
        evaluated.error.dispose();
        throw new Error("Hook rejected");
      }
      try {
        let jobs = 0;
        while (runtime.hasPendingJob()) {
          if (++jobs > (options.maxPendingJobs ?? MAX_PENDING_JOBS))
            throw new Error("Hook job limit");
          const executed = runtime.executePendingJobs(1);
          if (executed.error) {
            executed.error.dispose();
            throw new Error("Hook rejected");
          }
        }
        const state = context.getPromiseState(evaluated.value);
        if (state.type !== "fulfilled") {
          if (state.type === "rejected") state.error.dispose();
          throw new Error("Hook did not complete");
        }
        try {
          context.setProp(context.global, "__hookResult", state.value);
          // Serialization/getters run inside QuickJS, under the same guest limits.
          const serializedResult = context.evalCode(
            "JSON.stringify(globalThis.__hookResult)",
          );
          if (serializedResult.error) {
            serializedResult.error.dispose();
            throw new Error("Hook result rejected");
          }
          try {
            if (context.typeof(serializedResult.value) !== "string")
              throw new Error("Invalid hook output");
            const json = context.getString(serializedResult.value);
            if (encoder.encode(json).length > MAX_OUTPUT_BYTES)
              throw new Error("Hook output limit");
            const result: unknown = JSON.parse(json);
            if (!isHookResult(result)) throw new Error("Invalid hook output");
            return result;
          } finally {
            serializedResult.value.dispose();
          }
        } finally {
          state.value.dispose();
        }
      } finally {
        evaluated.value.dispose();
      }
    } finally {
      context.dispose();
      runtime.dispose();
    }
  };
}
