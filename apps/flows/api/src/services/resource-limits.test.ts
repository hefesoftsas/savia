import { describe, expect, it } from "vitest";

import {
  assertJsonWithinLimit,
  assertObjectWithinLimit,
  estimateJsonBytes,
  MAX_OBJECT_BYTES,
} from "./resource-limits";

describe("runtime resource limits", () => {
  it("estimates JSON payloads without serializing them", () => {
    expect(
      estimateJsonBytes({ text: "ok", values: [1, true] }, 100),
    ).toBeLessThan(100);
    expect(() => assertJsonWithinLimit("long", 5, "Input")).toThrow(
      "Input exceeds the 5-byte limit",
    );
  });

  it("counts shared references more than once and rejects cycles", () => {
    const shared = { value: "x" };
    expect(estimateJsonBytes([shared, shared], 100)).toBeGreaterThan(
      estimateJsonBytes([shared], 100),
    );

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => assertJsonWithinLimit(cyclic, 100, "Payload")).toThrow(
      "Payload exceeds the 100-byte limit",
    );
  });

  it("allows objects at the ceiling and rejects objects above it", () => {
    expect(() => assertObjectWithinLimit(MAX_OBJECT_BYTES)).not.toThrow();
    expect(() => assertObjectWithinLimit(MAX_OBJECT_BYTES + 1)).toThrow(
      `${MAX_OBJECT_BYTES}-byte limit`,
    );
  });
});
