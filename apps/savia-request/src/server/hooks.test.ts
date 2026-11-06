import { describe, expect, it, vi } from "vitest";
import { hook } from "./hooks";
import type { Env } from "./env";

describe("private hook service", () => {
  it("sends only code and payload to the private executor", async () => {
    const fetch = vi.fn(async (request: Request) => {
      expect(request.url).toBe("https://savia-hook-executor.internal/execute");
      expect(request.method).toBe("POST");
      expect(await request.json()).toEqual({
        code: 'bru.setVar("x",42)',
        payload: { body: "hello", values: {} },
      });
      expect(request.headers.has("authorization")).toBe(false);
      return Response.json({ body: "done", variables: { x: "42" } });
    });
    const result = await hook(
      { HOOK_SERVICE: { fetch } } as unknown as Env,
      'bru.setVar("x",42)',
      { body: "hello", values: {} },
    );
    expect(result).toEqual({ body: "done", variables: { x: "42" } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("skips the executor for empty hooks", async () => {
    expect(await hook({} as Env, " \n", { body: "body", values: {} })).toEqual({
      body: "body",
      variables: {},
    });
  });

  it("fails closed if the service is absent", async () => {
    await expect(
      hook({} as Env, "1", { body: "", values: {} }),
    ).rejects.toThrow("Hook executor is not configured.");
  });

  it.each([
    { body: "", variables: [] },
    { body: "", variables: { x: 1 } },
    { body: 123, variables: {} },
    null,
  ])("rejects malformed service output %j", async (output) => {
    const env = {
      HOOK_SERVICE: { fetch: async () => Response.json(output) },
    } as unknown as Env;
    await expect(hook(env, "1", { body: "", values: {} })).rejects.toThrow(
      "Salida del hook inválida.",
    );
  });

  it("redacts downstream failure details", async () => {
    const env = {
      HOOK_SERVICE: {
        fetch: async () =>
          new Response("sensitive guest detail", { status: 500 }),
      },
    } as unknown as Env;
    await expect(hook(env, "1", { body: "", values: {} })).rejects.toThrow(
      "El hook",
    );
  });

  it("allows the full CPU budget before its 35-second wall timeout", async () => {
    vi.useFakeTimers();
    try {
      const env = {
        HOOK_SERVICE: { fetch: () => new Promise(() => {}) },
      } as unknown as Env;
      const result = hook(env, "1", { body: "", values: {} });
      const rejected = expect(result).rejects.toThrow("El hook");
      let settled = false;
      void result.catch(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(5_000);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });
});
