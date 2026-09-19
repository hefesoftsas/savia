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

/** Hibernating push hub, one instance per authorized room. */
export class RealtimeHub extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS realtime_tickets (
      ticket TEXT PRIMARY KEY, principal TEXT NOT NULL, topics TEXT NOT NULL,
      expires INTEGER NOT NULL
    ); CREATE INDEX IF NOT EXISTS realtime_tickets_expiry ON realtime_tickets(expires);
    CREATE INDEX IF NOT EXISTS realtime_tickets_principal ON realtime_tickets(principal);`);
  }

  private atConnectionLimit(principal: string): boolean {
    return (
      this.ctx.getWebSockets(`principal:${principal}`).length >= 8 ||
      this.ctx.getWebSockets().length >= 1000
    );
  }

  private limited(): Response {
    return Response.json(
      {
        error: {
          code: "REALTIME_LIMIT",
          message: "Realtime capacity exceeded.",
        },
      },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

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
        {
          error: { code: "VALIDATION_ERROR", message: "Invalid ticket grant" },
        },
        { status: 400 },
      );
    }
    if (this.atConnectionLimit(grant.principalId)) return this.limited();
    await this.pruneTickets();
    const sql = this.ctx.storage.sql;
    const pending = sql
      .exec<{ count: number }>(
        "SELECT count(*) AS count FROM realtime_tickets WHERE principal = ?",
        grant.principalId,
      )
      .one().count;
    if (
      pending >= 8 ||
      sql
        .exec<{ count: number }>(
          "SELECT count(*) AS count FROM realtime_tickets",
        )
        .one().count >= 1000
    )
      return this.limited();
    const ticket = crypto.randomUUID();
    const expiresAt = Date.now() + TICKET_TTL_MS;
    sql.exec(
      "INSERT INTO realtime_tickets VALUES (?, ?, ?, ?)",
      ticket,
      grant.principalId,
      JSON.stringify([...new Set(grant.topics)]),
      expiresAt,
    );
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
    if (!ticket || !/^[0-9a-f-]{36}$/.test(ticket))
      return new Response("Invalid ticket", { status: 401 });
    // Atomic consumption avoids replay even with concurrent upgrades.
    const row = this.ctx.storage.sql
      .exec<{ principal: string; topics: string; expires: number }>(
        "DELETE FROM realtime_tickets WHERE ticket = ? RETURNING principal, topics, expires",
        ticket,
      )
      .toArray()[0];
    // Keep in-flight tickets from the previous deployment usable for their 15s TTL.
    const grant: TicketGrant | undefined = row
      ? {
          principalId: row.principal,
          topics: JSON.parse(row.topics),
          expiresAt: row.expires,
        }
      : await this.ctx.storage.get<TicketGrant>(ticketKey(ticket));
    if (!row && grant) await this.ctx.storage.delete(ticketKey(ticket));
    if (!grant || grant.expiresAt <= Date.now())
      return new Response("Invalid or expired ticket", { status: 401 });
    if (this.atConnectionLimit(grant.principalId)) return this.limited();
    return this.upgrade(grant);
  }

  private async upgrade(grant: TicketGrant): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [
      ...grant.topics.map(topicTag),
      `principal:${grant.principalId}`,
    ]);
    const greeting = JSON.stringify({
      v: 1,
      topic: grant.topics[0],
      type: "connected",
      at: new Date().toISOString(),
    });
    server.send(greeting);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, _message: string | ArrayBuffer) {
    // Only the runtime-handled plain ping is permitted. Reject everything else
    // immediately, without parsing or retaining attacker-controlled payloads.
    try {
      ws.close(1008, "Only ping is supported");
    } catch {
      /* close race */
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
    this.ctx.storage.sql.exec(
      "DELETE FROM realtime_tickets WHERE ticket IN (SELECT ticket FROM realtime_tickets WHERE expires <= ? ORDER BY expires LIMIT 128)",
      Date.now(),
    );
    // Bounded retirement of the previous KV ticket format; no new KV tickets.
    const legacy = await this.ctx.storage.list<TicketGrant>({
      prefix: "ticket:",
      limit: 128,
    });
    const expired = [...legacy]
      .filter(([, grant]) => grant.expiresAt <= Date.now())
      .map(([key]) => key);
    if (expired.length) await this.ctx.storage.delete(expired);
  }
}
