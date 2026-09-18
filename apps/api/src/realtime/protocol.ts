import { z } from "@hono/zod-openapi";

/**
 * Realtime protocol (push notifications, pull data).
 *
 * The socket only carries change hints (`topic` + `type` + identifiers);
 * clients refetch through the authenticated API, so no record payload — and
 * no PII beyond ids the subscriber is already allowed to fetch — travels
 * over the wire.
 */

export const REALTIME_TOPICS = ["users", "tenants", "records"] as const;
export type RealtimeTopic = (typeof REALTIME_TOPICS)[number];

export const PLATFORM_ROOM = "platform";

export function tenantRoom(agencyId: number): string {
  return `tenant:${agencyId}`;
}

const ROOM_PATTERN = /^(platform|tenant:[1-9]\d*)$/;

export function isRealtimeRoom(room: unknown): room is string {
  return typeof room === "string" && ROOM_PATTERN.test(room);
}

export function isRealtimeTopic(topic: unknown): topic is RealtimeTopic {
  return (
    typeof topic === "string" &&
    (REALTIME_TOPICS as readonly string[]).includes(topic)
  );
}

export const realtimeEventSchema = z.object({
  v: z.literal(1),
  topic: z.enum(REALTIME_TOPICS),
  type: z.enum(["created", "updated", "deleted"]),
  collection: z.string().min(1).max(64).optional(),
  id: z.union([z.string(), z.number()]).optional(),
  at: z.string().datetime(),
  actor: z.string().optional(),
});

export type RealtimeEvent = z.infer<typeof realtimeEventSchema>;

export type RealtimeEventInput = Omit<RealtimeEvent, "v" | "at"> & {
  at?: string;
};

export function toRealtimeEvent(input: RealtimeEventInput): RealtimeEvent {
  return {
    v: 1,
    at: new Date().toISOString(),
    ...input,
  };
}

export const TICKET_TTL_MS = 15_000;

export const ticketRequestSchema = z.object({
  topics: z.array(z.enum(REALTIME_TOPICS)).min(1).max(3),
  tenantId: z.number().int().positive().optional(),
});

export type TicketRequest = z.infer<typeof ticketRequestSchema>;

export const ticketResponseSchema = z.object({
  data: z.object({
    room: z.string(),
    ticket: z.string().min(1),
    topics: z.array(z.enum(REALTIME_TOPICS)),
    expiresAt: z.string().datetime(),
  }),
});
