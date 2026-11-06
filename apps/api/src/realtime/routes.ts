import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  actorFromContext,
  requirePlatformAdministrator,
} from "../auth/middleware";
import { AuthenticationError } from "../auth/types";
import { accessAuthority } from "../auth/access-context";
import type { AccessScope } from "@savia/studio-shared/access-control";
import type { RealtimeHubClient } from "./hub-client";
import {
  PLATFORM_ROOM,
  isRealtimeRoom,
  principalRoom,
  tenantRoom,
  ticketRequestSchema,
  ticketResponseSchema,
} from "./protocol";

const eventListQuerySchema = z.object({
  after: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(100).default(100),
});
const eventListResponseSchema = z.object({
  data: z.object({
    durable: z.boolean(),
    events: z.array(
      z.object({
        eventId: z.number().int().positive(),
        topic: z.enum(["assistant-threads", "request-pages"]),
        type: z.enum(["created", "updated", "deleted"]),
        collection: z.string(),
        id: z.string(),
        actor: z.string(),
        at: z.string().datetime(),
      }),
    ),
    nextCursor: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  }),
});

const eventsRoute = createRoute({
  method: "get",
  path: "/v1/realtime/events",
  tags: ["Realtime"],
  summary: "Replay durable private change events",
  description:
    "Returns assistant-thread and request-page change hints after a principal-scoped cursor. Repeating a cursor is safe; clients should deduplicate by eventId.",
  security: [{ oauth2: ["savia.api.read"] }],
  request: { query: eventListQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: eventListResponseSchema } },
      description: "Events visible to the authenticated principal",
    },
    410: {
      content: {
        "application/json": {
          schema: z.object({
            error: z.object({
              code: z.literal("REALTIME_CURSOR_EXPIRED"),
              message: z.string(),
              resyncRequired: z.literal(true),
              durable: z.boolean(),
              resetCursor: z.number().int().nonnegative(),
            }),
          }),
        },
      },
      description: "Cursor is older than retained events; refetch full state",
    },
  },
});

type DurableEventRow = {
  event_id: number;
  topic: "assistant-threads" | "request-pages";
  type: "created" | "updated" | "deleted";
  collection: string;
  resource_id: string;
  principal_id: string;
  created_at: string;
};

