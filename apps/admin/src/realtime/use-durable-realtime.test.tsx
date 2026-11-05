import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ApiClientError } from "@/api/api-client";
import { useDurableRealtime } from "./use-durable-realtime";

const client = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/features/assistant/assistant-context", () => ({
  useAppServices: () => ({ apiClient: client }),
}));
afterEach(() => {
  cleanup();
  client.get.mockReset();
});

it("enables event-only refresh only after the backend confirms durability", async () => {
  client.get.mockResolvedValue({
    data: { durable: true, events: [], nextCursor: 0, hasMore: false },
  });
  const hook = renderHook(() => useDurableRealtime("live"));
  await waitFor(() => expect(hook.result.current).toBe(true));
  expect(client.get).toHaveBeenCalledWith(
    "/v1/realtime/events?after=0&limit=1",
  );
});

it("keeps the safe fallback for older or unavailable servers", async () => {
  client.get.mockRejectedValue(
    new ApiClientError(404, "HTTP_404", "not found"),
  );
  const hook = renderHook(() => useDurableRealtime("live"));
  await waitFor(() => expect(client.get).toHaveBeenCalledOnce());
  expect(hook.result.current).toBe(false);
});

it("accepts a durable backend when the historic cursor requires resync", async () => {
  client.get.mockRejectedValue(
    new ApiClientError(410, "CURSOR_EXPIRED", "resync", {
      error: { durable: true, resyncRequired: true },
    }),
  );
  const hook = renderHook(() => useDurableRealtime("live"));
  await waitFor(() => expect(hook.result.current).toBe(true));
});

it("ignores a stale capability response after disconnection", async () => {
  let resolve!: (value: unknown) => void;
  client.get.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const hook = renderHook(
    ({ status }: { status: "live" | "connecting" }) =>
      useDurableRealtime(status),
    { initialProps: { status: "live" } },
  );
  await waitFor(() => expect(client.get).toHaveBeenCalledOnce());
  hook.rerender({ status: "connecting" });
  await act(async () => {
    resolve({ data: { durable: true } });
  });
  expect(hook.result.current).toBe(false);
});
