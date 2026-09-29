import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useRealtimeRefresh } from "./use-realtime-refresh";

const subscribe = vi.hoisted(() =>
  vi.fn((_options: unknown) => ({ status: "live" })),
);
vi.mock("./use-realtime", () => ({ useRealtimeTopics: subscribe }));
const connection = () =>
  subscribe.mock.calls.at(-1)![0] as unknown as {
    onEvent: (event: {
      topic: string;
      type: string;
      collection?: string;
    }) => void;
    onConnected: () => void;
  };
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  subscribe.mockClear();
});
const tick = async () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });

it("coalesces bursts, filters unrelated hints and catches up after reconnect", async () => {
  const refresh = vi.fn();
  renderHook(() =>
    useRealtimeRefresh({
      topics: ["settings"],
      tenantId: 3,
      refresh,
      accepts: (event) => event.collection === "branding",
    }),
  );
  act(() =>
    connection().onEvent({
      topic: "settings",
      type: "updated",
      collection: "credentials",
    }),
  );
  await tick();
  expect(refresh).not.toHaveBeenCalled();
  act(() => {
    connection().onEvent({
      topic: "settings",
      type: "updated",
      collection: "branding",
    });
    connection().onEvent({
      topic: "settings",
      type: "updated",
      collection: "branding",
    });
  });
  await tick();
  expect(refresh).toHaveBeenCalledTimes(1);
  act(() => connection().onConnected());
  await tick();
  expect(refresh).toHaveBeenCalledTimes(2);
});

it("preserves a draft and reloads only on explicit action", async () => {
  const refresh = vi.fn();
  const { result } = renderHook(() =>
    useRealtimeRefresh({ topics: ["settings"], blocked: true, refresh }),
  );
  act(() => connection().onEvent({ topic: "settings", type: "updated" }));
  await tick();
  expect(refresh).not.toHaveBeenCalled();
  expect(result.current.changed).toBe(true);
  await act(async () => {
    await result.current.reload();
  });
  expect(refresh).toHaveBeenCalledOnce();
  expect(result.current.changed).toBe(false);
});

it("cancels queued work when the tenant changes or the view unmounts", async () => {
  const refresh = vi.fn();
  const { rerender, unmount } = renderHook(
    ({ tenantId }) =>
      useRealtimeRefresh({ topics: ["settings"], tenantId, refresh }),
    { initialProps: { tenantId: 1 } },
  );
  act(() => connection().onConnected());
  rerender({ tenantId: 2 });
  await tick();
  expect(refresh).not.toHaveBeenCalled();
  act(() => connection().onConnected());
  unmount();
  await tick();
  expect(refresh).not.toHaveBeenCalled();
});

it("retains a reload action after a failed refresh", async () => {
  const refresh = vi.fn().mockRejectedValue(new Error("offline"));
  const { result } = renderHook(() =>
    useRealtimeRefresh({ topics: ["settings"], refresh }),
  );
  act(() => connection().onConnected());
  await tick();
  expect(result.current.changed).toBe(true);
});

it("does not label a newly opened draft stale on its first acknowledgement", async () => {
  const refresh = vi.fn();
  const { result } = renderHook(() =>
    useRealtimeRefresh({ topics: ["studio"], blocked: true, refresh }),
  );
  act(() => connection().onConnected());
  await tick();
  expect(result.current.changed).toBe(false);
  act(() => connection().onConnected());
  await tick();
  expect(result.current.changed).toBe(true);
  expect(refresh).not.toHaveBeenCalled();
});
