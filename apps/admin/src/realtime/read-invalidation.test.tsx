import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { scheduleReadInvalidation } from "./read-invalidation";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const key = ["savia-read", 1, "tenant", "7", "connections", {}] as const;
function mount(client: QueryClient, read: () => Promise<string>) {
  return renderHook(() => useQuery({ queryKey: key, queryFn: read }), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}
it("coalesces duplicate subscriptions into one active read", async () => {
  vi.useFakeTimers();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(key, "before");
  const read = vi.fn().mockResolvedValue("after");
  mount(client, read);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  read.mockClear();
  const pending = Array.from({ length: 10 }, () =>
    scheduleReadInvalidation(client, [key]),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
    await Promise.all(pending);
  });
  expect(read).toHaveBeenCalledTimes(1);
  expect(client.getQueryData(key)).toBe("after");
  client.clear();
});
it("waits for an in-flight opening read then makes one authoritative follow-up", async () => {
  vi.useFakeTimers();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let finish!: (value: string) => void;
  const opening = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const read = vi.fn().mockReturnValueOnce(opening).mockResolvedValue("fresh");
  mount(client, read);
  const pending = Array.from({ length: 10 }, () =>
    scheduleReadInvalidation(client, [key]),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish("stale");
    await opening;
    await Promise.all(pending);
  });
  expect(read).toHaveBeenCalledTimes(2);
  expect(client.getQueryData(key)).toBe("fresh");
  client.clear();
});
it("does not refetch removed or inactive protected reads", async () => {
  vi.useFakeTimers();
  const client = new QueryClient();
  const read = vi.fn().mockResolvedValue("protected");
  const view = mount(client, read);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  const pending = scheduleReadInvalidation(client, [key]);
  view.unmount();
  client.removeQueries({ queryKey: key, exact: true });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
    await pending;
  });
  expect(read).toHaveBeenCalledTimes(1);
  expect(client.getQueryData(key)).toBeUndefined();
  client.clear();
});
