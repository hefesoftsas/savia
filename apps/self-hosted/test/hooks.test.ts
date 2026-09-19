import { describe, expect, it, vi } from "vitest";
import { createNodeHookExecutor } from "../src/hooks";
import { hook } from "../../savia-request/src/server/hooks";

describe("isolated hooks", () => {
  const executor = createNodeHookExecutor({ timeoutMs: 1500, cpuMs: 100 });
  it("preserves request/response variables through the injected executor", async () => {
    const result = await hook(
      { HOOK_EXECUTOR: executor } as never,
      'req.setBody(req.getBody()+bru.getEnvVar("suffix")); bru.setVar("answer", JSON.parse(res.getBody()).answer);',
      {
        body: "hello",
        values: { suffix: " world" },
        response: '{"answer":42}',
      },
    );
    expect(result).toEqual({
      body: "hello world",
      variables: { answer: "42" },
    });
  });
  it("keeps the Cloudflare loader path and isolation options as the default", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ body: "done", variables: { x: "1" } }),
    );
    const load = vi.fn((_options: { modules: Record<string, string> }) => ({
      getEntrypoint: () => ({ fetch }),
    }));
    expect(
      await hook({ LOADER: { load } } as never, 'bru.setVar("x",1)', {
        body: "",
        values: {},
      }),
    ).toEqual({ body: "done", variables: { x: "1" } });
    expect(load).toHaveBeenCalledWith(
      expect.objectContaining({
        globalOutbound: null,
        limits: { cpuMs: 100, subRequests: 0 },
      }),
    );
    expect(load.mock.calls[0][0].modules["hook.js"]).toContain(
      'bru.setVar("x",1)',
    );
  });
  it("limits concurrent workers and releases capacity on completion", async () => {
    const single = createNodeHookExecutor({ maxConcurrent: 1 });
    const pending = single.execute("bru.setVar('ok',1)", {
      body: "",
      values: {},
    });
    await expect(single.execute("", { body: "", values: {} })).rejects.toThrow(
      /capacity/i,
    );
    await pending;
    await expect(single.execute("", { body: "", values: {} })).resolves.toEqual(
      { body: "", variables: {} },
    );
  });
  it("rejects malformed code and script errors", async () => {
    await expect(
      executor.execute("const = ;", { body: "", values: {} }),
    ).rejects.toThrow();
    await expect(
      executor.execute('throw new Error("secret")', { body: "", values: {} }),
    ).rejects.toThrow();
  });
  it("provides no host, filesystem, network, or Node globals", async () => {
    const result = await executor.execute(
      "req.setBody(JSON.stringify([typeof process,typeof require,typeof fetch,typeof WebSocket,typeof Deno,typeof Bun]));",
      { body: "", values: {} },
    );
    expect(JSON.parse(result.body)).toEqual(Array(6).fill("undefined"));
    await expect(
      executor.execute('await fetch("https://example.com")', {
        body: "",
        values: {},
      }),
    ).rejects.toThrow();
    await expect(
      executor.execute('await import("node:fs")', { body: "", values: {} }),
    ).rejects.toThrow();
  });
  it("interrupts endless execution and still accepts subsequent requests", async () => {
    await expect(
      executor.execute("while(true) {}", { body: "", values: {} }),
    ).rejects.toThrow();
    expect(
      await executor.execute('bru.setVar("ok",true)', { body: "", values: {} }),
    ).toEqual({ body: "", variables: { ok: "true" } });
  });
  it("terminates a worker at the wall deadline", async () => {
    const short = createNodeHookExecutor({ timeoutMs: 1 });
    await expect(
      short.execute("while(true) {}", { body: "", values: {} }),
    ).rejects.toThrow(/timed out/i);
  });
  it("rejects excessive input and memory growth", async () => {
    await expect(
      executor.execute(" ".repeat(1_100_000), { body: "", values: {} }),
    ).rejects.toThrow(/large/i);
    await expect(
      executor.execute('const a=[];while(true)a.push("x".repeat(100000));', {
        body: "",
        values: {},
      }),
    ).rejects.toThrow();
  });
});
