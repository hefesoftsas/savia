import { HTTPException } from "hono/http-exception";
export class RealtimeHubError extends HTTPException {
  constructor(message: string) {
    super(429, {
      res: Response.json(
        { error: { code: "REALTIME_LIMIT", message } },
        { status: 429, headers: { "Retry-After": "60" } },
      ),
    });
  }
}
export class RealtimeUnavailableError extends HTTPException {
  constructor(message = "Realtime is not configured.") {
    super(503, {
      res: Response.json(
        { error: { code: "REALTIME_UNAVAILABLE", message } },
        { status: 503 },
      ),
    });
  }
}
import type { RealtimeEventInput } from "./protocol";

/**
 * Worker-side client for a RealtimeHub room. Publishing is fire-and-forget:
 * realtime must never break a mutation, so every failure is swallowed after
 * a best-effort attempt.
 */
export interface RealtimeHubClient {
  publish(room: string, event: RealtimeEventInput): void;
  issue(
    room: string,
    grant: { principalId: string; topics: string[] },
  ): Promise<{ ticket: string; expiresAt: string }>;
  forward(room: string, request: Request): Promise<Response>;
}

function stub(
  namespace: DurableObjectNamespace | undefined,
  room: string,
): DurableObjectStub | undefined {
  try {
    if (!namespace) return undefined;
    return namespace.get(namespace.idFromName(room));
  } catch {
    return undefined;
  }
}

export function createRealtimeHubClient(
  namespace: DurableObjectNamespace | undefined,
): RealtimeHubClient {
  return {
    publish(room, event) {
      const target = stub(namespace, room);
      if (!target) return;
      void target
        .fetch("https://realtime.internal/publish", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ event }),
        })
        .catch(() => undefined);
    },

    async issue(room, grant) {
      const target = stub(namespace, room);
      if (!target) throw new RealtimeUnavailableError();
      const response = await target.fetch("https://realtime.internal/issue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(grant),
      });
      if (response.status === 429)
        throw new RealtimeHubError("Realtime capacity exceeded.");
      if (!response.ok) throw new Error("Unable to issue realtime ticket");
      const body = (await response.json()) as {
        data?: { ticket?: unknown; expiresAt?: unknown };
      };
      if (
        typeof body.data?.ticket !== "string" ||
        typeof body.data?.expiresAt !== "string"
      ) {
        throw new Error("Invalid realtime ticket response");
      }
      return { ticket: body.data.ticket, expiresAt: body.data.expiresAt };
    },

    async forward(room, request) {
      const target = stub(namespace, room);
      if (!target) {
        return Response.json(
          {
            error: {
              code: "REALTIME_UNAVAILABLE",
              message: "Realtime is not configured.",
            },
          },
          { status: 503 },
        );
      }
      const url = new URL(request.url);
      url.pathname = "/session";
      return target.fetch(
        new Request(url, {
          method: request.method,
          headers: request.headers,
        }),
      );
    },
  };
}

/**
 * Best-effort publish from mutation routes. Never throws: callers invoke it
 * after the mutation already succeeded.
 */
export function publishRealtime(
  hub: RealtimeHubClient | undefined,
  room: string,
  event: RealtimeEventInput,
): void {
  try {
    hub?.publish(room, event);
  } catch {
    // realtime must never break a mutation
  }
}
