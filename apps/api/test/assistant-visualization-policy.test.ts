import { describe, expect, it } from "vitest";
import { visualizationRequested } from "../src/assistant/visualization-policy";

describe("assistant visualization policy", () => {
  it("recognizes an explicit chart request in the latest user message", () => {
    expect(
      visualizationRequested([
        {
          id: "message-1",
          role: "user",
          parts: [{ type: "text", text: "¿Puedes hacer una gráfica?" }],
        },
      ]),
    ).toBe(true);
  });

  it("does not require a visualization for a regular data request", () => {
    expect(
      visualizationRequested([
        {
          id: "message-2",
          role: "user",
          parts: [{ type: "text", text: "Lista las agencias activas" }],
        },
      ]),
    ).toBe(false);
  });
});
