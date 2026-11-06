import { describe, expect, it } from "vitest";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core";
import variant from "@jitl/quickjs-wasmfile-release-sync";
import { createQuickJSExecutor } from "../src/executor";

const engine = newQuickJSWASMModuleFromVariant(variant);
const execute = createQuickJSExecutor(() => engine, {
  maxInterrupts: 20,
  maxPendingJobs: 100,
});
const empty = { body: "", values: {} };

describe("QuickJS guest execution", () => {
  it("preserves the request/response/variable contract", async () => {
    expect(
      await execute(
        'req.setBody(req.getBody()+bru.getEnvVar("suffix"));bru.setVar("answer",JSON.parse(res.getBody()).answer);',
        {
          body: "hello",
          values: { suffix: " world" },
          response: '{"answer":42}',
        },
      ),
    ).toEqual({ body: "hello world", variables: { answer: "42" } });
  });
  it("accepts an existing two-million-character provider response", async () => {
    const response = "x".repeat(2_000_000);
    expect(
      await execute('bru.setVar("length",res.getBody().length)', {
        ...empty,
        response,
      }),
    ).toEqual({ body: "", variables: { length: "2000000" } });
  });
  it("isolates guest globals and prototype mutation across calls", async () => {
    await execute(
      'globalThis.secret="synthetic";Object.prototype.polluted=1;',
      empty,
    );
    expect(
      (
        await execute(
          'req.setBody(typeof globalThis.secret+":"+typeof ({}).polluted)',
          empty,
        )
      ).body,
    ).toBe("undefined:undefined");
  });
  it("provides no host APIs or host-backed callbacks", async () => {
    expect(
      (
        await execute(
          'req.setBody([typeof process,typeof require,typeof fetch,typeof crypto,typeof setTimeout].join(","))',
          empty,
        )
      ).body,
    ).toBe(Array(5).fill("undefined").join(","));
    await expect(execute('await import("node:fs")', empty)).rejects.toThrow();
    await expect(
      execute('await fetch("https://example.invalid")', empty),
    ).rejects.toThrow();
  });
  it.each([
    "const = ;",
    'throw new Error("synthetic private error")',
    "while(true){}",
    "await new Promise(()=>{})",
    "await new Promise(()=>{function f(){Promise.resolve().then(f)}f()})",
    "new ArrayBuffer(32*1024*1024)",
    'req.setBody("x".repeat(3*1024*1024))',
    'Object.defineProperty(variables,"x",{enumerable:true,get(){while(true){}}});',
  ])("rejects bad script and recovers: %s", async (code) => {
    await expect(execute(code, empty)).rejects.toThrow();
    expect((await execute('bru.setVar("ok",1)', empty)).variables.ok).toBe("1");
  });
  it("keeps concurrent payloads separate", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        execute('bru.setVar("id",bru.getVar("id"))', {
          body: "",
          values: { id: String(i) },
        }),
      ),
    );
    expect(results.map((x) => x.variables.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => String(i)),
    );
  });
});
