import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useOnlineStatus } from "./use-online-status";
import { verifyOnlineStatus } from "./connectivity-status";

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const flush = () =>
  act(async () => {
    await Promise.resolve();
  });

it("shares recovery checks without mounted UI subscribers and cleans them up", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null));
  vi.stubGlobal("fetch", fetcher);
  const results = await Promise.all([
    verifyOnlineStatus(),
    verifyOnlineStatus(),
  ]);
  expect(results).toEqual([true, true]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("permits an explicit recovery check even if no visible UI remains", async () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  const fetcher = vi.fn().mockResolvedValue(new Response(null));
  vi.stubGlobal("fetch", fetcher);
  expect(await verifyOnlineStatus()).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([
  ["visible", "hidden"],
  ["hidden", "visible"],
] as const)("preserves an explicit check across %s to %s", async (from, to) => {
  const visibility = vi.spyOn(document, "visibilityState", "get");
  visibility.mockReturnValue(from);
  const resolvers: Array<(response: Response) => void> = [];
  const fetcher = vi.fn().mockImplementation(
    (_url, { signal }: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        resolvers.push(resolve);
        signal!.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const pending = verifyOnlineStatus();
  visibility.mockReturnValue(to);
  document.dispatchEvent(new Event("visibilitychange"));
  await Promise.resolve();
  await Promise.resolve();
  const aborted = fetcher.mock.calls[0][1].signal.aborted;
  resolvers.forEach((resolve) => resolve(new Response(null)));
  expect(await pending).toBe(true);
  expect(aborted).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("shares one request among consumers and stops polling after unmount", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null));
  vi.stubGlobal("fetch", fetcher);
  const a = renderHook(useOnlineStatus);
  const b = renderHook(useOnlineStatus);
  await flush();
  expect(a.result.current).toBe(true);
  expect(b.result.current).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    method: "HEAD",
    cache: "no-store",
    credentials: "omit",
  });
  a.unmount();
  b.unmount();
  await act(() => vi.advanceTimersByTimeAsync(120_000));
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("keeps real network failures offline and discovers recovery without browser events", async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("Network unavailable"))
    .mockResolvedValue(new Response(null));
  vi.stubGlobal("fetch", fetcher);
  const hook = renderHook(useOnlineStatus);
  await flush();
  expect(hook.result.current).toBe(false);
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(hook.result.current).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("does not probe while the browser reports online", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const hook = renderHook(useOnlineStatus);
  await act(() => vi.advanceTimersByTimeAsync(120_000));
  expect(hook.result.current).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
});

it("pauses checks in hidden tabs and checks again when visible", async () => {
  const visibility = vi.spyOn(document, "visibilityState", "get");
  visibility.mockReturnValue("hidden");
  const fetcher = vi.fn().mockResolvedValue(new Response(null));
  vi.stubGlobal("fetch", fetcher);
  const hook = renderHook(useOnlineStatus);
  await act(() => vi.advanceTimersByTimeAsync(120_000));
  expect(fetcher).not.toHaveBeenCalled();
  await act(async () => {
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(hook.result.current).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => {
    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await act(() => vi.advanceTimersByTimeAsync(120_000));
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("aborts hanging requests and retries after the timeout", async () => {
  const fetcher = vi
    .fn()
    .mockImplementation(
      (_url, { signal }: RequestInit) =>
        new Promise((_resolve, reject) =>
          signal!.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          ),
        ),
    );
  vi.stubGlobal("fetch", fetcher);
  const hook = renderHook(useOnlineStatus);
  await act(() => vi.advanceTimersByTimeAsync(8_000));
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  expect(hook.result.current).toBe(false);
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("ignores a stale failure after a browser online event", async () => {
  let rejectRequest!: (error: Error) => void;
  const fetcher = vi.fn().mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        rejectRequest = reject;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const hook = renderHook(useOnlineStatus);
  await act(async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    window.dispatchEvent(new Event("online"));
    rejectRequest(new TypeError("Late failure"));
  });
  expect(hook.result.current).toBe(true);
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
});
