import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "@/api/api-client";
import { useSessionGeneration } from "@/auth/session-scope";
import { useAppServices } from "@/features/assistant/assistant-context";
import { useOnlineStatus } from "@/offline/use-online-status";

export type RealtimeConnectionReason =
  "initial" | "subscription-change" | "recovered";

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

type Listener = {
  topics: string[];
  status: (status: RealtimeStatus) => void;
  connected: (reason: RealtimeConnectionReason) => void;
  event: (event: RealtimeChangeEvent) => void;
};
type SharedRoom = {
  listeners: Set<Listener>;
  topicsKey: string;
  acknowledged?: boolean;
  status: RealtimeStatus;
  stop?: () => void;
  scheduled: boolean;
  disposed?: boolean;
  dispose?: () => void;
};
const connections = new WeakMap<ApiClient, Map<string, SharedRoom>>();
const PERSONAL_TOPICS = new Set([
  "notifications",
  "personal-integrations",
  "account",
]);
const PLATFORM_TOPICS = new Set(["users", "tenants"]);

function subscribe(
  apiClient: ApiClient,
  tenantId: number | undefined,
  listener: Listener,
) {
  let rooms = connections.get(apiClient);
  if (!rooms) {
    rooms = new Map();
    connections.set(apiClient, rooms);
  }
  const key = listener.topics.every((topic) => PERSONAL_TOPICS.has(topic))
    ? "self"
    : listener.topics.every((topic) => PLATFORM_TOPICS.has(topic))
      ? "platform"
      : `tenant:${tenantId ?? "current"}`;
  let room = rooms.get(key);
  if (!room) {
    room = {
      listeners: new Set(),
      topicsKey: "",
      status: "connecting",
      scheduled: false,
    };
    rooms.set(key, room);
    const created = room;
    created.dispose = () => {
      created.disposed = true;
      created.stop?.();
      for (const item of created.listeners) item.status("unavailable");
      created.listeners.clear();
      if (rooms!.get(key) === created) rooms!.delete(key);
      window.removeEventListener("savia:session-cleared", created.dispose!);
      window.removeEventListener("savia:principal-changed", created.dispose!);
    };
    window.addEventListener("savia:session-cleared", created.dispose);
    window.addEventListener("savia:principal-changed", created.dispose);
  }
  const shared = room;
  const schedule = () => {
    if (shared.scheduled || shared.disposed) return;
    shared.scheduled = true;
    // Batch components mounting/unmounting together into one ticket request.
    queueMicrotask(() => {
      shared.scheduled = false;
      if (shared.disposed) return;
      const requestedTopics = new Set(
        [...shared.listeners].flatMap((item) => item.topics),
      );
      // Principal topics share one authorization scope. Subscribe to the
      // complete set up front so mounting a route-specific principal listener
      // does not replace the account/notifications socket and trigger a broad
      // reconnect refresh across the app.
      const topicsKey = [
        ...new Set([
          ...requestedTopics,
          ...(requestedTopics.size > 0 && key === "self"
            ? PERSONAL_TOPICS
            : []),
        ]),
      ]
        .sort()
        .join(",");
      if (!topicsKey) {
        shared.dispose?.();
        return;
      }
      if (topicsKey === shared.topicsKey && shared.stop) return;
      const initialReason: RealtimeConnectionReason = !shared.acknowledged
        ? "initial"
        : shared.status === "live"
          ? "subscription-change"
          : "recovered";
      shared.stop?.();
      shared.topicsKey = topicsKey;
      shared.stop = connectRoom(
        apiClient,
        tenantId,
        topicsKey,
        (status) => {
          shared.status = status;
          for (const item of shared.listeners) item.status(status);
        },
        (reason) => {
          shared.acknowledged = true;
          for (const item of shared.listeners) item.connected(reason);
        },
        (event) => {
          for (const item of shared.listeners)
            if (item.topics.includes(event.topic)) item.event(event);
        },
        initialReason,
      );
    });
  };
  shared.listeners.add(listener);
  listener.status(shared.status);
  if (
    shared.status === "live" &&
    listener.topics.every((topic) =>
      shared.topicsKey.split(",").includes(topic),
    )
  )
    listener.connected("initial");
  schedule();
  return () => {
    shared.listeners.delete(listener);
    schedule();
  };
}

