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
    onConnected: (
      reason?: "initial" | "subscription-change" | "recovered",
    ) => void;
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

it("does not refresh a newly opened read model on its first acknowledgement", async () => {
  const refresh = vi.fn();
  const { result } = renderHook(() =>
    useRealtimeRefresh({ topics: ["account"], refresh }),
  );
  act(() => connection().onConnected());
  await tick();
  expect(refresh).not.toHaveBeenCalled();
  expect(result.current.changed).toBe(false);
});

it("catches up on the first acknowledgement when the opening read can be cached", async () => {
  const refresh = vi.fn();
  renderHook(() =>
    useRealtimeRefresh({
      topics: ["studio"],
      refreshOnInitialConnect: true,
      refresh,
    }),
  );
  act(() => connection().onConnected());
  await tick();
  expect(refresh).toHaveBeenCalledOnce();
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
  act(() => connection().onConnected());
  await tick();
  expect(refresh).not.toHaveBeenCalled();
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
  act(() => connection().onEvent({ topic: "settings", type: "updated" }));
  rerender({ tenantId: 2 });
  await tick();
  expect(refresh).not.toHaveBeenCalled();
  act(() => connection().onEvent({ topic: "settings", type: "updated" }));
  unmount();
  await tick();
  expect(refresh).not.toHaveBeenCalled();
});

it("treats a different tenant's first acknowledgement as initial", async () => {
  const refresh = vi.fn();
  const { rerender } = renderHook(
    ({ tenantId }) =>
      useRealtimeRefresh({ topics: ["settings"], tenantId, refresh }),
    { initialProps: { tenantId: 1 } },
  );
  act(() => connection().onConnected());
  await tick();
  rerender({ tenantId: 2 });
  act(() => connection().onConnected());
  await tick();
  expect(refresh).not.toHaveBeenCalled();
  act(() => connection().onConnected());
  await tick();
  expect(refresh).toHaveBeenCalledOnce();
});

it("retains a reload action after a failed refresh", async () => {
  const refresh = vi.fn().mockRejectedValue(new Error("offline"));
  const { result } = renderHook(() =>
    useRealtimeRefresh({ topics: ["settings"], refresh }),
  );
  act(() => connection().onEvent({ topic: "settings", type: "updated" }));
  await tick();
  expect(result.current.changed).toBe(true);
});

it.each([false, true])(
  "does not label a newly opened draft stale on its first acknowledgement (initial catch-up: %s)",
  async (refreshOnInitialConnect) => {
    const refresh = vi.fn();
    const { result } = renderHook(() =>
      useRealtimeRefresh({
        topics: ["studio"],
        blocked: true,
        refreshOnInitialConnect,
        refresh,
      }),
    );
    act(() => connection().onConnected());
    await tick();
    expect(result.current.changed).toBe(false);
    act(() => connection().onConnected());
    await tick();
    expect(result.current.changed).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
  },
);

it("does not treat subscription replacement as transport recovery", async () => {
  const refresh = vi.fn();
  renderHook(() => useRealtimeRefresh({ topics: ["settings"], refresh }));
  act(() => connection().onConnected("initial"));
  await tick();
  act(() => connection().onConnected("subscription-change"));
  await tick();
  expect(refresh).not.toHaveBeenCalled();
  act(() => connection().onConnected("recovered"));
  await tick();
  expect(refresh).toHaveBeenCalledOnce();
});

it("serializes hints received during a read into one follow-up", async () => {
  let finish!: () => void;
  const first = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const refresh = vi
    .fn()
    .mockReturnValueOnce(first)
    .mockResolvedValue(undefined);
  renderHook(() => useRealtimeRefresh({ topics: ["settings"], refresh }));
  act(() => connection().onEvent({ topic: "settings", type: "updated" }));
  await tick();
  for (let i = 0; i < 10; i++)
    act(() => connection().onEvent({ topic: "settings", type: "updated" }));
  await tick();
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish();
    await first;
  });
  expect(refresh).toHaveBeenCalledTimes(2);
});

it("drops an in-flight follow-up after the tenant changes", async () => {
  let finish!: () => void;
  const first = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const refresh = vi
    .fn()
    .mockReturnValueOnce(first)
    .mockResolvedValue(undefined);
  const { rerender } = renderHook(
    ({ tenantId }) =>
      useRealtimeRefresh({ topics: ["settings"], tenantId, refresh }),
    { initialProps: { tenantId: 1 } },
  );
  act(() => connection().onEvent({ topic: "settings", type: "updated" }));
  await tick();
  act(() => connection().onEvent({ topic: "settings", type: "updated" }));
  await tick();
  rerender({ tenantId: 2 });
  await act(async () => {
    finish();
    await first;
  });
  expect(refresh).toHaveBeenCalledTimes(1);
});
