import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useRealtimeQuery } from "./use-realtime-query";
const subscribe = vi.hoisted(() =>
  vi.fn((_options: unknown) => ({ status: "live" })),
);
vi.mock("./use-realtime", () => ({ useRealtimeTopics: subscribe }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  subscribe.mockClear();
});
const key = ["savia-read", 1, "tenant", "7", "settings", {}];
const listener = () =>
  subscribe.mock.calls.at(-1)![0] as unknown as {
    onEvent: () => void;
    onConnected: (reason: string) => void;
  };
function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}
it("defers shared read refresh while a draft is dirty and releases it once clean", async () => {
  vi.useFakeTimers();
  const client = new QueryClient();
  client.setQueryData(key, "before");
  const read = vi.fn().mockResolvedValue("after");
  const { result, rerender } = renderHook(
    ({ blocked }) => {
      const query = useQuery({
        queryKey: key,
        queryFn: read,
        staleTime: Infinity,
      });
      const remote = useRealtimeQuery({
        topics: ["settings"],
        tenantId: 7,
        queryKeys: [key],
        blocked,
      });
      return { query, remote };
    },
    { initialProps: { blocked: true }, wrapper: wrapper(client) },
  );
  act(() => listener().onEvent());
  expect(result.current.remote.changed).toBe(true);
  expect(read).not.toHaveBeenCalled();
  rerender({ blocked: false });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(201);
  });
  expect(read).toHaveBeenCalledTimes(1);
  expect(client.getQueryData(key)).toBe("after");
  expect(result.current.remote.changed).toBe(false);
  client.clear();
});
it("ignores first and subscription acknowledgements but catches up after recovery", async () => {
  vi.useFakeTimers();
  const client = new QueryClient();
  client.setQueryData(key, "before");
  const read = vi.fn().mockResolvedValue("after");
  renderHook(
    () => {
      useQuery({ queryKey: key, queryFn: read, staleTime: Infinity });
      return useRealtimeQuery({
        topics: ["settings"],
        tenantId: 7,
        queryKeys: [key],
      });
    },
    { wrapper: wrapper(client) },
  );
  act(() => listener().onConnected("initial"));
  act(() => listener().onConnected("subscription-change"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(201);
  });
  expect(read).not.toHaveBeenCalled();
  act(() => listener().onConnected("recovered"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(201);
  });
  expect(read).toHaveBeenCalledTimes(1);
  client.clear();
});
