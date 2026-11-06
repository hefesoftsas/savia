import { describe, expect, it } from "vitest";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core";
import variant from "@jitl/quickjs-wasmfile-release-sync";
import {
  createFlowExecutor,
  type FlowToolDispatcher,
} from "../src/flow-executor";

const engine = newQuickJSWASMModuleFromVariant(variant);
const execute = createFlowExecutor(() => engine, {
  maxInterrupts: 20,
  maxPendingJobs: 1_000,
});
const noTools: FlowToolDispatcher = {
  async call() {
    return JSON.stringify({ error: "Tool not found" });
  },
};

describe("Flows QuickJS guests", () => {
  it("returns JSON values and captures the existing console prefixes", async () => {
    expect(
      await execute(
        'console.log("hello", 2); console.warn("warning"); console.error("error"); return {answer: 42};',
        noTools,
      ),
    ).toEqual({
      result: { answer: 42 },
      logs: ["hello 2", "[warn] warning", "[error] error"],
    });
    expect(await execute("return undefined;", noTools)).toEqual({ logs: [] });
  });

  it("resolves sequential and concurrent tools through serialized arguments", async () => {
    const dispatcher: FlowToolDispatcher = {
      async call(name, argsJson) {
        if (name !== "double")
          return JSON.stringify({ error: "Tool not found" });
        const { value } = JSON.parse(argsJson);
        await Promise.resolve();
        return JSON.stringify({ result: { value: value * 2 } });
      },
    };
    expect(
      await execute(
        "const first = await codemode.double({value: 2}); const pair = await Promise.all([codemode.double(first), codemode.double({value: 3})]); return pair;",
        dispatcher,
      ),
    ).toEqual({ result: [{ value: 8 }, { value: 6 }], logs: [] });
  });

  it("reports unknown tools and transport failures without leaking host errors", async () => {
    expect(
      (await execute("return await codemode.missing({});", noTools)).error,
    ).toMatch(/Tool not found/);
    const failing: FlowToolDispatcher = {
      async call() {
        throw new Error("private host credential");
      },
    };
    const result = await execute("return await codemode.test({});", failing);
    expect(result.error).toMatch(/Tool execution failed/);
    expect(JSON.stringify(result)).not.toContain("private host credential");
  });

  it("isolates globals and prototypes across guests", async () => {
    await execute(
      'globalThis.secret="first"; Object.prototype.polluted=1;',
      noTools,
    );
    expect(
      await execute(
        "return [typeof globalThis.secret, typeof ({}).polluted];",
        noTools,
      ),
    ).toEqual({ result: ["undefined", "undefined"], logs: [] });
  });

  it("has no network, timers, filesystem, or application bindings", async () => {
    expect(
      await execute(
        "return [typeof fetch, typeof setTimeout, typeof process, typeof require, typeof env, typeof crypto];",
        noTools,
      ),
    ).toEqual({ result: Array(6).fill("undefined"), logs: [] });
    expect(
      (await execute('await import("node:fs");', noTools)).error,
    ).toBeTruthy();
  });

  it.each([
    "const = ;",
    'throw new Error("script failure")',
    "while(true){}",
    "await new Promise(()=>{})",
    "await new Promise(()=>{function f(){Promise.resolve().then(f)}f()})",
    "new ArrayBuffer(32*1024*1024)",
    'return "x".repeat(3*1024*1024)',
    'return await (async()=>"x".repeat(3*1024*1024))()',
    "return {get x(){while(true){}}}",
    'console.log("x".repeat(3*1024*1024));',
  ])("rejects a broken or excessive script and recovers: %s", async (code) => {
    const result = await execute(code, noTools);
    expect(result.error).toBeTruthy();
    expect(await execute("return 42;", noTools)).toEqual({
      result: 42,
      logs: [],
    });
  });

  it("rejects excessive source before guest creation", async () => {
    expect((await execute(" ".repeat(300_000), noTools)).error).toMatch(
      /source.*limit/i,
    );
  });

  it("reclaims large results and rejects UTF-8 output above the byte budget", async () => {
    const run = createFlowExecutor(() => engine);
    for (let i = 0; i < 4; i++) {
      const result = await run('return "x".repeat(512*1024)', noTools);
      expect((result.result as string).length).toBe(512 * 1024);
      expect(result.error).toBeUndefined();
      expect(
        (await run('return "界".repeat(750000)', noTools)).error,
      ).toBeTruthy();
    }
    expect(await run("return 42;", noTools)).toEqual({ result: 42, logs: [] });
  });

  it("rejects a guest allocation that consumes bridge headroom and recovers", async () => {
    const run = createFlowExecutor(() => engine);
    const dispatcher: FlowToolDispatcher = {
      async call() {
        return JSON.stringify({ result: "x".repeat(1024 * 1024) });
      },
    };
    const result = await run(
      "globalThis.retained = new ArrayBuffer(15*1024*1024); return await codemode.large({});",
      dispatcher,
    );
    expect(result.error).toBeTruthy();
    expect(await run("return 42;", noTools)).toEqual({ result: 42, logs: [] });
  });

  it("keeps cached-engine tool calls recoverable near the script memory limit", async () => {
    const run = createFlowExecutor(() => engine);
    const dispatcher: FlowToolDispatcher = {
      async call() {
        return JSON.stringify({ result: "x".repeat(1024 * 1024) });
      },
    };
    for (const mib of [6, 7, 8, 6]) {
      const result = await run(
        `globalThis.retained = new ArrayBuffer(${mib}*1024*1024); return await codemode.large({});`,
        dispatcher,
      );
      // A limit rejection is valid under pressure; a lost value or interpreter
      // abort is not. Each following request must start with a clean heap.
      if (result.error) expect(result.error).toBeTypeOf("string");
      else expect((result.result as string).length).toBe(1024 * 1024);
      expect(await run("return 42;", noTools)).toEqual({
        result: 42,
        logs: [],
      });
    }
  });

  it("bounds tool arguments before the authorized operation runs", async () => {
    let operations = 0;
    const dispatcher: FlowToolDispatcher = {
      async call() {
        operations++;
        return '{"result":true}';
      },
    };
    expect(
      (
        await execute(
          'await codemode.write({value:"x".repeat(3*1024*1024)});',
          dispatcher,
        )
      ).error,
    ).toMatch(/tool.*limit/i);
    expect(operations).toBe(0);
  });

  it("bounds tool responses and total tool calls", async () => {
    const oversized: FlowToolDispatcher = {
      async call() {
        return JSON.stringify({ result: "x".repeat(3 * 1024 * 1024) });
      },
    };
    expect(
      (await execute("return await codemode.read({});", oversized)).error,
    ).toMatch(/tool.*limit/i);
    let operations = 0;
    const dispatcher: FlowToolDispatcher = {
      async call() {
        operations++;
        return '{"result":true}';
      },
    };
    expect(
      (
        await execute(
          "for(let i=0;i<130;i++) await codemode.write({});",
          dispatcher,
        )
      ).error,
    ).toMatch(/tool.*limit/i);
    expect(operations).toBe(128);
  });

  it("times out pending tools and safely ignores late completions", async () => {
    let complete!: (value: string) => void;
    const dispatcher: FlowToolDispatcher = {
      call() {
        return new Promise((resolve) => {
          complete = resolve;
        });
      },
    };
    const result = await execute(
      "return await codemode.pending({});",
      dispatcher,
      { timeoutMs: 10 },
    );
    expect(result.error).toMatch(/timed out/i);
    complete('{"result":"late"}');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await execute("return 42;", noTools)).toEqual({
      result: 42,
      logs: [],
    });
  });

  it("does not keep an unawaited tool callback alive after returning", async () => {
    let complete!: (value: string) => void;
    const dispatcher: FlowToolDispatcher = {
      call() {
        return new Promise((resolve) => {
          complete = resolve;
        });
      },
    };
    expect(
      await execute("codemode.pending({}); return 42;", dispatcher),
    ).toEqual({ result: 42, logs: [] });
    // An operation may already have started, but completion must not touch a dead guest.
    complete?.('{"result":"late"}');
    await Promise.resolve();
    expect(await execute("return 1;", noTools)).toEqual({
      result: 1,
      logs: [],
    });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid timeout %s",
    async (timeoutMs) => {
      expect(
        (await execute("return 1;", noTools, { timeoutMs })).error,
      ).toMatch(/timeout/i);
    },
  );
});
