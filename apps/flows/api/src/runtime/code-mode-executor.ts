/**
 * Flows adapter for the private QuickJS executor Worker. User source and tool
 * values cross the service boundary only as strings; callbacks stay in this
 * Worker and are limited to the function map supplied by the caller.
 */

import { RpcTarget } from "cloudflare:workers";

import {
  type CodeModeExecutor,
  type CodeModeOptions,
  type CodeModeResult,
} from "@savia/flows-runtime/utils/code-mode";

import type { Bindings } from "../context";

const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_TOOL_ARGUMENT_BYTES = 256 * 1024;
const MAX_TOOL_RESULT_BYTES = 2 * 1024 * 1024;
const MAX_TOOL_ERROR_LENGTH = 1024;

interface FlowExecutionResult {
  result?: unknown;
  error?: string;
  logs?: string[];
}

interface FlowsExecutorService {
  execute(
    code: string,
    dispatcher: ToolDispatcher,
    options?: { timeoutMs?: number },
  ): Promise<FlowExecutionResult>;
}

// ── JSON-only RPC target for tool calls from QuickJS → host ─────────────

class ToolDispatcher extends RpcTarget {
  #fns: Record<string, (...args: unknown[]) => Promise<unknown>>;
  #encoder = new TextEncoder();

  constructor(fns: Record<string, (...args: unknown[]) => Promise<unknown>>) {
    super();
    this.#fns = fns;
  }

  async call(name: string, argsJson: string): Promise<string> {
    if (!Object.hasOwn(this.#fns, name) || typeof this.#fns[name] !== "function")
      return this.#error(`Tool "${safeToolName(name)}" not found`);

    if (typeof argsJson !== "string")
      return this.#error("Tool arguments must be JSON text");
    if (
      argsJson.length > MAX_TOOL_ARGUMENT_BYTES ||
      this.#encoder.encode(argsJson).byteLength > MAX_TOOL_ARGUMENT_BYTES
    )
      return this.#error("Tool arguments exceed the size limit");

    let args: unknown;
    try {
      args = argsJson ? JSON.parse(argsJson) : {};
    } catch {
      return this.#error("Tool arguments are not valid JSON");
    }

    try {
      const result = await this.#fns[name](args);
      const serialized = JSON.stringify({ result });
      if (typeof serialized !== "string")
        return this.#error("Tool result could not be serialized as JSON");
      if (
        serialized.length > MAX_TOOL_RESULT_BYTES ||
        this.#encoder.encode(serialized).byteLength > MAX_TOOL_RESULT_BYTES
      )
        return this.#error("Tool result exceeds the size limit");
      return serialized;
    } catch (error) {
      return this.#error(safeErrorMessage(error));
    }
  }

  #error(message: string): string {
    return JSON.stringify({ error: message.slice(0, MAX_TOOL_ERROR_LENGTH) });
  }
}

function safeToolName(name: unknown): string {
  if (typeof name !== "string") return "<invalid name>";
  return name.slice(0, 128);
}

function safeErrorMessage(_error: unknown): string {
  // Tool exceptions can contain secret values or internal implementation
  // details. Keep their text inside the trusted Worker.
  return "Tool call failed";
}

class QuickJsCodeModeExecutor implements CodeModeExecutor {
  #service: FlowsExecutorService;
  #defaultTimeout: number;
  #encoder = new TextEncoder();

  constructor(service: FlowsExecutorService, defaultTimeout = 30_000) {
    this.#service = service;
    this.#defaultTimeout = defaultTimeout;
  }

  async execute(
    code: string,
    fns: Record<string, (...args: unknown[]) => Promise<unknown>>,
    options?: CodeModeOptions,
  ): Promise<CodeModeResult> {
    if (
      code.length > MAX_SOURCE_BYTES ||
      this.#encoder.encode(code).byteLength > MAX_SOURCE_BYTES
    ) {
      return { result: undefined, error: "Execution source exceeds the size limit" };
    }

    const response = await this.#service.execute(
      code,
      new ToolDispatcher(fns),
      { timeoutMs: options?.timeoutMs ?? this.#defaultTimeout },
    );
    return {
      result: response.result,
      error: response.error,
      logs: response.logs,
    };
  }
}

/** Return no executor when the named private service is missing; never create a fallback runtime. */
export function createCodeModeExecutor(env: Bindings): CodeModeExecutor | null {
  if (!env.CODE_EXECUTOR) return null;
  return new QuickJsCodeModeExecutor(env.CODE_EXECUTOR);
}
