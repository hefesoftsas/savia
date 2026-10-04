import { createPersonalIntegrationRepository } from "../personal-integrations/repository";
import type { PersonalIntegrationNangoClient } from "../personal-integrations/contracts";
import type { ActivePersonalIntegrationConnection } from "../personal-integrations/contracts";
import { localInstant } from "./domain";

type BookingProvider = "google_calendar" | "outlook";
type BookingCalendarInput = {
  principalId: string;
  provider: BookingProvider;
  connectionId: string;
};
type BusyInput = BookingCalendarInput & {
  from: string;
  to: string;
  excludeExternalId?: string;
};
type SyncInput = BookingCalendarInput & {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  externalId: string | null;
  cancelled: boolean;
  conferenceProvider?: "google_meet" | "teams";
  requestConference?: boolean;
};
type BusyPeriod = { start: string; end: string };

export type BookingCalendarSyncResult = {
  externalId: string | null;
  conference: {
    provider: "google_meet" | "teams" | null;
    joinUrl: string | null;
    status: "ready" | "pending" | "unsupported" | "failed";
  } | null;
};

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

const unsupportedConference: NonNullable<
  BookingCalendarSyncResult["conference"]
> = {
  provider: null,
  joinUrl: null,
  status: "unsupported",
};

function safeJoinUrl(
  value: unknown,
  provider: "google_meet" | "teams",
): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const hostAllowed =
      provider === "google_meet"
        ? url.hostname === "meet.google.com"
        : [
            "teams.microsoft.com",
            "teams.live.com",
            "teams.cloud.microsoft",
            "gov.teams.microsoft.us",
            "dod.teams.microsoft.us",
            "teams.microsoftonline.cn",
          ].includes(url.hostname);
    if (
      url.protocol !== "https:" ||
      !hostAllowed ||
      url.username ||
      url.password
    )
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

function googleConference(
  value: unknown,
  previouslyRequested = false,
): BookingCalendarSyncResult["conference"] {
  const event = record(value);
  const conferenceData = record(event?.conferenceData);
  if (!conferenceData && typeof event?.hangoutLink === "string") {
    const joinUrl = safeJoinUrl(event.hangoutLink, "google_meet");
    return joinUrl
      ? { provider: "google_meet", joinUrl, status: "ready" }
      : previouslyRequested
        ? { provider: "google_meet", joinUrl: null, status: "pending" }
        : unsupportedConference;
  }
  if (!conferenceData)
    return previouslyRequested
      ? { provider: "google_meet", joinUrl: null, status: "pending" }
      : unsupportedConference;
  const createRequest = record(conferenceData.createRequest);
  const status = record(createRequest?.status)?.statusCode;
  if (status === "failure" || status === "FAILURE")
    return { provider: "google_meet", joinUrl: null, status: "failed" };
  const solution = record(conferenceData.conferenceSolution);
  const solutionType = record(solution?.key)?.type;
  const isMeet = solutionType === "hangoutsMeet" || previouslyRequested;
  if (!isMeet) return unsupportedConference;
  const entries = Array.isArray(conferenceData.entryPoints)
    ? conferenceData.entryPoints
    : [];
  const video = entries.find(
    (entry) => record(entry)?.entryPointType === "video",
  );
  const joinUrl = safeJoinUrl(
    record(video)?.uri ?? event?.hangoutLink,
    "google_meet",
  );
  if (joinUrl) return { provider: "google_meet", joinUrl, status: "ready" };
  return { provider: "google_meet", joinUrl: null, status: "pending" };
}

