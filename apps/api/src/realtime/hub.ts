import { DurableObject } from "cloudflare:workers";
import {
  TICKET_TTL_MS,
  isRealtimeTopic,
  toRealtimeEvent,
  type RealtimeEventInput,
} from "./protocol";

type TicketGrant = {
  principalId: string;
  topics: string[];
  expiresAt: number;
};

type SocketMeta = {
  principalId: string;
  topics: Set<string>;
};

type ClientMessage =
  | { type: "ping" }
  | { type: "subscribe"; topics: string[] }
  | { type: "unsubscribe"; topics: string[] };

/**
 * Push hub, one instance per room (`platform` or `tenant:<id>`).
 *
 * Room isolation is the tenant boundary: a socket only ever receives events
 * published to the room it authenticated for. The hub keeps no record data,
 * only sockets and short-lived single-use tickets.
 *
 * NOTE: sockets live in memory (no hibernation API). Evictions drop
 * connections and clients reconnect with backoff — safe because every event
 * is a hint and clients refetch authoritative state.
 */
export class RealtimeHub extends DurableObject {
  private readonly sockets = new Map<WebSocket, SocketMeta>();
  private readonly tickets = new Map<string, TicketGrant>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname.endsWith("/issue")) {
      return this.issueTicket(await request.json().catch(() => undefined));
    }
    if (request.method === "POST" && url.pathname.endsWith("/publish")) {
      return this.ingest(await request.json().catch(() => undefined));
    }
    if (request.method === "GET" && url.pathname.endsWith("/session")) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected websocket upgrade", { status: 426 });
      }
      return this.openSession(url.searchParams.get("ticket"));
    }
    return new Response("Not found", { status: 404 });
  }

  private async issueTicket(body: unknown): Promise<Response> {
    const grant =
      body && typeof body === "object"
        ? (body as {
            principalId?: unknown;
            topics?: unknown;
          })
        : {};
    if (
      typeof grant.principalId !== "string" ||
      !grant.principalId ||
      !Array.isArray(grant.topics) ||
      grant.topics.length === 0 ||
      !grant.topics.every(isRealtimeTopic)
    ) {
      return Response.json(
        { error: { code: "VALIDATION_ERROR", message: "Invalid ticket grant" } },
        { status: 400 },
      );
    }
    this.pruneTickets();
    const ticket = crypto.randomUUID();
    const expiresAt = Date.now() + TICKET_TTL_MS;
    this.tickets.set(ticket, {
      principalId: grant.principalId,
      topics: [...new Set(grant.topics)],
      expiresAt,
    });
    return Response.json({
      data: { ticket, expiresAt: new Date(expiresAt).toISOString() },
    });
  }

  private async ingest(body: unknown): Promise<Response> {
    const event =
      body && typeof body === "object"
        ? (body as { event?: unknown }).event
        : undefined;
    if (
      !event ||
      typeof event !== "object" ||
      !(event as { topic?: unknown }).topic ||
      !isRealtimeTopic((event as { topic?: unknown }).topic)
    ) {
      return Response.json(
        { error: { code: "VALIDATION_ERROR", message: "Invalid event" } },
        { status: 400 },
      );
    }
    this.broadcast(toRealtimeEvent(event as RealtimeEventInput));
    return Response.json({ data: { ok: true } });
  }

  private async openSession(ticket: string | null): Promise<Response> {
    if (ticket) this.pruneTickets();
    const grant = ticket ? this.tickets.get(ticket) : undefined;
    if (!grant || grant.expiresAt <= Date.now()) {
      if (ticket) this.tickets.delete(ticket);
      return new Response("Invalid or expired ticket", { status: 401 });
    }
    this.tickets.delete(ticket!);
    return this.upgrade(grant);
  }

  private async upgrade(grant: TicketGrant): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    this.sockets.set(server, {
      principalId: grant.principalId,
      topics: new Set(grant.topics),
    });
    server.send(
      JSON.stringify({
        v: 1,
        topic: grant.topics[0],
        type: "connected",
        at: new Date().toISOString(),
      }),
    );
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const meta = this.sockets.get(ws);
    if (!meta) {
      ws.close(4401, "unknown socket");
      return;
    }
    let parsed: ClientMessage | undefined;
    try {
      parsed =
        typeof message === "string"
          ? (JSON.parse(message) as ClientMessage)
          : undefined;
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object") return;
    if (parsed.type === "ping") {
      ws.send(JSON.stringify({ v: 1, type: "pong" }));
      return;
    }
    if (
      (parsed.type === "subscribe" || parsed.type === "unsubscribe") &&
      Array.isArray(parsed.topics)
    ) {
      for (const topic of parsed.topics) {
        if (!isRealtimeTopic(topic)) continue;
        if (parsed.type === "subscribe") meta.topics.add(topic);
        else meta.topics.delete(topic);
      }
      ws.send(
        JSON.stringify({
          v: 1,
          type: "subscriptions",
          topics: [...meta.topics],
        }),
      );
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.sockets.delete(ws);
  }

  async webSocketError(ws: WebSocket) {
    try {
      ws.close(1011, "socket error");
    } catch {
      // ignore close races
    }
    this.sockets.delete(ws);
  }

  private broadcast(event: { topic: string } & Record<string, unknown>): void {
    const payload = JSON.stringify(event);
    for (const [ws, meta] of this.sockets) {
      if (!meta.topics.has(event.topic)) continue;
      try {
        ws.send(payload);
      } catch {
        try {
          ws.close(1011, "send failed");
        } catch {
          // ignore close races
        }
        this.sockets.delete(ws);
      }
    }
  }

  private pruneTickets(): void {
    const now = Date.now();
    for (const [ticket, grant] of this.tickets) {
      if (grant.expiresAt <= now) this.tickets.delete(ticket);
    }
  }
}
