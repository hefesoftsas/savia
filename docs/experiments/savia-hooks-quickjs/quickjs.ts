// Feasibility probe only. Not wired into Savia or production configuration.
import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
} from "quickjs-emscripten-core";
import variant from "@jitl/quickjs-wasmfile-release-sync";
import wasm from "./quickjs.wasm";
import { hookExecutionSource } from "../../../apps/savia-request/src/server/hooks";

let enginePromise;
const encoder = new TextEncoder();
export async function execute(code, payload, options = {}) {
  if (!code.trim()) return { body: payload.body, variables: {} };
  if (
    encoder.encode(code).length +
      encoder.encode(JSON.stringify(payload)).length >
    1024 * 1024
  )
    throw new Error("input-limit");
  enginePromise ??= newQuickJSWASMModuleFromVariant(
    newVariant(variant, { wasmModule: wasm }),
  );
  const engine = await enginePromise;
  const runtime = engine.newRuntime();
  runtime.setMemoryLimit(16 * 1024 * 1024);
  runtime.setMaxStackSize(256 * 1024);
  // Date.now() does not advance during synchronous execution in Workers.
  // A deterministic interrupt budget is required, not the Node deadline alone.
  let interrupts = 0;
  const maxInterrupts = options.maxInterrupts ?? 1000;
  runtime.setInterruptHandler(() => ++interrupts > maxInterrupts);
  const context = runtime.newContext();
  try {
    const source = `(async()=>{const data=JSON.parse(${JSON.stringify(JSON.stringify(payload))});${hookExecutionSource(code)}})()`;
    const evaluated = context.evalCode(source, "hook.js");
    if (evaluated.error) {
      evaluated.error.dispose();
      throw new Error("evaluation-rejected");
    }
    try {
      let jobs = 0;
      while (runtime.hasPendingJob()) {
        if (++jobs > 1000) throw new Error("job-limit");
        const executed = runtime.executePendingJobs(1);
        if (executed.error) {
          executed.error.dispose();
          throw new Error("job-rejected");
        }
      }
      const state = context.getPromiseState(evaluated.value);
      if (state.type !== "fulfilled") {
        if (state.type === "rejected") state.error.dispose();
        throw new Error("hook-rejected");
      }
      try {
        // Serialize inside the guest so toJSON/getters also run under its budget.
        context.setProp(context.global, "__probeResult", state.value);
        const serialized = context.evalCode("JSON.stringify(__probeResult)");
        if (serialized.error) {
          serialized.error.dispose();
          throw new Error("serialization-rejected");
        }
        try {
          const json = context.getString(serialized.value);
          if (encoder.encode(json).length > 1024 * 1024)
            throw new Error("output-limit");
          const result = JSON.parse(json);
          if (
            typeof result?.body !== "string" ||
            !result.variables ||
            typeof result.variables !== "object" ||
            Array.isArray(result.variables) ||
            !Object.values(result.variables).every(
              (value) => typeof value === "string",
            )
          )
            throw new Error("invalid-output");
          return result;
        } finally {
          serialized.value.dispose();
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
}
