import { describe, expect, it } from "vitest";
import {
  checkPieceValue,
  validatePieceConfig,
  workflowPieceSchema,
} from "../src/workflow-pieces";

const log = workflowPieceSchema.parse({
  id: "log",
  version: 1,
  label: "Log message",
  inputs: [{ key: "message", label: "Message", type: "text", required: true }],
  outputs: ["message"],
});
describe("workflow piece descriptors", () => {
  it("accepts well-formed descriptors and rejects malformed ones", () => {
    expect(log.inputs).toHaveLength(1);
    expect(workflowPieceSchema.safeParse({ ...log, id: "Log!" }).success).toBe(
      false,
    );
    expect(
      workflowPieceSchema.safeParse({
        ...log,
        inputs: [
          { key: "mode", label: "Mode", type: "select", required: true },
        ],
      }).success,
    ).toBe(false);
  });
  it("validates configs statically and defers references to execution", () => {
    expect(validatePieceConfig(log, { message: "hello" })).toEqual([]);
    expect(
      validatePieceConfig(log, { message: { ref: "trigger.text" } }),
    ).toEqual([]);
    expect(validatePieceConfig(log, {})).toEqual([
      "Piece input is required: message",
    ]);
    expect(validatePieceConfig(log, { message: 3 })).toEqual([
      "Piece input has the wrong type: message",
    ]);
    expect(validatePieceConfig(log, { message: "hi", extra: "x" })).toEqual([
      "Unknown piece input: extra",
    ]);
  });
  it("type-checks resolved values including select options", () => {
    const mode = workflowPieceSchema.parse({
      ...log,
      id: "mode",
      inputs: [
        {
          key: "mode",
          label: "Mode",
          type: "select",
          options: ["fast", "slow"],
          required: true,
        },
      ],
    });
    expect(checkPieceValue(mode, "mode", "fast")).toBeNull();
    expect(checkPieceValue(mode, "mode", "warp")).toBe(
      "Piece input has the wrong type: mode",
    );
    expect(checkPieceValue(mode, "mode", null)).toBe(
      "Piece input is required: mode",
    );
    expect(checkPieceValue(mode, "unknown", "x")).toBe(
      "Unknown piece input: unknown",
    );
  });
});