function outlookConference(
  value: unknown,
  previouslyRequested = false,
): BookingCalendarSyncResult["conference"] {
  const event = record(value);
  if (event?.isOnlineMeeting === false && previouslyRequested)
    return { provider: "teams", joinUrl: null, status: "failed" };
  if (
    event?.isOnlineMeeting !== true ||
    event.onlineMeetingProvider !== "teamsForBusiness"
  )
    return previouslyRequested
      ? { provider: "teams", joinUrl: null, status: "pending" }
      : unsupportedConference;
  const joinUrl = safeJoinUrl(record(event.onlineMeeting)?.joinUrl, "teams");
  return joinUrl
    ? { provider: "teams", joinUrl, status: "ready" }
    : { provider: "teams", joinUrl: null, status: "pending" };
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

  async function conferenceCapability(
    connection: ActivePersonalIntegrationConnection,
    provider: BookingProvider,
  ): Promise<"google_meet" | "teams" | null> {
    const response = await proxy(connection, {
      method: "GET",
      path:
        provider === "google_calendar"
          ? "/calendar/v3/calendars/primary"
          : "/v1.0/me/calendar?$select=allowedOnlineMeetingProviders",
    });
    const payload = record(await response.json().catch(() => undefined));
    if (!payload) throw unavailable();
    if (provider === "google_calendar") {
      const properties = record(payload.conferenceProperties);
      if (
        !properties ||
        !Array.isArray(properties.allowedConferenceSolutionTypes) ||
        properties.allowedConferenceSolutionTypes.some(
          (item) => typeof item !== "string",
        )
      )
        throw unavailable();
      return properties.allowedConferenceSolutionTypes.includes("hangoutsMeet")
        ? "google_meet"
        : null;
    }
    if (
      !Array.isArray(payload.allowedOnlineMeetingProviders) ||
      payload.allowedOnlineMeetingProviders.some(
        (item) => typeof item !== "string",
      )
    )
      throw unavailable();
    return payload.allowedOnlineMeetingProviders.includes("teamsForBusiness")
      ? "teams"
      : null;
  }

  async function eventConference(
    connection: ActivePersonalIntegrationConnection,
    provider: BookingProvider,
    id: string,
    conferenceProvider?: "google_meet" | "teams",
    strictAbsent = false,
  ): Promise<BookingCalendarSyncResult["conference"]> {
    const response = await proxy(connection, {
      method: "GET",
      path:
        provider === "google_calendar"
          ? `${eventPath(provider, id)}?fields=id,conferenceData,hangoutLink`
          : `${eventPath(provider, id)}?${new URLSearchParams({
              $select: "id,isOnlineMeeting,onlineMeetingProvider,onlineMeeting",
            })}`,
      ...(provider === "outlook"
        ? { upstreamHeaders: outlookUtcPreference }
        : {}),
    });
    const event = record(await response.json().catch(() => undefined));
    if (!event || event.id !== id) throw unavailable();
    if (provider === "google_calendar") {
      if (
        strictAbsent &&
        !record(event.conferenceData) &&
        typeof event.hangoutLink !== "string"
      )
        return unsupportedConference;
      return googleConference(event, conferenceProvider === "google_meet");
    }
    if (
      strictAbsent &&
      event.isOnlineMeeting !== false &&
      (event.isOnlineMeeting !== true ||
        event.onlineMeetingProvider !== "teamsForBusiness")
    )
      return unsupportedConference;
    return outlookConference(event, conferenceProvider === "teams");
  }

  return {
    async busy(input: BusyInput): Promise<BusyPeriod[]> {
      const from = validInstant(input.from);
      const to = validInstant(input.to);
      if (!from || !to || to <= from) throw unavailable();
      const connection = await connectionFor(input);
      if (input.provider === "google_calendar") {
        if (input.excludeExternalId) {
          const periods: BusyPeriod[] = [];
          const tokens = new Set<string>();
          let pageToken: string | undefined;
          do {
            const query = new URLSearchParams({
              timeMin: from,
              timeMax: to,
              singleEvents: "true",
              maxResults: "2500",
              ...(pageToken ? { pageToken } : {}),
            });
            const response = await proxy(connection, {
              method: "GET",
              path: `/calendar/v3/calendars/primary/events?${query}`,
            });
            const payload = record(
              await response.json().catch(() => undefined),
            );
            if (!Array.isArray(payload?.items)) throw unavailable();
            for (const raw of payload.items) {
              const event = record(raw);
              if (
                !event ||
                typeof event.id !== "string" ||
                typeof event.status !== "string"
              )
                throw unavailable();
              if (
                event.id === input.excludeExternalId ||
                event.status === "cancelled" ||
                event.transparency === "transparent"
              )
                continue;
              const instant = (value: unknown) => {
                const date = record(value);
                if (typeof date?.dateTime === "string")
                  return validInstant(date.dateTime);
                if (
                  typeof date?.date !== "string" ||
                  !/^\d{4}-\d{2}-\d{2}$/.test(date.date)
                )
                  return undefined;
                const zone = date.timeZone ?? payload.timeZone;
                if (typeof zone !== "string") return undefined;
                const time = localInstant(date.date, "00:00", zone);
                return time === null ? undefined : new Date(time).toISOString();
              };
              const start = instant(event.start),
                end = instant(event.end);
              if (!start || !end || end <= start) throw unavailable();
              periods.push({ start, end });
            }
            const next = payload.nextPageToken;
            if (
              next !== undefined &&
              (typeof next !== "string" ||
                !next ||
                next.length > 4096 ||
                tokens.has(next) ||
                tokens.size >= 100)
            )
              throw unavailable();
            pageToken = next as string | undefined;
            if (pageToken) tokens.add(pageToken);
          } while (pageToken);
          return periods;
        }
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
        $select: "id,start,end,showAs,isCancelled,isAllDay",
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
          if (input.excludeExternalId) {
            if (typeof event.id !== "string") throw unavailable();
            if (event.id === input.excludeExternalId) continue;
          }
          const period = outlookPeriod(event);
          if (!event || !period) throw unavailable();
          if (event.isCancelled === true || event.showAs === "free") continue;
          periods.push(period);
        }
        path = nextGraphPath(payload["@odata.nextLink"]) ?? "";
      }
      return periods;
    },

    async sync(input: SyncInput): Promise<BookingCalendarSyncResult> {
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
        if (!id) return { externalId: null, conference: null };
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
            return { externalId: id, conference: null };
          throw unavailable();
        } catch {
          throw unavailable();
        }
      }

      const conferenceProvider =
        input.requestConference || !input.externalId
          ? await conferenceCapability(connection, input.provider)
          : null;
      const baseBody =
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
        const eventBody = {
          ...baseBody,
          id,
          ...(!input.externalId && conferenceProvider === "google_meet"
            ? {
                conferenceData: {
                  createRequest: {
                    requestId: id,
                    conferenceSolutionKey: { type: "hangoutsMeet" },
                  },
                },
              }
            : {}),
        };
        const query =
          conferenceProvider === "google_meet" || input.externalId
            ? "?conferenceDataVersion=1"
            : "";
        if (input.externalId) {
          const currentConference = await eventConference(
            connection,
            input.provider,
            id,
            input.conferenceProvider ?? conferenceProvider ?? undefined,
            input.requestConference === true,
          );
          const shouldRequest =
            input.requestConference &&
            conferenceProvider === "google_meet" &&
            currentConference?.status !== "ready" &&
            currentConference?.status !== "pending";
          await proxy(connection, {
            method: "PATCH",
            path: `${eventPath(input.provider, id)}${query}`,
            body: {
              ...eventBody,
              ...(shouldRequest
                ? {
                    conferenceData: {
                      createRequest: {
                        requestId:
                          currentConference?.status === "failed"
                            ? crypto.randomUUID()
                            : await bookingEventId(input.id),
                        conferenceSolutionKey: { type: "hangoutsMeet" },
                      },
                    },
                  }
                : {}),
            },
          });
          return {
            externalId: id,
            conference: shouldRequest
              ? await eventConference(
                  connection,
                  input.provider,
                  id,
                  "google_meet",
                )
              : (currentConference ?? unsupportedConference),
          };
        }
        try {
          const response = await nango.proxy({
            method: "POST",
            path: `/calendar/v3/calendars/primary/events${query}`,
            connection,
            body: eventBody,
          });
          if (response.ok) {
            const event = record(await response.json().catch(() => undefined));
            if (typeof event?.id === "string" && event.id !== id)
              throw unavailable();
            return {
              externalId: id,
              conference: conferenceProvider
                ? googleConference(event, conferenceProvider === "google_meet")
                : unsupportedConference,
            };
          }
          if (response.status === 409) {
            const currentConference = await eventConference(
              connection,
              input.provider,
              id,
              conferenceProvider ?? undefined,
              input.requestConference === true,
            );
            const shouldRequest =
              input.requestConference &&
              conferenceProvider === "google_meet" &&
              currentConference?.status !== "ready" &&
              currentConference?.status !== "pending";
            await proxy(connection, {
              method: "PATCH",
              path: `${eventPath(input.provider, id)}${query}`,
              body: {
                ...baseBody,
                id,
                ...(shouldRequest
                  ? {
                      conferenceData: {
                        createRequest: {
                          requestId:
                            currentConference?.status === "failed"
                              ? crypto.randomUUID()
                              : id,
                          conferenceSolutionKey: { type: "hangoutsMeet" },
                        },
                      },
                    }
                  : {}),
              },
            });
            return {
              externalId: id,
              conference: shouldRequest
                ? await eventConference(
                    connection,
                    input.provider,
                    id,
                    "google_meet",
                  )
                : currentConference,
            };
          }
          throw unavailable();
        } catch {
          throw unavailable();
        }
      }

      const existingId =
        input.externalId ?? (await findOutlookEvent(connection, input.id));
      if (existingId) {
        const currentConference = await eventConference(
          connection,
          input.provider,
          existingId,
          input.conferenceProvider ?? conferenceProvider ?? undefined,
          input.requestConference === true,
        );
        const shouldRequest =
          input.requestConference &&
          conferenceProvider === "teams" &&
          currentConference?.status !== "ready" &&
          currentConference?.status !== "pending";
        const response = await proxy(connection, {
          method: "PATCH",
          path: eventPath(input.provider, existingId),
          body: {
            ...baseBody,
            ...(shouldRequest
              ? {
                  isOnlineMeeting: true,
                  onlineMeetingProvider: "teamsForBusiness",
                }
              : {}),
          },
          upstreamHeaders: outlookUtcPreference,
        });
        const patched = record(await response.json().catch(() => undefined));
        return {
          externalId: existingId,
          conference: shouldRequest
            ? outlookConference(patched, true)
            : (currentConference ?? unsupportedConference),
        };
      }
      const transactionId = await bookingEventId(input.id);
      const response = await proxy(connection, {
        method: "POST",
        path: "/v1.0/me/events",
        body: {
          ...baseBody,
          transactionId,
          ...(conferenceProvider === "teams"
            ? {
                isOnlineMeeting: true,
                onlineMeetingProvider: "teamsForBusiness",
              }
            : {}),
        },
        upstreamHeaders: outlookUtcPreference,
      });
      const event = record(await response.json().catch(() => undefined));
      if (typeof event?.id !== "string" || !event.id) throw unavailable();
      const conference =
        conferenceProvider === "teams"
          ? outlookConference(event, true)
          : unsupportedConference;
      return {
        externalId: event.id,
        conference,
      };
    },
  };
}
