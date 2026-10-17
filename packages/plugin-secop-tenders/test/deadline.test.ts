import { describe, expect, it } from "vitest";
import { deadlineInstant, formatDeadline } from "../deadline";

describe("Colombia tender deadlines", () => {
  it("reads Socrata floating timestamps as Colombia time and preserves explicit offsets", () => {
    expect(deadlineInstant("2026-10-20T15:30:00.000")).toBe(
      Date.parse("2026-10-20T20:30:00Z"),
    );
    expect(deadlineInstant("2026-10-20T20:30:00Z")).toBe(
      deadlineInstant("2026-10-20T15:30:00-05:00"),
    );
    expect(formatDeadline("2026-10-20T15:30:00.000", "es", "Unknown")).toMatch(
      /20.*oct.*2026.*3:30/,
    );
  });
  it("does not invent times for date-only values or normalize invalid dates", () => {
    expect(formatDeadline("2026-10-20", "es", "Unknown")).toMatch(
      /20.*oct.*2026$/,
    );
    for (const value of [
      undefined,
      "",
      "bad date",
      "2026-02-30",
      "2026-10-20T24:30:00",
    ]) {
      expect(deadlineInstant(value)).toBeNull();
      expect(formatDeadline(value, "es", "Sin fecha")).toBe("Sin fecha");
    }
  });
});
