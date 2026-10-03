import { createPersonalIntegrationRepository } from "../personal-integrations/repository";
import type { PersonalIntegrationNangoClient } from "../personal-integrations/contracts";
import type { ActivePersonalIntegrationConnection } from "../personal-integrations/contracts";

type BookingProvider = "google_calendar" | "outlook";
type BookingCalendarInput = {
  principalId: string;
  provider: BookingProvider;
  connectionId: string;
};
type BusyInput = BookingCalendarInput & { from: string; to: string };
type SyncInput = BookingCalendarInput & {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  externalId: string | null;
  cancelled: boolean;
};
type BusyPeriod = { start: string; end: string };

const unavailable = () => new Error("Booking calendar is unavailable");
const outlookUtcPreference = { prefer: 'outlook.timezone="UTC"' } as const;
const outlookBookingPropertyId =
  "String {6f8d1c44-1ab2-4e1e-9e8f-0123456789ab} Name SaviaBookingId";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function validInstant(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function dateRange(value: unknown): BusyPeriod | undefined {
  const item = record(value);
  const start = validInstant(item?.start);
  const end = validInstant(item?.end);
  if (!start || !end || end <= start) return undefined;
  return { start, end };
}

function graphDateTime(value: string): { dateTime: string; timeZone: "UTC" } {
  return { dateTime: new Date(value).toISOString(), timeZone: "UTC" };
}

function outlookInstant(value: unknown): string | undefined {
  const date = record(value);
  if (!date || typeof date.dateTime !== "string") return undefined;
  const dateTime = date.dateTime;
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(dateTime)
    ? dateTime
    : typeof date.timeZone === "string" && date.timeZone.toUpperCase() === "UTC"
      ? `${dateTime}Z`
      : undefined;
  return withZone ? validInstant(withZone) : undefined;
}

function outlookPeriod(value: unknown): BusyPeriod | undefined {
  const item = record(value);
  const start = outlookInstant(item?.start);
  const end = outlookInstant(item?.end);
  if (!start || !end || end <= start) return undefined;
  return { start, end };
}

function nextGraphPath(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > 4096) throw unavailable();
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "graph.microsoft.com")
      throw unavailable();
    return `${url.pathname}${url.search}`;
  } catch {
    throw unavailable();
  }
}

function eventPath(provider: BookingProvider, id: string): string {
  return provider === "google_calendar"
    ? `/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}`
    : `/v1.0/me/events/${encodeURIComponent(id)}`;
}

