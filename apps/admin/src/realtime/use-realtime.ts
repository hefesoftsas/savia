import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "@/api/api-client";
import { useAppServices } from "@/features/assistant/assistant-context";
import { useOnlineStatus } from "@/offline/use-online-status";

export type RealtimeStatus = "live" | "connecting" | "unavailable";

export type RealtimeChangeEvent = {
  topic: string;
  type: "created" | "updated" | "deleted";
  collection?: string;
  id?: string | number;
  version?: number;
  at?: string;
  actor?: string;
};

type TicketResponse = {
  data: {
    room: string;
    ticket: string;
    topics: string[];
    expiresAt: string;
  };
};

const MAX_BACKOFF_MS = 60_000;
const STABLE_CONNECTION_MS = 60_000;
const PING_INTERVAL_MS = 25_000;

function subscribeUrl(apiUrl: string, room: string, ticket: string): string {
  const base = apiUrl.replace(/^http/, "ws").replace(/\/$/, "");
  return `${base}/v1/realtime/subscribe?room=${encodeURIComponent(room)}&ticket=${encodeURIComponent(ticket)}`;
}

function isChangeEvent(message: unknown): message is RealtimeChangeEvent {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as Record<string, unknown>;
  return (
    typeof candidate.topic === "string" &&
    (candidate.type === "created" ||
      candidate.type === "updated" ||
      candidate.type === "deleted")
  );
}

/**
 * Live subscription to realtime topics. The socket carries change hints;
 * screens refetch through their authenticated queries in `onEvent`.
 * Reconnects with backoff, stays quiet while offline.
 */
export function useRealtimeTopics({
  topics,
  tenantId,
  enabled = true,
  onEvent,
}: {
  topics: string[];
  tenantId?: number;
  enabled?: boolean;
  onEvent?: (event: RealtimeChangeEvent) => void;
}): { status: RealtimeStatus; lastEvent: RealtimeChangeEvent | null } {
  // The embedded CRM engine renders without AppServicesProvider (and so do
  // its component tests): realtime degrades to unavailable instead of
  // crashing the whole screen. Calling the hook unconditionally inside
  // try/catch keeps hook order stable.
  let apiClient: ApiClient | undefined;
  try {
    apiClient = useAppServices().apiClient;
  } catch {
    apiClient = undefined;
  }
  const online = useOnlineStatus();
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const [lastEvent, setLastEvent] = useState<RealtimeChangeEvent | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const topicsKey = [...topics].sort().join(",");

  useEffect(() => {
    if (!enabled || !online || !apiClient) {
      setStatus("unavailable");
      return;
    }
    let stopped = false;
    let socket: WebSocket | null = null;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let backoffMs = 1000;
    let openedAt: number | undefined;
    const wanted = topicsKey.split(",");

    const scheduleRetry = () => {
      if (stopped) return;
      setStatus("connecting");
      retryTimer = setTimeout(
        () => void connect(),
        backoffMs + Math.random() * backoffMs,
      );
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    };

    const connect = async () => {
      if (stopped) return;
      setStatus("connecting");
      let ticket: TicketResponse;
      try {
        ticket = await apiClient.post<TicketResponse>(
          "/v1/realtime/ticket",
          tenantId === undefined
            ? { topics: wanted }
            : { topics: wanted, tenantId },
        );
      } catch (error) {
        const status = (error as { status?: number } | null)?.status;
        // Permanent failures hide the indicator instead of retrying forever
        // with a stuck "connecting" state. 503 covers REALTIME_UNAVAILABLE
        // when the hub is not configured for this environment.
        if (status && [400, 401, 403, 404, 422, 503].includes(status)) {
          setStatus("unavailable");
          return;
        }
        if (status === 429) backoffMs = MAX_BACKOFF_MS;
        scheduleRetry();
        return;
      }
      if (stopped) return;
      const apiUrl =
        import.meta.env.VITE_SAVIA_API_URL ?? window.location.origin;
      try {
        socket = new WebSocket(
          subscribeUrl(apiUrl, ticket.data.room, ticket.data.ticket),
        );
      } catch {
        scheduleRetry();
        return;
      }
      socket.onopen = () => {
        openedAt = Date.now();
        pingTimer = setInterval(() => {
          // Plain "ping" is auto-answered by the hub without waking it, so
          // idle connections cost nothing.
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send("ping");
          }
        }, PING_INTERVAL_MS);
      };
      socket.onmessage = (message) => {
        if (typeof message.data !== "string") return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(message.data);
        } catch {
          return;
        }
        if (!parsed || typeof parsed !== "object") return;
        const kind = (parsed as { type?: unknown }).type;
        if (kind === "connected") {
          setStatus("live");
          return;
        }
        if (kind === "pong" || kind === "subscriptions") return;
        if (isChangeEvent(parsed) && wanted.includes(parsed.topic)) {
          setLastEvent(parsed);
          onEventRef.current?.(parsed);
        }
      };
      socket.onerror = () => {
        socket?.close();
      };
      socket.onclose = (event) => {
        if (
          openedAt !== undefined &&
          Date.now() - openedAt >= STABLE_CONNECTION_MS
        )
          backoffMs = 1000;
        openedAt = undefined;
        if (pingTimer) clearInterval(pingTimer);
        socket = null;
        if (event?.code === 1008) {
          setStatus("unavailable");
          return;
        }
        scheduleRetry();
      };
    };

    void connect();
    return () => {
      stopped = true;
      if (pingTimer) clearInterval(pingTimer);
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, [apiClient, enabled, online, tenantId, topicsKey]);

  return { status, lastEvent };
}
