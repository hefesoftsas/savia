import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useDebouncedSearch } from "../use-debounced-search";
it("coalesces successive keystrokes and cleans up pending search on unmount", () => {
  vi.useFakeTimers();
  try {
    const { result, rerender, unmount } = renderHook(
      ({ q }) => useDebouncedSearch(q),
      { initialProps: { q: "" } },
    );
    rerender({ q: "a" });
    act(() => vi.advanceTimersByTime(100));
    rerender({ q: "ab" });
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe("");
    act(() => vi.advanceTimersByTime(80));
    expect(result.current).toBe("ab");
    rerender({ q: "abc" });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
