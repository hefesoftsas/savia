import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import {
  actorFromContext,
  requirePlatformAdministrator,
} from "../auth/middleware";
import { AuthenticationError } from "../auth/types";
import type { RealtimeHubClient } from "./hub-client";
import {
  PLATFORM_ROOM,
  isRealtimeRoom,
  tenantRoom,
  ticketRequestSchema,
  ticketResponseSchema,
} from "./protocol";

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

export function registerRealtimeRoutes(
  app: OpenAPIHono,
  hub?: RealtimeHubClient,
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
    const wantsPlatformTopics = input.topics.some(
      (topic) => topic === "users" || topic === "tenants",
    );
    if (wantsPlatformTopics) {
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
    const tenantId = input.tenantId;
    if (tenantId === undefined) {
      return context.json(
        {
          error: {
            code: "COMMERCIAL_TENANT_REQUIRED",
            message: "A tenantId is required for record topics.",
          },
        },
        400,
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
    else if (
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
