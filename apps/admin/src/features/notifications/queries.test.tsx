import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { getSessionGeneration } from "@/auth/session-scope";
import type { NotificationClient } from "./client";
import { notificationReadKey, useUnreadNotifications } from "./queries";

const realtimeListeners = vi.hoisted(
  () => [] as Array<{ onEvent: () => void }>,
);

vi.mock("@/realtime/use-realtime", () => ({
  useRealtimeTopics: (options: { onEvent: () => void }) => {
    realtimeListeners.push(options);
    return { status: "live" };
  },
}));

afterEach(() => {
  cleanup();
  realtimeListeners.length = 0;
  vi.useRealTimers();
});

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

it("coalesces two count consumers and follows an in-flight hint without refreshing unrelated notification keys", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const generation = getSessionGeneration();
  let resolveFirstRefresh: ((value: number) => void) | undefined;
  const unreadCount = vi
    .fn()
    .mockResolvedValueOnce(1)
    .mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirstRefresh = resolve)),
    )
    .mockResolvedValueOnce(3);
  const adminStatus = vi.fn().mockResolvedValue("sent");
  const client = { unreadCount } as unknown as NotificationClient;
  const { result } = renderHook(
    () => ({
      first: useUnreadNotifications(client),
      second: useUnreadNotifications(client),
      unrelated: useQuery({
        queryKey: notificationReadKey(generation, "admin-status", "event-1"),
        queryFn: adminStatus,
      }),
    }),
    { wrapper: wrapper(queryClient) },
  );

  await waitFor(() => {
    expect(result.current.first.data).toBe(1);
    expect(result.current.second.data).toBe(1);
    expect(result.current.unrelated.data).toBe("sent");
  });
  expect(unreadCount).toHaveBeenCalledTimes(1);
  expect(adminStatus).toHaveBeenCalledTimes(1);

  act(() => realtimeListeners.forEach((listener) => listener.onEvent()));
  await waitFor(() => expect(unreadCount).toHaveBeenCalledTimes(2));

  act(() => realtimeListeners.forEach((listener) => listener.onEvent()));
  await new Promise((resolve) => setTimeout(resolve, 250));
  expect(unreadCount).toHaveBeenCalledTimes(2);

  await act(async () => resolveFirstRefresh?.(2));
  await waitFor(() => expect(unreadCount).toHaveBeenCalledTimes(3));
  await waitFor(() => {
    expect(result.current.first.data).toBe(3);
    expect(result.current.second.data).toBe(3);
  });
  expect(adminStatus).toHaveBeenCalledTimes(1);
  queryClient.clear();
});
