import { describe, expect, it } from "vitest";
import { selectSessionEvidence } from "../src/companion/session-evidence";
describe("bounded session evidence", () => {
  const segment = (sequence: number, text: string) => ({
    sequence,
    text,
    source: "microphone",
    startSeconds: sequence * 30,
    durationSeconds: 30,
  });
  it("selects relevant late evidence rather than silently cutting the first hour", () => {
    const result = selectSessionEvidence(
      [
        segment(0, "irrelevant ".repeat(30)),
        segment(119, "El código del proyecto es Cedro."),
      ],
      "¿Cuál es el código del proyecto?",
      100,
    );
    expect(result.text).toContain("Cedro");
    expect(result.text).toContain("3570.00s");
    expect(result.partial).toBe(true);
    expect(result.evidence.map((item) => item.sequence)).toEqual([119]);
  });
  it("does not break segments or exceed the context budget", () => {
    const result = selectSessionEvidence(
      [segment(0, "x".repeat(1000)), segment(1, "Accepted short evidence")],
      "evidence",
      90,
    );
    expect(result.text.length).toBeLessThanOrEqual(90);
    expect(result.text).not.toContain("xxxx");
    expect(result.evidence).toHaveLength(1);
  });
  it("keeps a complete short transcript in timeline order", () => {
    const result = selectSessionEvidence(
      [segment(1, "Second."), segment(0, "First.")],
      "Second",
    );
    expect(result.partial).toBe(false);
    expect(result.text.indexOf("First")).toBeLessThan(
      result.text.indexOf("Second"),
    );
  });
});
