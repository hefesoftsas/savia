import type {
  QuickJSContext,
  QuickJSHandle,
  QuickJSDeferredPromise,
  QuickJSWASMModule,
} from "quickjs-emscripten-core";
import { createGuest } from "./guest";
import {
  CPU_LIMIT_MS,
  MAX_CODE_BYTES,
  MAX_OUTPUT_BYTES,
  MAX_PENDING_JOBS,
  GUEST_MEMORY_BYTES,
} from "./limits";

/** Workers RPC capability. The guest receives only JSON, never this object. */
export interface FlowToolDispatcher {
  call(name: string, argsJson: string): Promise<string>;
}

export interface FlowExecutionResult {
  result?: unknown;
  error?: string;
  logs?: string[];
}

const encoder = new TextEncoder();
const MAX_TOOL_CALLS = 128;
const MAX_CONCURRENT_TOOLS = 16;
// Reserve half of the allocator budget for the bridge's temporary FFI strings
// and cleanup. Filling the guest must never starve host export/error handling.
const SCRIPT_MEMORY_BYTES = GUEST_MEMORY_BYTES / 2;

function readGuestString(
  context: QuickJSContext,
  handle: QuickJSHandle,
  limit: number,
  message: string,
) {
  // getString allocates a guest C-string copy. Reject oversized strings before
  // that FFI allocation, which could exhaust the guest while exporting a value.
  const length = context.getProp(handle, "length");
  try {
    if (context.getNumber(length) > limit) throw new Error(message);
  } finally {
    length.dispose();
  }
  const text = context.getString(handle);
  if (encoder.encode(text).length > limit) throw new Error(message);
  return text;
}

function guestSource(code: string) {
  return `((__dispatch) => {
    delete globalThis.__saviaDispatch;
    const serialize = JSON.stringify.bind(JSON);
    const parse = JSON.parse.bind(JSON);
    const string = String;
    const charCodeAt = Function.call.bind(String.prototype.charCodeAt);
    const boundedSerialize = (value, failure = "Script output limit") => {
      const json = serialize(value);
      if (typeof json !== "string" || json.length > ${MAX_OUTPUT_BYTES})
        throw new Error(failure);
      let bytes = 0;
      for (let i = 0; i < json.length; i++) {
        const unit = charCodeAt(json, i);
        if (unit < 128) bytes++;
        else if (unit < 2048) bytes += 2;
        else if (unit >= 0xd800 && unit <= 0xdbff &&
          i + 1 < json.length && charCodeAt(json, i + 1) >= 0xdc00 && charCodeAt(json, i + 1) <= 0xdfff) {
          bytes += 4; i++;
        } else bytes += 3;
        if (bytes > ${MAX_OUTPUT_BYTES}) throw new Error(failure);
      }
      return json;
    };
    const logs = [];
    let logSize = 0;
    const log = (prefix, args) => {
      const line = prefix + args.map(String).join(" ");
      if (logs.length >= 1024 || (logSize += line.length) > ${MAX_OUTPUT_BYTES / 2})
        throw new Error("Console output limit");
      logs.push(line);
    };
    const console = {
      log: (...args) => log("", args),
      info: (...args) => log("", args),
      debug: (...args) => log("", args),
      warn: (...args) => log("[warn] ", args),
      error: (...args) => log("[error] ", args),
    };
    const codemode = new Proxy(Object.create(null), {
      get: (_, name) => async (args) => {
        const response = parse(await __dispatch(name, boundedSerialize(args ?? {}, "Tool argument limit")));
        if (response.error) throw new Error(String(response.error));
        return response.result;
      },
    });
    return {
      run: async () => {
        ${code}
      },
      output: (value, failed) => boundedSerialize(failed
        ? {error: string(value?.message ?? value), logs}
        : {result: value, logs}),
    };
  })(globalThis.__saviaDispatch)`;
}

