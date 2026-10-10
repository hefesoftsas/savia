import { describe, expect, it } from "vitest";
import { compareSolutionVersions } from "../src/solution-package";

describe("canonical semantic version ordering", () => {
  it.each([
    ["1.2.0", "1.10.0", -1],
    ["10.0.0", "2.999.999", 1],
    ["9007199254740993.0.0", "9007199254740992.0.0", 1],
    ["0.0.9007199254740992", "0.0.9007199254740993", -1],
    ["0.0.0", "0.0.0", 0],
  ] as const)(
    "compares %s and %s without numeric rounding",
    (a, b, expected) => {
      expect(compareSolutionVersions(a, b)).toBe(expected);
    },
  );
});