function connectRoom(
  apiClient: ApiClient,
  tenantId: number | undefined,
  topicsKey: string,
  setStatus: (status: RealtimeStatus) => void,
  onConnected: (reason: RealtimeConnectionReason) => void,
  onEvent: (event: RealtimeChangeEvent) => void,
  initialReason: RealtimeConnectionReason,
): () => void {
  let stopped = false;
  let socket: WebSocket | null = null;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let backoffMs = 1000;
  let openedAt: number | undefined;
  let connectedBefore = false;
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
      if (stopped) return;
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
    const apiUrl = import.meta.env.VITE_SAVIA_API_URL ?? window.location.origin;
    try {
      socket = new WebSocket(
        subscribeUrl(apiUrl, ticket.data.room, ticket.data.ticket),
      );
    } catch {
      scheduleRetry();
      return;
    }
    socket.onopen = () => {
      if (stopped) return;
      openedAt = Date.now();
      pingTimer = setInterval(() => {
        // Plain "ping" is auto-answered by the hub without waking it, so
        // idle connections cost nothing.
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send("ping");
        }
      }, PING_INTERVAL_MS);
    };
    let acknowledged = false;
    socket.onmessage = (message) => {
      if (stopped) return;
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
        if (!acknowledged) {
          acknowledged = true;
          onConnected(connectedBefore ? "recovered" : initialReason);
          connectedBefore = true;
        }
        return;
      }
      if (kind === "pong" || kind === "subscriptions") return;
      if (isChangeEvent(parsed) && wanted.includes(parsed.topic)) {
        onEvent(parsed);
      }
    };
    socket.onerror = () => {
      socket?.close();
    };
    socket.onclose = (event) => {
      if (stopped) return;
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
}

/** One authenticated socket per room in this browser tab. Messages are hints only. */
export function useRealtimeTopics({
  topics,
  tenantId,
  enabled = true,
  onEvent,
  onConnected,
}: {
  topics: string[];
  tenantId?: number;
  enabled?: boolean;
  onEvent?: (event: RealtimeChangeEvent) => void;
  onConnected?: (reason: RealtimeConnectionReason) => void;
}): { status: RealtimeStatus; lastEvent: RealtimeChangeEvent | null } {
  let apiClient: ApiClient | undefined;
  try {
    apiClient = useAppServices().apiClient;
  } catch {
    apiClient = undefined;
  }
  const online = useOnlineStatus();
  const sessionGeneration = useSessionGeneration();
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const [lastEvent, setLastEvent] = useState<RealtimeChangeEvent | null>(null);
  const callbacks = useRef({ onEvent, onConnected });
  const acknowledgedScope = useRef<{
    apiClient: ApiClient;
    scope: string;
  } | null>(null);
  callbacks.current = { onEvent, onConnected };
  const topicsKey = [...topics].sort().join(",");
  useEffect(() => {
    setLastEvent(null);
    if (!enabled || !online || !apiClient || !topicsKey) {
      setStatus("unavailable");
      return;
    }
    return subscribe(apiClient, tenantId, {
      topics: topicsKey.split(","),
      status: setStatus,
      connected: (reason) => {
        const scope = `${sessionGeneration}:${tenantId ?? "current"}:${topicsKey}`;
        const sameScope =
          acknowledgedScope.current?.apiClient === apiClient &&
          acknowledgedScope.current.scope === scope;
        // A surviving listener returning online is a recovery even if the
        // room was disposed while offline. A new read scope starts fresh.
        const effective = sameScope
          ? reason === "initial"
            ? "recovered"
            : reason
          : "initial";
        acknowledgedScope.current = { apiClient, scope };
        callbacks.current.onConnected?.(effective);
      },
      event: (event) => {
        setLastEvent(event);
        callbacks.current.onEvent?.(event);
      },
    });
  }, [apiClient, enabled, online, tenantId, topicsKey, sessionGeneration]);
  return { status, lastEvent };
}