/** Bounded ordinary-Worker execution, including async capability-scoped tools. */
export function createFlowExecutor(
  loadEngine: () => Promise<QuickJSWASMModule>,
  budgets: { maxInterrupts?: number; maxPendingJobs?: number } = {},
) {
  return async (
    code: string,
    dispatcher: FlowToolDispatcher,
    options: { timeoutMs?: number } = {},
  ): Promise<FlowExecutionResult> => {
    const timeout = options?.timeoutMs ?? CPU_LIMIT_MS;
    if (!Number.isFinite(timeout) || timeout <= 0)
      return { error: "Invalid execution timeout", logs: [] };
    if (
      typeof code !== "string" ||
      code.length > MAX_CODE_BYTES ||
      encoder.encode(code).length > MAX_CODE_BYTES
    )
      return { error: "Script source limit", logs: [] };
    const engine = await loadEngine();
    const deadline = Date.now() + Math.min(timeout, CPU_LIMIT_MS);
    let closed = false;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = new Set<{
      deferred: QuickJSDeferredPromise;
      operation: Promise<void>;
    }>();
    const { runtime, context } = createGuest(engine, {
      ...budgets,
      // Workers clocks do not advance during synchronous Wasm; the interrupt
      // counter and configured platform CPU ceiling remain essential.
      interrupted: () => timedOut || Date.now() >= deadline,
    });
    runtime.setMemoryLimit(SCRIPT_MEMORY_BYTES);
    const bridgeAllocation = <T>(operation: () => T): T => {
      runtime.setMemoryLimit(GUEST_MEMORY_BYTES);
      try {
        return operation();
      } finally {
        runtime.setMemoryLimit(SCRIPT_MEMORY_BYTES);
      }
    };
    let calls = 0;
    try {
      const dispatch = context.newFunction(
        "dispatch",
        (nameHandle, argsHandle) =>
          bridgeAllocation(() => {
            if (
              closed ||
              timedOut ||
              Date.now() >= deadline ||
              context.typeof(nameHandle) !== "string" ||
              context.typeof(argsHandle) !== "string"
            )
              return { error: context.newError("Tool execution rejected") };
            let name: string;
            let argsJson: string;
            try {
              name = readGuestString(
                context,
                nameHandle,
                256,
                "Tool name limit",
              );
              argsJson = readGuestString(
                context,
                argsHandle,
                MAX_OUTPUT_BYTES,
                "Tool argument limit",
              );
            } catch {
              return { error: context.newError("Tool execution limit") };
            }
            if (
              name.length > 256 ||
              encoder.encode(argsJson).length > MAX_OUTPUT_BYTES ||
              ++calls > MAX_TOOL_CALLS ||
              pending.size >= MAX_CONCURRENT_TOOLS
            )
              return { error: context.newError("Tool execution limit") };
            const deferred = context.newPromise();
            const ticket = { deferred, operation: Promise.resolve() };
            pending.add(ticket);
            // Defer transport until the Wasm call stack unwinds. Only strings cross
            // this boundary, and a late completion never touches a disposed guest.
            ticket.operation = Promise.resolve().then(async () => {
              if (closed || timedOut) return;
              try {
                const response = await dispatcher.call(name, argsJson);
                if (closed || timedOut) return;
                if (
                  typeof response !== "string" ||
                  response.length > MAX_OUTPUT_BYTES ||
                  encoder.encode(response).length > MAX_OUTPUT_BYTES
                ) {
                  bridgeAllocation(() => {
                    const error = context.newError("Tool response limit");
                    try {
                      deferred.reject(error);
                    } finally {
                      error.dispose();
                    }
                  });
                } else {
                  bridgeAllocation(() => {
                    const value = context.newString(response);
                    try {
                      deferred.resolve(value);
                    } finally {
                      value.dispose();
                    }
                  });
                }
              } catch {
                if (closed || timedOut) return;
                bridgeAllocation(() => {
                  const error = context.newError("Tool execution failed");
                  try {
                    deferred.reject(error);
                  } finally {
                    error.dispose();
                  }
                });
              } finally {
                if (!closed) {
                  pending.delete(ticket);
                  deferred.dispose();
                }
              }
            });
            return deferred.handle.dup();
          }),
      );
      context.setProp(context.global, "__saviaDispatch", dispatch);
      dispatch.dispose();
      const bootstrap = context.evalCode(guestSource(code), "flow.js");
      if (bootstrap.error) {
        bootstrap.error.dispose();
        throw new Error("Script rejected or execution limit exceeded");
      }
      const run = context.getProp(bootstrap.value, "run");
      const output = context.getProp(bootstrap.value, "output");
      bootstrap.value.dispose();
      try {
        // Run source only once. Serialize after its promise settles: nesting
        // another async wrapper retained large results during QuickJS cleanup.
        const evaluated = context.callFunction(run, context.undefined);
        if (evaluated.error) {
          evaluated.error.dispose();
          throw new Error("Script rejected or execution limit exceeded");
        }
        try {
          const expired = new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => {
                timedOut = true;
                reject(new Error("Execution timed out"));
              },
              Math.min(timeout, CPU_LIMIT_MS),
            );
          });
          // Always attach a rejection handler, including when the guest settles
          // without awaiting a tool, so no timeout promise escapes this request.
          void expired.catch(() => {});
          let jobs = 0;
          for (;;) {
            if (timedOut || Date.now() >= deadline)
              throw new Error("Execution timed out");
            while (runtime.hasPendingJob()) {
              if (++jobs > (budgets.maxPendingJobs ?? MAX_PENDING_JOBS))
                throw new Error("Promise job limit");
              const job = runtime.executePendingJobs(1);
              if (job.error) {
                job.error.dispose();
                throw new Error("Script rejected or execution limit exceeded");
              }
            }
            const state = context.getPromiseState(evaluated.value);
            if (state.type !== "pending") {
              const value =
                state.type === "fulfilled" ? state.value : state.error;
              try {
                const serialized = context.callFunction(
                  output,
                  context.undefined,
                  value,
                  state.type === "rejected" ? context.true : context.false,
                );
                if (serialized.error) {
                  serialized.error.dispose();
                  throw new Error(
                    "Script output rejected or execution limit exceeded",
                  );
                }
                try {
                  if (context.typeof(serialized.value) !== "string")
                    throw new Error("Invalid script output");
                  const json = bridgeAllocation(() =>
                    readGuestString(
                      context,
                      serialized.value,
                      MAX_OUTPUT_BYTES,
                      "Script output limit",
                    ),
                  );
                  const result = JSON.parse(json) as FlowExecutionResult;
                  if (
                    !Array.isArray(result.logs) ||
                    !result.logs.every((line) => typeof line === "string") ||
                    (result.error !== undefined &&
                      typeof result.error !== "string")
                  )
                    throw new Error("Invalid script output");
                  return result;
                } finally {
                  serialized.value.dispose();
                }
              } finally {
                value.dispose();
              }
            }
            if (!pending.size) throw new Error("Execution did not complete");
            await Promise.race([
              expired,
              ...Array.from(pending, (ticket) => ticket.operation),
            ]);
          }
        } finally {
          evaluated.value.dispose();
        }
      } finally {
        run.dispose();
        output.dispose();
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Execution failed",
        logs: [],
      };
    } finally {
      closed = true;
      clearTimeout(timer);
      runtime.setMemoryLimit(GUEST_MEMORY_BYTES);
      for (const ticket of pending) ticket.deferred.dispose();
      pending.clear();
      context.dispose();
      runtime.dispose();
    }
  };
}
