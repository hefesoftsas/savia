import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseRenderArgs } from "./render-from-outputs.mjs";

describe("pulumi render-from-outputs", () => {
  it("accepts preview and production stacks", () => {
    assert.equal(parseRenderArgs(["--stack", "preview"]).stack, "preview");
    assert.equal(
      parseRenderArgs(["--stack", "production"]).stack,
      "production",
    );
  });

  it("rejects missing and unknown stacks", () => {
    assert.throws(() => parseRenderArgs([]));
    assert.throws(() => parseRenderArgs(["--stack", "qa"]));
  });
});
