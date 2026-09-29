import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppServicesProvider } from "@/features/assistant/assistant-context";
import { useRealtimeTopics } from "./use-realtime";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 1;
  sent: string[] = [];
  url: string;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.onclose?.();
  }
}

function servicesWith(post: ReturnType<typeof vi.fn>) {
  return { apiClient: { post } } as never;
}

function Probe({
  onEvent,
  onConnected,
}: {
  onEvent?: (event: { topic: string; type: string }) => void;
  onConnected?: () => void;
}) {
  const { status, lastEvent } = useRealtimeTopics({
    topics: ["users"],
    onEvent: onEvent as never,
    onConnected,
  });
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="last">{lastEvent ? lastEvent.type : "none"}</span>
    </div>
  );
}

afterEach(() => {
  cleanup();
  MockWebSocket.instances = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useRealtimeTopics", () => {
  it("connects with a ticket and forwards change events", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    const post = vi.fn().mockResolvedValue({
      data: {
        room: "platform",
        ticket: "ticket-1",
        topics: ["users"],
        expiresAt: new Date(Date.now() + 15000).toISOString(),
      },
    });
    const onConnected = vi.fn();
    const onEvent = vi.fn();
    render(
      <AppServicesProvider services={servicesWith(post)}>
        <Probe onEvent={onEvent} onConnected={onConnected} />
      </AppServicesProvider>,
    );

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/v1/realtime/ticket", {
        topics: ["users"],
      }),
    );
    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(1);
    });
    const socket = MockWebSocket.instances[0];
    expect(socket.url).toContain("/v1/realtime/subscribe?room=platform");
    expect(socket.url).toContain("ticket=ticket-1");

    await act(async () => {
      socket.onopen?.();
      socket.onmessage?.({
        data: JSON.stringify({ v: 1, type: "connected" }),
      });
    });
    expect(screen.getByTestId("status")).toHaveTextContent("live");
    expect(onConnected).toHaveBeenCalledTimes(1);

    await act(async () => {
      socket.onmessage?.({
        data: JSON.stringify({ v: 1, topic: "users", type: "created" }),
      });
    });
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ topic: "users", type: "created" }),
    );
    expect(screen.getByTestId("last")).toHaveTextContent("created");
  });

  it("ignores events for other topics and malformed payloads", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    const post = vi.fn().mockResolvedValue({
      data: {
        room: "platform",
        ticket: "ticket-1",
        topics: ["users"],
        expiresAt: new Date(Date.now() + 15000).toISOString(),
      },
    });
    const onEvent = vi.fn();
    render(
      <AppServicesProvider services={servicesWith(post)}>
        <Probe onEvent={onEvent} />
      </AppServicesProvider>,
    );

    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(1);
    });
    const socket = MockWebSocket.instances[0];
    await act(async () => {
      socket.onopen?.();
      socket.onmessage?.({
        data: JSON.stringify({ v: 1, type: "connected" }),
      });
      socket.onmessage?.({
        data: JSON.stringify({ v: 1, topic: "tenants", type: "created" }),
      });
      socket.onmessage?.({ data: "not-json" });
    });
    expect(onEvent).not.toHaveBeenCalled();
    expect(screen.getByTestId("last")).toHaveTextContent("none");
  });

  it("backs off repeated short-lived connections instead of resetting on open", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.stubGlobal("WebSocket", MockWebSocket);
    const post = vi
      .fn()
      .mockResolvedValue({ data: { room: "platform", ticket: "ticket" } });
    render(
      <AppServicesProvider services={servicesWith(post)}>
        <Probe />
      </AppServicesProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      MockWebSocket.instances[0].onopen?.();
      MockWebSocket.instances[0].close();
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(MockWebSocket.instances).toHaveLength(2);
    await act(async () => {
      MockWebSocket.instances[1].onopen?.();
      MockWebSocket.instances[1].close();
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(MockWebSocket.instances).toHaveLength(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it("waits at least Retry-After on capacity errors", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const post = vi.fn().mockRejectedValue({ status: 429 });
    render(
      <AppServicesProvider services={servicesWith(post)}>
        <Probe />
      </AppServicesProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_999);
    });
    expect(post).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("stops retrying permanent authorization failures", async () => {
    vi.useFakeTimers();
    const post = vi.fn().mockRejectedValue({ status: 403 });
    render(
      <AppServicesProvider services={servicesWith(post)}>
        <Probe />
      </AppServicesProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(screen.getByTestId("status")).toHaveTextContent("unavailable");
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("degrades without crashing outside AppServicesProvider", () => {
    function BareProbe() {
      const { status } = useRealtimeTopics({ topics: ["records"] });
      return <span data-testid="bare-status">{status}</span>;
    }
    render(<BareProbe />);
    expect(screen.getByTestId("bare-status")).toHaveTextContent("unavailable");
  });
});

describe("Realtime availability", () => {
  it("treats realtime-unavailable (503) as offline instead of retrying", async () => {
    vi.useFakeTimers();
    const post = vi.fn().mockRejectedValue({ status: 503 });
    function UnavailableProbe() {
      const { status } = useRealtimeTopics({ topics: ["users"] });
      return <span data-testid="unavailable-status">{status}</span>;
    }
    render(
      <AppServicesProvider services={servicesWith(post)}>
        <UnavailableProbe />
      </AppServicesProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("unavailable-status")).toHaveTextContent(
      "unavailable",
    );
    expect(post).toHaveBeenCalledTimes(1);
  });
});

it("refreshes after reconnecting to recover missed changes", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", MockWebSocket);
  const post = vi.fn().mockResolvedValue({
    data: { room: "platform", ticket: "ticket", topics: ["users"] },
  });
  const connected = vi.fn();
  render(
    <AppServicesProvider services={servicesWith(post)}>
      <Probe onConnected={connected} />
    </AppServicesProvider>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  const first = MockWebSocket.instances[0];
  await act(async () => {
    first.onmessage?.({ data: JSON.stringify({ type: "connected" }) });
    first.onmessage?.({ data: JSON.stringify({ type: "connected" }) });
  });
  expect(connected).toHaveBeenCalledTimes(1);
  await act(async () => {
    first.onclose?.();
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(MockWebSocket.instances).toHaveLength(2);
  await act(async () => {
    MockWebSocket.instances[1].onmessage?.({
      data: JSON.stringify({ type: "connected" }),
    });
  });
  expect(connected).toHaveBeenCalledTimes(2);
});

it("shares one room socket across components and filters their topics", async () => {
  vi.stubGlobal("WebSocket", MockWebSocket);
  const post = vi
    .fn()
    .mockResolvedValue({ data: { room: "principal:self", ticket: "shared" } });
  const account = vi.fn();
  const notifications = vi.fn();
  function Subscriber({
    topic,
    listener,
  }: {
    topic: string;
    listener: () => void;
  }) {
    useRealtimeTopics({ topics: [topic], onEvent: listener });
    return null;
  }
  const services = servicesWith(post);
  const { rerender, unmount } = render(
    <AppServicesProvider services={services}>
      <Subscriber topic="account" listener={account} />
      <Subscriber topic="notifications" listener={notifications} />
    </AppServicesProvider>,
  );
  await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
  expect(post).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith("/v1/realtime/ticket", {
    topics: ["account", "notifications"],
  });
  const first = MockWebSocket.instances[0];
  await act(async () =>
    first.onmessage?.({
      data: JSON.stringify({ topic: "account", type: "updated" }),
    }),
  );
  expect(account).toHaveBeenCalledOnce();
  expect(notifications).not.toHaveBeenCalled();
  rerender(
    <AppServicesProvider services={services}>
      <Subscriber topic="notifications" listener={notifications} />
    </AppServicesProvider>,
  );
  await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
  await act(async () =>
    first.onmessage?.({
      data: JSON.stringify({ topic: "notifications", type: "updated" }),
    }),
  );
  expect(notifications).not.toHaveBeenCalled();
  await act(async () =>
    MockWebSocket.instances[1].onmessage?.({
      data: JSON.stringify({ topic: "notifications", type: "updated" }),
    }),
  );
  expect(notifications).toHaveBeenCalledOnce();
  unmount();
});

it("does not share tickets between tenants or between tenant and personal rooms", async () => {
  vi.stubGlobal("WebSocket", MockWebSocket);
  const post = vi
    .fn()
    .mockResolvedValue({ data: { room: "room", ticket: "ticket" } });
  function Subscriber({
    tenantId,
    topic,
  }: {
    tenantId?: number;
    topic: string;
  }) {
    useRealtimeTopics({ topics: [topic], tenantId });
    return null;
  }
  render(
    <AppServicesProvider services={servicesWith(post)}>
      <Subscriber tenantId={1} topic="records" />
      <Subscriber tenantId={2} topic="records" />
      <Subscriber topic="account" />
    </AppServicesProvider>,
  );
  await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
  expect(post.mock.calls.map((call) => call[1])).toEqual(
    expect.arrayContaining([
      { topics: ["records"], tenantId: 1 },
      { topics: ["records"], tenantId: 2 },
      { topics: ["account"] },
    ]),
  );
});

it("disconnects pooled sockets when the authenticated session is cleared", async () => {
  vi.stubGlobal("WebSocket", MockWebSocket);
  const post = vi
    .fn()
    .mockResolvedValue({ data: { room: "platform", ticket: "ticket" } });
  const onEvent = vi.fn();
  render(
    <AppServicesProvider services={servicesWith(post)}>
      <Probe onEvent={onEvent} />
    </AppServicesProvider>,
  );
  await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
  const socket = MockWebSocket.instances[0];
  await act(async () =>
    window.dispatchEvent(new Event("savia:session-cleared")),
  );
  expect(screen.getByTestId("status")).toHaveTextContent("unavailable");
  await act(async () =>
    socket.onmessage?.({
      data: JSON.stringify({ topic: "users", type: "updated" }),
    }),
  );
  expect(onEvent).not.toHaveBeenCalled();
});