const ticketRoute = createRoute({
  method: "post",
  path: "/v1/realtime/ticket",
  tags: ["Realtime"],
  summary: "Issue a realtime subscription ticket",
  description:
    "Returns a single-use ticket for the realtime WebSocket. The socket carries only change hints; data is refetched through the API.",
  security: [{ oauth2: ["savia.api.read"] }],
  request: {
    body: {
      content: { "application/json": { schema: ticketRequestSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: {
        "application/json": { schema: ticketResponseSchema },
      },
      description: "Ticket bound to the authorized room and topics",
    },
    429: { description: "Realtime request or connection limit exceeded" },
    403: { description: "Topic or tenant is not authorized for this actor" },
    404: { description: "Tenant was not found" },
    503: { description: "Realtime is not configured" },
  },
});

const platformOnlyTopics = new Set(["users", "tenants"]);
const principalOnlyTopics = new Set([
  "notifications",
  "personal-integrations",
  "account",
  "assistant-threads",
  "request-pages",
]);

export function registerRealtimeRoutes(
  app: OpenAPIHono,
  db: D1Database,
  hub?: RealtimeHubClient,
  durableOutboxRecoveryEnabled = false,
): void {
  app.use("/v1/realtime/*", async (c, next) => {
    const limiter = (c.env as { REALTIME_RATE_LIMITER?: RateLimit } | undefined)
      ?.REALTIME_RATE_LIMITER;
    if (
      limiter &&
      !(
        await limiter.limit({
          key: `principal:${actorFromContext(c).principal.id}`,
        })
      ).success
    ) {
      return c.json(
        {
          error: {
            code: "REALTIME_LIMIT",
            message: "Too many realtime attempts.",
          },
        },
        429,
        { "Retry-After": "60" },
      );
    }
    await next();
  });
  app.openapi(eventsRoute, async (context) => {
    const actor = actorFromContext(context);
    const { after, limit } = context.req.valid("query");
    const retention = await db
      .prepare(
        "SELECT expired_through FROM realtime_event_retention WHERE principal_id=?",
      )
      .bind(actor.principal.id)
      .first<{ expired_through: number }>();
    if (retention && after < retention.expired_through) {
      const highWater = await db
        .prepare(
          `SELECT MAX(event_id) AS event_id FROM realtime_event_outbox
           WHERE principal_id=?`,
        )
        .bind(actor.principal.id)
        .first<{ event_id: number | null }>();
      return context.json(
        {
          error: {
            code: "REALTIME_CURSOR_EXPIRED" as const,
            message: "Refetch current state before resuming realtime events.",
            resyncRequired: true as const,
            durable: durableOutboxRecoveryEnabled,
            resetCursor: Math.max(
              retention.expired_through,
              highWater?.event_id ?? 0,
            ),
          },
        },
        410,
      );
    }
    const { results } = await db
      .prepare(
        `SELECT event_id, topic, type, collection, resource_id,
                principal_id, created_at
         FROM realtime_event_outbox
         WHERE principal_id = ? AND event_id > ?
         ORDER BY event_id LIMIT ?`,
      )
      .bind(actor.principal.id, after, limit + 1)
      .all<DurableEventRow>();
    const hasMore = results.length > limit;
    const page = results.slice(0, limit);
    return context.json(
      {
        data: {
          durable: durableOutboxRecoveryEnabled,
          events: page.map((row) => ({
            eventId: row.event_id,
            topic: row.topic,
            type: row.type,
            collection: row.collection,
            id: row.resource_id,
            actor: row.principal_id,
            at: row.created_at,
          })),
          nextCursor: page.at(-1)?.event_id ?? after,
          hasMore,
        },
      },
      200,
    );
  });
  app.openapi(ticketRoute, async (context) => {
    const actor = actorFromContext(context);
    const input = context.req.valid("json");
    if (!hub) {
      return context.json(
        {
          error: {
            code: "REALTIME_UNAVAILABLE",
            message: "Realtime is not configured.",
          },
        },
        503,
      );
    }
    const wantsPlatformTopics = input.topics.some((topic) =>
      platformOnlyTopics.has(topic),
    );
    const wantsPrincipalTopics = input.topics.some((topic) =>
      principalOnlyTopics.has(topic),
    );
    if (
      Number(wantsPlatformTopics) +
        Number(wantsPrincipalTopics) +
        Number(input.tenantId !== undefined) >
      1
    ) {
      return context.json(
        {
          error: {
            code: "INVALID_TOPIC_SCOPE",
            message:
              "Platform, tenant and principal topics require separate tickets.",
          },
        },
        400,
      );
    }
    if (wantsPlatformTopics) {
      if (input.topics.some((topic) => !platformOnlyTopics.has(topic))) {
        return context.json(
          {
            error: {
              code: "INVALID_TOPIC_SCOPE",
              message:
                "Platform topics cannot be mixed with tenant or principal topics.",
            },
          },
          400,
        );
      }
      requirePlatformAdministrator(actor);
      const issued = await hub.issue(PLATFORM_ROOM, {
        principalId: actor.principal.id,
        topics: input.topics,
      });
      return context.json(
        {
          data: {
            room: PLATFORM_ROOM,
            topics: input.topics,
            ticket: issued.ticket,
            expiresAt: issued.expiresAt,
          },
        },
        201,
      );
    }
    if (wantsPrincipalTopics) {
      if (
        input.topics.some((topic) => !principalOnlyTopics.has(topic)) ||
        (input.principalId !== undefined &&
          input.principalId !== actor.principal.id)
      ) {
        throw new AuthenticationError(
          "AUTHORIZATION_FORBIDDEN",
          "Principal topics are available only to the authenticated account.",
        );
      }
      const room = principalRoom(actor.principal.id);
      const issued = await hub.issue(room, {
        principalId: actor.principal.id,
        topics: input.topics,
      });
      return context.json(
        {
          data: {
            room,
            topics: input.topics,
            ticket: issued.ticket,
            expiresAt: issued.expiresAt,
          },
        },
        201,
      );
    }
    if (input.topics.some((topic) => principalOnlyTopics.has(topic))) {
      throw new AuthenticationError(
        "AUTHORIZATION_FORBIDDEN",
        "Principal topics cannot be subscribed from a tenant room.",
      );
    }
    const tenantId = input.tenantId;
    if (tenantId === undefined) {
      return context.json(
        {
          error: {
            code: "COMMERCIAL_TENANT_REQUIRED",
            message: "A tenantId is required for tenant-scoped topics.",
          },
        },
        400,
      );
    }
    if (input.topics.includes("access-control")) {
      await accessAuthority(
        db,
        actor,
        `tenant:${tenantId}` as AccessScope,
        true,
      );
    }
    const isPlatformAdmin = actor.globalRoles.includes("platform_admin");
    const member = actor.memberships.some(
      (membership) =>
        membership.isActive &&
        (membership.tenantId ?? membership.agencyId) === tenantId,
    );
    if (!isPlatformAdmin && !member) {
      throw new AuthenticationError(
        "AUTHORIZATION_FORBIDDEN",
        "No tienes permiso para suscribirte a este tenant.",
      );
    }
    const room = tenantRoom(tenantId);
    const issued = await hub.issue(room, {
      principalId: actor.principal.id,
      topics: input.topics,
    });
    return context.json(
      {
        data: {
          room,
          topics: input.topics,
          ticket: issued.ticket,
          expiresAt: issued.expiresAt,
        },
      },
      201,
    );
  });

  // Plain route on purpose: WebSocket upgrades are not OpenAPI operations.
  app.get("/v1/realtime/subscribe", async (c) => {
    const room = c.req.query("room");
    const ticket = c.req.query("ticket");
    if (!isRealtimeRoom(room) || !ticket) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "A room and ticket are required.",
          },
        },
        400,
      );
    }
    if (!hub) {
      return c.json(
        {
          error: {
            code: "REALTIME_UNAVAILABLE",
            message: "Realtime is not configured.",
          },
        },
        503,
      );
    }
    const actor = actorFromContext(c);
    if (room === PLATFORM_ROOM) requirePlatformAdministrator(actor);
    else if (room.startsWith("principal:")) {
      if (room !== principalRoom(actor.principal.id))
        throw new AuthenticationError(
          "AUTHORIZATION_FORBIDDEN",
          "Principal room is not authorized.",
        );
    } else if (
      !actor.globalRoles.includes("platform_admin") &&
      !actor.memberships.some(
        (m) => m.isActive && tenantRoom(m.tenantId ?? m.agencyId) === room,
      )
    )
      throw new AuthenticationError(
        "AUTHORIZATION_FORBIDDEN",
        "Room is not authorized.",
      );
    if (!/^[0-9a-f-]{36}$/.test(ticket))
      return c.json(
        { error: { code: "VALIDATION_ERROR", message: "Invalid ticket." } },
        400,
      );
    return hub.forward(room, c.req.raw);
  });
}
