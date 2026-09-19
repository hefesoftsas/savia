import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppServicesProvider } from "@/features/assistant/assistant-context";
import { LiveIndicator } from "./live-indicator";
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
}: {
  onEvent?: (event: { topic: string; type: string }) => void;
}) {
  const { status, lastEvent } = useRealtimeTopics({
    topics: ["users"],
    onEvent: onEvent as never,
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
    const onEvent = vi.fn();
    render(
      <AppServicesProvider services={servicesWith(post)}>
        <Probe onEvent={onEvent} />
      </AppServicesProvider>,
    );

    expect(post).toHaveBeenCalledWith("/v1/realtime/ticket", {
      topics: ["users"],
    });
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

  it("stays quiet without reconnecting the indicator while offline", () => {
    const { container } = render(<LiveIndicator status="unavailable" />);
    expect(container).toBeEmptyDOMElement();
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

describe("LiveIndicator", () => {
  it("shows live and connecting states", () => {
    const { rerender } = render(<LiveIndicator status="connecting" />);
    expect(screen.getByRole("status")).toHaveTextContent("Conectando");
    rerender(<LiveIndicator status="live" />);
    expect(screen.getByRole("status")).toHaveTextContent("En vivo");
  });
});