async function bookingEventId(id: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(id),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function createBookingCalendarAdapter(
  db: D1Database,
  nango: PersonalIntegrationNangoClient,
) {
  const repository = createPersonalIntegrationRepository(db);

  async function connectionFor(
    input: BookingCalendarInput,
  ): Promise<ActivePersonalIntegrationConnection> {
    const connection = await repository.findActiveConnection(
      input.principalId,
      input.provider,
    );
    if (
      !connection ||
      connection.status !== "connected" ||
      connection.id !== input.connectionId ||
      connection.principalId !== input.principalId ||
      connection.provider !== input.provider
    )
      throw unavailable();
    return connection;
  }

  async function proxy(
    connection: ActivePersonalIntegrationConnection,
    request: Omit<
      Parameters<PersonalIntegrationNangoClient["proxy"]>[0],
      "connection"
    >,
  ): Promise<Response> {
    try {
      const response = await nango.proxy({ ...request, connection });
      if (!response.ok) throw unavailable();
      return response;
    } catch {
      throw unavailable();
    }
  }

  async function findOutlookEvent(
    connection: ActivePersonalIntegrationConnection,
    bookingId: string,
  ): Promise<string | null> {
    const quote = (value: string) => value.replace(/'/g, "''");
    const filter = `singleValueExtendedProperties/Any(ep:ep/id eq '${quote(outlookBookingPropertyId)}' and ep/value eq '${quote(bookingId)}')`;
    const expand = `singleValueExtendedProperties($filter=id eq '${quote(outlookBookingPropertyId)}')`;
    const path = `/v1.0/me/events?${new URLSearchParams({
      $filter: filter,
      $select: "id",
      $expand: expand,
    })}`;
    const response = await proxy(connection, {
      method: "GET",
      path,
      upstreamHeaders: outlookUtcPreference,
    });
    const payload = record(await response.json().catch(() => undefined));
    if (!Array.isArray(payload?.value)) throw unavailable();
    if (payload.value.length === 0) return null;
    if (payload.value.length !== 1) throw unavailable();
    const event = record(payload.value[0]);
    if (typeof event?.id !== "string" || !event.id) throw unavailable();
    if (!Array.isArray(event.singleValueExtendedProperties))
      throw unavailable();
    const matchingProperties = event.singleValueExtendedProperties.filter(
      (property: unknown) => {
        const item = record(property);
        return item?.id === outlookBookingPropertyId;
      },
    );
    if (
      matchingProperties.length !== 1 ||
      record(matchingProperties[0])?.value !== bookingId
    )
      throw unavailable();
    return event.id;
  }

  return {
    async busy(input: BusyInput): Promise<BusyPeriod[]> {
      const from = validInstant(input.from);
      const to = validInstant(input.to);
      if (!from || !to || to <= from) throw unavailable();
      const connection = await connectionFor(input);
      if (input.provider === "google_calendar") {
        const response = await proxy(connection, {
          method: "POST",
          path: "/calendar/v3/freeBusy",
          body: {
            timeMin: from,
            timeMax: to,
            items: [{ id: "primary" }],
          },
        });
        const payload = record(await response.json().catch(() => undefined));
        const calendars = record(payload?.calendars);
        const primary = record(calendars?.primary);
        const calendarErrors = primary?.errors;
        if (
          !primary ||
          (calendarErrors !== undefined &&
            (!Array.isArray(calendarErrors) || calendarErrors.length > 0)) ||
          !Array.isArray(primary.busy)
        )
          throw unavailable();
        const periods = primary.busy.map(dateRange);
        if (periods.some((period) => !period)) throw unavailable();
        return periods as BusyPeriod[];
      }

      let path = `/v1.0/me/calendarView?${new URLSearchParams({
        startDateTime: from,
        endDateTime: to,
        $top: "1000",
        $select: "start,end,showAs,isCancelled,isAllDay",
      })}`;
      const periods: BusyPeriod[] = [];
      const seen = new Set<string>();
      while (path) {
        if (seen.has(path) || seen.size >= 100) throw unavailable();
        seen.add(path);
        const response = await proxy(connection, {
          method: "GET",
          path,
          upstreamHeaders: outlookUtcPreference,
        });
        const payload = record(await response.json().catch(() => undefined));
        if (!Array.isArray(payload?.value)) throw unavailable();
        for (const rawEvent of payload.value) {
          const event = record(rawEvent);
          if (
            !event ||
            typeof event.isCancelled !== "boolean" ||
            typeof event.showAs !== "string"
          )
            throw unavailable();
          const period = outlookPeriod(event);
          if (!event || !period) throw unavailable();
          if (event.isCancelled === true || event.showAs === "free") continue;
          periods.push(period);
        }
        path = nextGraphPath(payload["@odata.nextLink"]) ?? "";
      }
      return periods;
    },

    async sync(input: SyncInput): Promise<string | null> {
      const startsAt = validInstant(input.startsAt);
      const endsAt = validInstant(input.endsAt);
      if (
        !input.id ||
        !input.title.trim() ||
        !startsAt ||
        !endsAt ||
        endsAt <= startsAt
      )
        throw unavailable();
      const connection = await connectionFor(input);
      if (input.cancelled) {
        const id =
          input.externalId ??
          (input.provider === "google_calendar"
            ? await bookingEventId(input.id)
            : await findOutlookEvent(connection, input.id));
        if (!id) return null;
        const request = {
          method: "DELETE" as const,
          path: eventPath(input.provider, id),
          ...(input.provider === "outlook"
            ? { upstreamHeaders: outlookUtcPreference }
            : {}),
        };
        try {
          const response = await nango.proxy({ ...request, connection });
          if (
            response.ok ||
            (input.provider === "google_calendar" &&
              (response.status === 404 || response.status === 410)) ||
            (input.provider === "outlook" && response.status === 404)
          )
            return id;
          throw unavailable();
        } catch {
          throw unavailable();
        }
      }

      const body =
        input.provider === "google_calendar"
          ? {
              summary: input.title,
              start: { dateTime: startsAt },
              end: { dateTime: endsAt },
            }
          : {
              subject: input.title,
              start: graphDateTime(startsAt),
              end: graphDateTime(endsAt),
              singleValueExtendedProperties: [
                { id: outlookBookingPropertyId, value: input.id },
              ],
            };
      if (input.provider === "google_calendar") {
        const id = input.externalId ?? (await bookingEventId(input.id));
        const eventBody = { ...body, id };
        if (input.externalId) {
          await proxy(connection, {
            method: "PUT",
            path: eventPath(input.provider, id),
            body: eventBody,
          });
          return id;
        }
        try {
          const response = await nango.proxy({
            method: "POST",
            path: "/calendar/v3/calendars/primary/events",
            connection,
            body: eventBody,
          });
          if (response.ok) return id;
          if (response.status === 409) {
            await proxy(connection, {
              method: "PUT",
              path: eventPath(input.provider, id),
              body: eventBody,
            });
            return id;
          }
          throw unavailable();
        } catch {
          throw unavailable();
        }
      }

      const existingId =
        input.externalId ?? (await findOutlookEvent(connection, input.id));
      if (existingId) {
        await proxy(connection, {
          method: "PATCH",
          path: eventPath(input.provider, existingId),
          body,
          upstreamHeaders: outlookUtcPreference,
        });
        return existingId;
      }
      const transactionId = await bookingEventId(input.id);
      const response = await proxy(connection, {
        method: "POST",
        path: "/v1.0/me/events",
        body: { ...body, transactionId },
        upstreamHeaders: outlookUtcPreference,
      });
      const event = record(await response.json().catch(() => undefined));
      if (typeof event?.id !== "string" || !event.id) throw unavailable();
      return event.id;
    },
  };
}
