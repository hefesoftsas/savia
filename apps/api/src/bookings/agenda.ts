import { z } from "@hono/zod-openapi";
import { PersonalCalendarService } from "../personal-calendars/service";
import { createPersonalIntegrationRepository } from "../personal-integrations/repository";
import type { PersonalIntegrationNangoClient } from "../personal-integrations/contracts";
import { createBookingCalendarAdapter } from "./calendar";
import { localInstant } from "./domain";
import type { BusyInterval } from "./contracts";

const grantSchema = z
  .object({
    connections: z
      .array(
        z
          .object({
            provider: z.enum(["google_calendar", "outlook"]),
            connectionId: z.string().min(1),
          })
          .strict(),
      )
      .max(2),
    sourceIds: z.array(z.string().min(1)).max(20),
  })
  .strict();
const providers = ["google_calendar", "outlook"] as const;

/** Owner-authorized busy intervals only; never return private meeting metadata. */
export class BookingAgenda {
  private readonly calendars: PersonalCalendarService;
  private readonly integrations;
  private readonly adapter;

  constructor(
    private readonly db: D1Database,
    options: {
      secret?: string;
      nango?: PersonalIntegrationNangoClient;
      calendars?: PersonalCalendarService;
    } = {},
  ) {
    this.calendars =
      options.calendars ??
      new PersonalCalendarService(db, { secret: options.secret });
    this.integrations = createPersonalIntegrationRepository(db);
    this.adapter = options.nango
      ? createBookingCalendarAdapter(db, options.nango)
      : undefined;
  }

  private async read(tenantId: number, principalId: string) {
    const row = await this.db
      .prepare(
        "SELECT config FROM tenant_booking_agenda_grants WHERE tenant_id=? AND principal_id=?",
      )
      .bind(tenantId, principalId)
      .first<{ config: string }>();
    return row ? grantSchema.parse(JSON.parse(row.config)) : null;
  }

  async status(tenantId: number, principalId: string) {
    const grant = await this.read(tenantId, principalId);
    return {
      enabled: grant !== null,
      sourceCount: grant
        ? grant.connections.length + grant.sourceIds.length
        : 0,
    };
  }

  async authorize(tenantId: number, principalId: string, enabled: boolean) {
    if (!enabled) {
      await this.db
        .prepare(
          "DELETE FROM tenant_booking_agenda_grants WHERE tenant_id=? AND principal_id=?",
        )
        .bind(tenantId, principalId)
        .run();
      return;
    }
    const connections = [];
    for (const provider of providers) {
      const connection = await this.integrations.findActiveConnection(
        principalId,
        provider,
      );
      if (connection?.status === "connected")
        connections.push({ provider, connectionId: connection.id });
    }
    const sourceIds = (await this.calendars.list(principalId)).map(
      (source) => source.id,
    );
    await this.db
      .prepare(
        "INSERT INTO tenant_booking_agenda_grants(tenant_id,principal_id,config) VALUES(?,?,?) ON CONFLICT(tenant_id,principal_id) DO UPDATE SET config=excluded.config",
      )
      .bind(
        tenantId,
        principalId,
        JSON.stringify(grantSchema.parse({ connections, sourceIds })),
      )
      .run();
  }

  async busy(input: {
    tenantId: number;
    principalId: string;
    from: string;
    to: string;
    refresh?: boolean;
    skipConnectionId?: string;
    excludeEvent?: {
      provider: "google_calendar" | "outlook";
      id: string;
      connectionId: string;
    };
  }): Promise<BusyInterval[]> {
    const grant = await this.read(input.tenantId, input.principalId);
    if (!grant) return [];
    const result: BusyInterval[] = [];
    for (const connection of grant.connections) {
      if (connection.connectionId === input.skipConnectionId) continue;
      if (!this.adapter)
        throw new Error("The authorized agenda calendar is unavailable.");
      result.push(
        ...(await this.adapter.busy({
          ...connection,
          principalId: input.principalId,
          from: input.from,
          to: input.to,
          ...(input.excludeEvent?.provider === connection.provider &&
          input.excludeEvent.connectionId === connection.connectionId
            ? { excludeExternalId: input.excludeEvent.id }
            : {}),
        })),
      );
    }
    const existing = new Set(
      (await this.calendars.list(input.principalId)).map((source) => source.id),
    );
    for (const sourceId of grant.sourceIds) {
      // Deleting an owned source revokes its grant. New/reconnected sources need reauthorization.
      if (!existing.has(sourceId)) continue;
      const events = await this.calendars.events(input.principalId, sourceId, {
        from: input.from,
        to: input.to,
        timeZone: "UTC",
        refresh: input.refresh,
      });
      if (events.stale || events.error)
        throw new Error("An authorized agenda source could not be verified.");
      for (const event of events.data) {
        if (event.busy === false) continue;
        const start = event.allDay
          ? localInstant(event.startsAt, "00:00", event.timeZone)
          : Date.parse(event.startsAt);
        const end = event.allDay
          ? localInstant(event.endsAt, "00:00", event.timeZone)
          : Date.parse(event.endsAt);
        if (
          start === null ||
          end === null ||
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          end <= start
        )
          throw new Error(
            "An authorized agenda event has an invalid interval.",
          );
        result.push({
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
        });
      }
    }
    return result;
  }
}
