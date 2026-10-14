import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { useAccessRealtime } from "./use-access-realtime";
const subscribe = vi.hoisted(() => vi.fn());
vi.mock("./use-realtime", () => ({ useRealtimeTopics: subscribe }));
afterEach(() => {
  cleanup();
  subscribe.mockClear();
});
it("refreshes only the subscribed tenant on events and reconnect", async () => {
  const client = new QueryClient();
  const key = ["access-control", "roles", "tenant:3"];
  const other = ["access-control", "roles", "tenant:4"];
  client.setQueryData(key, {});
  client.setQueryData(other, {});
  function Probe() {
    useAccessRealtime("tenant:3");
    return null;
  }
  render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
  const options = subscribe.mock.calls[0][0];
  expect(options).toMatchObject({
    topics: ["access-control"],
    tenantId: 3,
    enabled: true,
  });
  options.onEvent();
  expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(client.getQueryState(other)?.isInvalidated).toBe(false);
  client.setQueryData(key, {});
  options.onConnected("subscription-change");
  expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  options.onConnected("recovered");
  expect(client.getQueryState(key)?.isInvalidated).toBe(true);
});
