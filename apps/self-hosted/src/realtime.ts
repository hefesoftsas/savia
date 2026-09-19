import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import {
  RealtimeHubError,
  type RealtimeHubClient,
} from "../../api/src/realtime/hub-client";
import {
  isRealtimeRoom,
  isRealtimeTopic,
  TICKET_TTL_MS,
  toRealtimeEvent,
} from "../../api/src/realtime/protocol";

type Grant = {
  room: string;
  principalId: string;
  topics: string[];
  expiresAt: number;
  ticket: string;
};
const UPGRADE_HEADER = "X-Savia-Internal-Realtime-Upgrade";
/** Single-host in-memory hints. Restart drops sockets/tickets; clients reconnect
 * through the authorized ticket endpoint and refetch durable application data. */
export function createNodeRealtimeHub(
  options: { now?: () => number } = {},
): RealtimeHubClient & {
  handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    response: Response,
  ): boolean;
  close(): void;
} {
  const now = options.now ?? Date.now;
  const tickets = new Map<string, Grant>();
  const upgrades = new Map<string, Grant>();
  const sessions = new Map<WebSocket, Grant>();
  const server = new WebSocketServer({
    noServer: true,
    maxPayload: 1024,
    perMessageDeflate: false,
  });
  let closed = false;
  const prune = () => {
    for (const [key, grant] of tickets)
      if (grant.expiresAt <= now()) tickets.delete(key);
    for (const [key, grant] of upgrades)
      if (grant.expiresAt <= now()) upgrades.delete(key);
  };
  const count = (grants: Iterable<Grant>, room: string, principal?: string) => {
    let n = 0;
    for (const grant of grants)
      if (
        grant.room === room &&
        (!principal || grant.principalId === principal)
      )
        n++;
    return n;
  };
  const limited = (room: string, principal: string) =>
    count(sessions.values(), room, principal) >= 8 ||
    count(sessions.values(), room) >= 1000;
  const pendingLimited = (room: string, principal: string) => {
    const pending = [...tickets.values(), ...upgrades.values()];
    return count(pending, room, principal) >= 8 || count(pending, room) >= 1000;
  };
  const limiterResponse = () =>
    new RealtimeHubError("Realtime capacity exceeded.").getResponse();
  return {
    async issue(room, grant) {
      if (closed) throw new Error("Realtime hub is closed");
      if (
        !isRealtimeRoom(room) ||
        !grant.principalId ||
        !Array.isArray(grant.topics) ||
        !grant.topics.length ||
        !grant.topics.every(isRealtimeTopic)
      )
        throw new Error("Invalid realtime ticket grant");
      prune();
      if (
        limited(room, grant.principalId) ||
        pendingLimited(room, grant.principalId)
      )
        throw new RealtimeHubError("Realtime capacity exceeded.");
      const ticket = randomUUID();
      const expiresAt = now() + TICKET_TTL_MS;
      tickets.set(ticket, {
        room,
        principalId: grant.principalId,
        topics: [...new Set(grant.topics)],
        expiresAt,
        ticket,
      });
      return { ticket, expiresAt: new Date(expiresAt).toISOString() };
    },
    async forward(room, request) {
      if (closed) return new Response("Realtime unavailable", { status: 503 });
      if (
        request.method !== "GET" ||
        request.headers.get("Upgrade")?.toLowerCase() !== "websocket"
      )
        return new Response("Expected websocket upgrade", { status: 426 });
      prune();
      const ticket = new URL(request.url).searchParams.get("ticket");
      const grant = ticket ? tickets.get(ticket) : undefined;
      if (!grant || grant.room !== room)
        return new Response("Invalid or expired ticket", { status: 401 });
      // No await between lookup and deletion: consumption is atomic on this owner.
      tickets.delete(ticket!);
      if (limited(room, grant.principalId)) return limiterResponse();
      const authorization = randomUUID();
      upgrades.set(authorization, grant);
      // An opaque, short-lived capability survives Hono's response cloning. Only
      // the gateway's already-authorized response is passed to handleUpgrade.
      return new Response(null, {
        status: 204,
        headers: { [UPGRADE_HEADER]: authorization },
      });
    },
    handleUpgrade(request, socket, head, response) {
      prune();
      const authorization = response.headers.get(UPGRADE_HEADER);
      const grant = authorization ? upgrades.get(authorization) : undefined;
      if (closed || response.status !== 204 || !grant) return false;
      upgrades.delete(authorization!);
      const ticket = new URL(
        request.url ?? "/",
        "http://localhost",
      ).searchParams.get("ticket");
      if (
        request.method !== "GET" ||
        ticket !== grant.ticket ||
        limited(grant.room, grant.principalId)
      )
        return false;
      server.handleUpgrade(request, socket, head, (ws) => {
        sessions.set(ws, grant);
        ws.on("close", () => sessions.delete(ws));
        ws.on("error", () => {
          sessions.delete(ws);
          ws.terminate();
        });
        ws.on("message", (data, binary) => {
          if (!binary && data.toString() === "ping") ws.send("pong");
          else ws.close(1008, "Only ping is supported");
        });
        ws.send(
          JSON.stringify({
            v: 1,
            topic: grant.topics[0],
            type: "connected",
            at: new Date(now()).toISOString(),
          }),
        );
      });
      return true;
    },
    publish(room, event) {
      if (closed || !isRealtimeTopic(event.topic)) return;
      try {
        const payload = JSON.stringify(toRealtimeEvent(event));
        for (const [ws, grant] of sessions) {
          if (grant.room !== room || !grant.topics.includes(event.topic))
            continue;
          if (ws.readyState !== WebSocket.OPEN) continue;
          if (ws.bufferedAmount > 1024 * 1024) {
            ws.terminate();
            continue;
          }
          ws.send(payload, (error) => {
            if (error) ws.terminate();
          });
        }
      } catch {
        /* Publishing cannot turn a committed mutation into a failure. */
      }
    },
    close() {
      closed = true;
      for (const ws of sessions.keys()) ws.terminate();
      sessions.clear();
      tickets.clear();
      upgrades.clear();
      server.close();
    },
  };
}
