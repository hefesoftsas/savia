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

const ticketKey = (ticket: string) => `ticket:${ticket}`;
const topicTag = (topic: string) => `topic:${topic}`;

/**
 * Push hub, one instance per room (`platform` or `tenant:<id>`).
 *
 * Built for ~zero cost with the WebSocket Hibernation API:
 * - sockets carry their subscribed topics as tags, so broadcast needs no
 *   in-memory map and survives eviction;
 * - ping is answered with a millisecond wake-up instead of holding the
 *   object in memory (no WebSocketRequestResponsePair dependency, so it
 *   also runs on older workerd builds);
 * - single-use tickets live in SQLite storage (bytes, never billed
 *   meaningfully) instead of memory, so they survive eviction too.
 * The object only runs for ticket issuance, publishes, connects and pings.
 *
 * Room isolation is the tenant boundary: a socket only ever receives events
 * published to the room it authenticated for. The hub keeps no record data,
 * only tickets.
 */
export class RealtimeHub extends DurableObject {
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
    await this.pruneTickets();
    const ticket = crypto.randomUUID();
    const expiresAt = Date.now() + TICKET_TTL_MS;
    await this.ctx.storage.put<TicketGrant>(ticketKey(ticket), {
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
    if (ticket) await this.pruneTickets();
    const grant = ticket
      ? await this.ctx.storage.get<TicketGrant>(ticketKey(ticket))
      : undefined;
    if (!ticket || !grant || grant.expiresAt <= Date.now()) {
      if (ticket) await this.ctx.storage.delete(ticketKey(ticket));
      return new Response("Invalid or expired ticket", { status: 401 });
    }
    await this.ctx.storage.delete(ticketKey(ticket));
    return this.upgrade(grant);
  }

  private async upgrade(grant: TicketGrant): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(
      server,
      grant.topics.map(topicTag),
    );
    const greeting = JSON.stringify({
      v: 1,
      topic: grant.topics[0],
      type: "connected",
      at: new Date().toISOString(),
    });
    server.send(greeting);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    // Plain "ping" is the client keepalive (answered directly; the wake-up
    // lasts milliseconds). Every other client message is ignored so a
    // misbehaving client can neither subscribe beyond its grant nor wake the
    // object into doing work. Unknown sockets are dropped.
    const meta = this.ctx.getTags(ws);
    if (meta.length === 0) {
      try {
        ws.close(4401, "unknown socket");
      } catch {
        // ignore close races
      }
      return;
    }
    const text = typeof message === "string" ? message : "";
    const isPing =
      text === "ping" ||
      (() => {
        try {
          return (JSON.parse(text) as { type?: unknown }).type === "ping";
        } catch {
          return false;
        }
      })();
    if (!isPing) return;
    try {
      ws.send("pong");
    } catch {
      try {
        ws.close(1011, "send failed");
      } catch {
        // ignore close races
      }
    }
  }

  async webSocketClose(ws: WebSocket) {
    try {
      ws.close();
    } catch {
      // ignore close races
    }
  }

  async webSocketError(ws: WebSocket) {
    try {
      ws.close(1011, "socket error");
    } catch {
      // ignore close races
    }
  }

  private broadcast(event: { topic: string } & Record<string, unknown>): void {
    const payload = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets(topicTag(event.topic))) {
      try {
        ws.send(payload);
      } catch {
        try {
          ws.close(1011, "send failed");
        } catch {
          // ignore close races
        }
      }
    }
  }

  private async pruneTickets(): Promise<void> {
    const expired: string[] = [];
    for (const [key, grant] of await this.ctx.storage.list<TicketGrant>({
      prefix: "ticket:",
    })) {
      if (grant.expiresAt <= Date.now()) expired.push(key);
    }
    if (expired.length) await this.ctx.storage.delete(expired);
  }
}
