import { describe, expect, it } from "vitest";

import {
  assertRuntimeValueWithinLimit,
  estimateRuntimeJsonBytes,
  MAX_RUNTIME_INPUT_BYTES,
  MAX_RUNTIME_OUTPUT_BYTES,
} from "./resource-limits";

describe("runtime payload bounds", () => {
  it("sets conservative input and output ceilings", () => {
    expect(MAX_RUNTIME_INPUT_BYTES).toBe(2 * 1024 * 1024);
    expect(MAX_RUNTIME_OUTPUT_BYTES).toBe(2 * 1024 * 1024);
  });

  it("accepts bounded JSON and rejects oversized values without serialization", () => {
    expect(() =>
      assertRuntimeValueWithinLimit({ ok: true }, 100, "Value"),
    ).not.toThrow();
    expect(() =>
      assertRuntimeValueWithinLimit("x".repeat(25), 20, "Node output"),
    ).toThrow("Node output exceeds the 20-byte limit");
  });

  it("counts UTF-8, JSON escapes, dates and lone surrogates accurately", () => {
    const value = {
      text: '\u0001\n"🙂é\ud800',
      date: new Date("2026-10-13T00:00:00Z"),
    };
    expect(estimateRuntimeJsonBytes(value, 1000)).toBe(
      new TextEncoder().encode(JSON.stringify(value)).byteLength,
    );
  });

  it("stops before visiting all children of a large array", () => {
    let reads = 0;
    const values = new Proxy(new Array(1_000_000), {
      get(target, key, receiver) {
        if (typeof key === "string" && /^\d+$/.test(key)) {
          reads++;
          return "x";
        }
        return Reflect.get(target, key, receiver);
      },
    });
    expect(() => assertRuntimeValueWithinLimit(values, 20, "Value")).toThrow(
      "limit",
    );
    expect(reads).toBeLessThan(10);
  });

  it("allows repeated references while rejecting cycles", () => {
    const shared = { value: "x" };
    expect(() =>
      assertRuntimeValueWithinLimit([shared, shared], 100, "Value"),
    ).not.toThrow();

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() =>
      assertRuntimeValueWithinLimit(cyclic, 100, "Workflow input"),
    ).toThrow("Workflow input exceeds the 100-byte limit");
  });
});
