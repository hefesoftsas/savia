import { describe, expect, it } from "vitest";
import { deriveReadState } from "./read-state";

const state = (
  overrides: Partial<Parameters<typeof deriveReadState>[0]> = {},
) =>
  deriveReadState({
    scopeReady: true,
    hasData: false,
    fetching: false,
    error: null,
    accessDenied: false,
    ...overrides,
  });

describe("deriveReadState", () => {
  it("blocks unresolved scope and denied access", () => {
    expect(state({ scopeReady: false, hasData: true })).toBe("blocked");
    expect(state({ accessDenied: true, hasData: true })).toBe("blocked");
  });

  it("treats empty successful data as ready and retains it while fetching", () => {
    expect(state({ hasData: true })).toBe("ready");
    expect(state({ hasData: true, fetching: true })).toBe("refreshing");
    expect(state({ hasData: true, error: new Error("offline") })).toBe(
      "refresh-error",
    );
  });

  it("distinguishes initial loading from initial failure", () => {
    expect(state()).toBe("initial");
    expect(state({ error: new Error("offline") })).toBe("initial-error");
  });
});
