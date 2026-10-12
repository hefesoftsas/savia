import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { NodeContext } from "@savia/flows-runtime";
import { CalculatorNode } from "@savia/flows-runtime/nodes/math/calculator-node";
import { JavascriptNode } from "@savia/flows-runtime/nodes/javascript/javascript-node";
import { JsonExecuteJavascriptNode } from "@savia/flows-runtime/nodes/json/json-execute-javascript-node";
import type { Node } from "@savia/flows-types";
import { createCodeModeExecutor } from "./code-mode-executor";

function executor() {
  const result = createCodeModeExecutor(
    env as unknown as Parameters<typeof createCodeModeExecutor>[0],
  );
  if (!result) throw new Error("CODE_EXECUTOR binding unavailable in test env");
  return result;
}

describe("QuickJS code mode through the private service binding", () => {
  it("executes JavaScript and preserves the result and console logs", async () => {
    const result = await executor().execute(
      'console.log("hello", "world"); console.warn("careful"); console.error("failed"); return 41 + 1;',
      {},
    );

    expect(result.error).toBeUndefined();
    expect(result.result).toBe(42);
    expect(result.logs).toEqual([
      "hello world",
      "[warn] careful",
      "[error] failed",
    ]);
  });

  it("keeps guest globals isolated between calls", async () => {
    const run = executor();
    await run.execute('globalThis.secret = "first call"; return null;', {});

    const result = await run.execute("return typeof globalThis.secret;", {});

    expect(result.error).toBeUndefined();
    expect(result.result).toBe("undefined");
  });

  it("runs sequential and concurrent tool callbacks through JSON RPC", async () => {
    const calls: string[] = [];
    const result = await executor().execute(
      "const first = await codemode.add({value: 1}); " +
        "const [second, third] = await Promise.all([" +
        "codemode.add({value: 2}), codemode.add({value: 3})]); " +
        "return first.total + second.total + third.total;",
      {
        add: async (arg) => {
          const value = (arg as { value: number }).value;
          calls.push(String(value));
          await Promise.resolve();
          return { total: value * 10 };
        },
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.result).toBe(60);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toBe("1");
    expect(new Set(calls.slice(1))).toEqual(new Set(["2", "3"]));
  });

  it("rejects unknown and inherited tool names", async () => {
    const called: string[] = [];
    const run = executor();

    for (const code of [
      "await codemode.missing({}); return true;",
      "await codemode.toString({}); return true;",
      "await codemode.constructor({}); return true;",
      "await codemode.__proto__({}); return true;",
    ]) {
      const result = await run.execute(code, {
        allowed: async () => {
          called.push("allowed");
          return true;
        },
      });

      expect(result.error).toMatch(/not found|unknown tool/i);
    }

    expect(called).toEqual([]);
  });

  it("times out a pending tool call and remains usable after the late callback", async () => {
    let finish: ((value: string) => void) | undefined;
    const run = executor();
    const timedOut = await run.execute(
      "await codemode.wait({}); return 'finished';",
      { wait: () => new Promise<string>((resolve) => (finish = resolve)) },
      { timeoutMs: 50 },
    );

    expect(timedOut.error).toMatch(/timed out/i);
    finish?.("late result");

    const recovered = await run.execute("return 'ready';", {});
    expect(recovered.error).toBeUndefined();
    expect(recovered.result).toBe("ready");
  });

  it("rejects oversized JSON tool responses before returning them to the guest", async () => {
    const result = await executor().execute(
      "await codemode.large({}); return 'finished';",
      { large: async () => "x".repeat(2 * 1024 * 1024 + 1) },
    );

    expect(result.error).toMatch(/size limit/i);
  });

  it("does not reveal private host exception messages to guest code", async () => {
    const result = await executor().execute(
      "await codemode.readSecret({}); return 'finished';",
      {
        readSecret: async () => {
          throw new Error("private-key=secret-value");
        },
      },
    );

    expect(result.error).toBe("Tool call failed");
    expect(result.error).not.toContain("secret-value");
  });

  it("keeps JavaScript, JSON transforms, and calculator nodes on the same executor", async () => {
    const codeModeExecutor = executor();
    const nodeContext = {
      nodeId: "real-executor-test",
      codeModeExecutor,
      inputs: {},
      getIntegration: async () => {
        throw new Error("No integrations in executor test");
      },
    } as unknown as NodeContext;

    const javascript = await new JavascriptNode({ nodeId: "javascript" } as unknown as Node).execute({
      ...nodeContext,
      inputs: { script: "args[0] * 2", args: [21] },
    });
    const json = await new JsonExecuteJavascriptNode({ nodeId: "json" } as unknown as Node).execute({
      ...nodeContext,
      inputs: { json: { amount: 21 }, javascript: "json.amount * 2" },
    });
    const calculator = await new CalculatorNode({ nodeId: "calculator" } as unknown as Node).execute({
      ...nodeContext,
      inputs: { expression: "sqrt(16) + 38" },
    });

    expect(javascript.outputs?.result).toBe(42);
    expect(json.outputs?.result).toBe(42);
    expect(calculator.outputs?.result).toBe(42);
  });
});
