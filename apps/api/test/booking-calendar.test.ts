import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBookingCalendarAdapter,
  type BookingCalendarSyncResult,
} from "../src/bookings/calendar";
import type { PersonalIntegrationNangoClient } from "../src/personal-integrations/contracts";

const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, sql]) => sql);

async function migrate() {
  for (const sql of migrations)
    for (const statement of sql
      .split("--> statement-breakpoint")
      .map((part) =>
        part
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean))
      await env.DB.exec(statement);
}

const principalId = "booking-calendar-integrations-test";
const localConnectionId = "booking-calendar-local-google";

async function seedConnection(
  provider = "google_calendar",
  status = "connected",
) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO identity_principal (
      id,issuer,subject,email,display_name,is_active,created_at,updated_at
    ) VALUES (?, 'savia:better-auth', ?, ?, 'Booking Test', 1, '2026-01-01', '2026-01-01')`,
  )
    .bind(principalId, principalId, `${principalId}@savia.test`)
    .run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO personal_integration_connections (
      id,principal_id,provider,nango_connection_id,nango_integration_id,status,
      external_account_label,external_account_id,scopes,last_validated_at,
      created_at,updated_at,disconnected_at
    ) VALUES (?,?,?,?,?,?,NULL,NULL,'[]',NULL,'2026-01-01','2026-01-01',NULL)`,
  )
    .bind(
      localConnectionId,
      principalId,
      provider,
      `nango-${provider}`,
      `${provider}-integration`,
      status,
    )
    .run();
}

function fakeNango(
  proxy: (request: {
    method: string;
    path: string;
    body?: unknown;
  }) => Promise<Response>,
) {
  return {
    createConnectSession: vi.fn(),
    createReconnectSession: vi.fn(),
    getConnection: vi.fn(),
    deleteConnection: vi.fn(),
    proxy: vi.fn(proxy),
  } as unknown as PersonalIntegrationNangoClient;
}

const noConference: BookingCalendarSyncResult["conference"] = {
  provider: null,
  joinUrl: null,
  status: "unsupported",
};

const readyConference: BookingCalendarSyncResult["conference"] = {
  provider: "google_meet",
  joinUrl: "https://meet.google.com/abc-defg-hij",
  status: "ready",
};

const calendarInput = {
  principalId,
  provider: "google_calendar" as const,
  connectionId: localConnectionId,
  from: "2026-03-01T00:00:00.000Z",
  to: "2026-03-02T00:00:00.000Z",
};

beforeAll(migrate);
beforeEach(async () => {
  await env.DB.prepare(
    "DELETE FROM personal_integration_connections WHERE id=?",
  )
    .bind(localConnectionId)
    .run();
});

describe("booking calendar adapter", () => {
  it("excludes only the booking's own Google event when rescheduling overlapping meetings", async () => {
    await seedConnection();
    const nango = fakeNango(async ({ path }) => {
      if (path.startsWith("/calendar/v3/calendars/primary/events?"))
        return Response.json({
          items: [
            {
              id: "own",
              status: "confirmed",
              start: { dateTime: "2026-03-01T10:00:00Z" },
              end: { dateTime: "2026-03-01T10:30:00Z" },
            },
            {
              id: "other",
              status: "confirmed",
              start: { dateTime: "2026-03-01T10:15:00Z" },
              end: { dateTime: "2026-03-01T10:45:00Z" },
            },
            {
              id: "free",
              status: "confirmed",
              transparency: "transparent",
              start: { dateTime: "2026-03-01T11:00:00Z" },
              end: { dateTime: "2026-03-01T12:00:00Z" },
            },
          ],
        });
      return Response.json({
        calendars: {
          primary: {
            busy: [
              { start: "2026-03-01T10:00:00Z", end: "2026-03-01T10:45:00Z" },
            ],
          },
        },
      });
    });
    const busy = await createBookingCalendarAdapter(env.DB, nango).busy({
      ...calendarInput,
      excludeExternalId: "own",
    });
    expect(busy).toEqual([
      { start: "2026-03-01T10:15:00.000Z", end: "2026-03-01T10:45:00.000Z" },
    ]);
  });
  it("requires the exact active connection pinned by the grant", async () => {
    await seedConnection();
    const nango = fakeNango(async () => Response.json({ calendars: {} }));
    const adapter = createBookingCalendarAdapter(env.DB, nango);
    await expect(
      adapter.busy({ ...calendarInput, connectionId: "some-other-row" }),
    ).rejects.toThrow();
    expect(nango.proxy).not.toHaveBeenCalled();
  });

  it("fails closed on Google freeBusy calendar errors and malformed data", async () => {
    await seedConnection();
    const nango = fakeNango(async () =>
      Response.json({
        calendars: {
          primary: { errors: [{ reason: "secret provider detail" }], busy: [] },
        },
      }),
    );
    const adapter = createBookingCalendarAdapter(env.DB, nango);
    await expect(adapter.busy(calendarInput)).rejects.toThrow(/unavailable/i);
    await expect(adapter.busy(calendarInput)).rejects.not.toThrow(
      /secret provider detail/,
    );
  });

  it("follows every Outlook page and ignores free and cancelled events", async () => {
    await seedConnection("outlook");
    const nango = fakeNango(async ({ path }) =>
      path.includes("skiptoken")
        ? Response.json({
            value: [
              {
                start: { dateTime: "2026-03-01T12:00:00", timeZone: "UTC" },
                end: { dateTime: "2026-03-01T13:00:00", timeZone: "UTC" },
                showAs: "busy",
                isCancelled: true,
              },
            ],
          })
        : Response.json({
            value: [
              {
                start: { dateTime: "2026-03-01T09:00:00", timeZone: "UTC" },
                end: { dateTime: "2026-03-01T10:00:00", timeZone: "UTC" },
                showAs: "free",
                isCancelled: false,
              },
              {
                start: { dateTime: "2026-03-01", timeZone: "UTC" },
                end: { dateTime: "2026-03-02", timeZone: "UTC" },
                isAllDay: true,
                showAs: "busy",
                isCancelled: false,
              },
            ],
            "@odata.nextLink":
              "https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=next",
          }),
    );
    const adapter = createBookingCalendarAdapter(env.DB, nango);
    const busy = await adapter.busy({ ...calendarInput, provider: "outlook" });
    expect(nango.proxy).toHaveBeenCalledTimes(2);
    expect(busy).toHaveLength(1);
    expect(busy[0]).toEqual({
      start: "2026-03-01T00:00:00.000Z",
      end: "2026-03-02T00:00:00.000Z",
    });
  });

  it("treats partial Outlook busy items as unavailable", async () => {
    await seedConnection("outlook");
    const nango = fakeNango(async () =>
      Response.json({
        value: [
          {
            start: { dateTime: "2026-03-01T09:00:00", timeZone: "UTC" },
            end: { dateTime: "2026-03-01T10:00:00", timeZone: "UTC" },
          },
        ],
      }),
    );
    await expect(
      createBookingCalendarAdapter(env.DB, nango).busy({
        ...calendarInput,
        provider: "outlook",
      }),
    ).rejects.toThrow(/unavailable/i);
  });

  it("uses deterministic Google IDs and recovers create conflicts by updating", async () => {
    await seedConnection();
    const requests: Array<{ method: string; path: string; body?: unknown }> =
      [];
    const nango = fakeNango(async ({ method, path, body }) => {
      requests.push({ method, path, body });
      if (path === "/calendar/v3/calendars/primary")
        return Response.json({
          conferenceProperties: {
            allowedConferenceSolutionTypes: ["hangoutsMeet"],
          },
        });
      if (method === "GET")
        return Response.json({
          id: path.split("?")[0]?.split("/").at(-1),
          conferenceData: {
            conferenceSolution: { key: { type: "hangoutsMeet" } },
            entryPoints: [
              {
                entryPointType: "video",
                uri: "https://meet.google.com/abc-defg-hij",
              },
            ],
          },
        });
      return method === "POST"
        ? new Response(null, { status: 409 })
        : Response.json({ id: "stable-event-id" });
    });
    const adapter = createBookingCalendarAdapter(env.DB, nango);
    const input = {
      ...calendarInput,
      id: "booking-42",
      title: "Consultation",
      startsAt: "2026-03-01T09:00:00Z",
      endsAt: "2026-03-01T10:00:00Z",
      externalId: null,
      cancelled: false,
    };
    await adapter.sync(input);
    await adapter.sync(input);
    expect(requests.map(({ method }) => method)).toEqual([
      "GET",
      "POST",
      "GET",
      "PATCH",
      "GET",
      "POST",
      "GET",
      "PATCH",
    ]);
    const expectedId = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode("booking-42"),
    );
    const hexId = Array.from(new Uint8Array(expectedId), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    expect(requests[1]?.path).toBe(
      "/calendar/v3/calendars/primary/events?conferenceDataVersion=1",
    );
    expect((requests[1]?.body as { id?: string })?.id).toBe(hexId);
    expect(requests[2]?.path).toContain(
      `/calendar/v3/calendars/primary/events/${hexId}`,
    );
    expect(requests[3]?.body).not.toHaveProperty(
      "conferenceData.createRequest",
    );
  });

  it("creates a Google Meet conference only when the calendar supports it", async () => {
    await seedConnection();
    const requests: Array<{ method: string; path: string; body?: unknown }> =
      [];
    const nango = fakeNango(async ({ method, path, body }) => {
      requests.push({ method, path, body });
      if (path === "/calendar/v3/calendars/primary")
        return Response.json({
          conferenceProperties: {
            allowedConferenceSolutionTypes: ["hangoutsMeet"],
          },
        });
      return Response.json({
        id: (body as { id?: string })?.id,
        conferenceData: {
          conferenceSolution: { key: { type: "hangoutsMeet" } },
          createRequest: { status: { statusCode: "pending" } },
        },
      });
    });
    const result = await createBookingCalendarAdapter(env.DB, nango).sync({
      ...calendarInput,
      id: "booking-meet-pending",
      title: "Consultation",
      startsAt: "2026-03-01T09:00:00Z",
      endsAt: "2026-03-01T10:00:00Z",
      externalId: null,
      cancelled: false,
    });
    expect(result).toEqual({
      externalId: (requests[1]?.body as { id?: string })?.id,
      conference: { provider: "google_meet", joinUrl: null, status: "pending" },
    });
    expect(requests[1]?.path).toContain("conferenceDataVersion=1");
    expect(requests[1]?.body).toMatchObject({
      conferenceData: {
        createRequest: {
          requestId: (requests[1]?.body as { id?: string })?.id,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    });
  });

  it("preserves the requested Google provider while conference provisioning is pending", async () => {
    await seedConnection();
    const requests: Array<{ method: string; path: string; body?: unknown }> =
      [];
    const nango = fakeNango(async ({ method, path, body }) => {
      requests.push({ method, path, body });
      if (path === "/calendar/v3/calendars/primary")
        return Response.json({
          conferenceProperties: {
            allowedConferenceSolutionTypes: ["hangoutsMeet"],
          },
        });
      if (method === "POST")
        return Response.json({ id: (body as { id?: string })?.id });
      return Response.json({
        id: path.split("?")[0]?.split("/").at(-1),
      });
    });
    const adapter = createBookingCalendarAdapter(env.DB, nango);
    const input = {
      ...calendarInput,
      id: "booking-meet-retry",
      title: "Consultation",
      startsAt: "2026-03-01T09:00:00Z",
      endsAt: "2026-03-01T10:00:00Z",
      externalId: null,
      cancelled: false,
    };
    const created = await adapter.sync(input);
    expect(created).toMatchObject({
      externalId: expect.any(String),
      conference: { provider: "google_meet", joinUrl: null, status: "pending" },
    });
    await expect(
      adapter.sync({
        ...input,
        externalId: created.externalId,
        conferenceProvider: "google_meet",
      }),
    ).resolves.toEqual({
      externalId: created.externalId,
      conference: { provider: "google_meet", joinUrl: null, status: "pending" },
    });
    expect(requests.map(({ method }) => method)).toEqual([
      "GET",
      "POST",
      "GET",
      "PATCH",
    ]);
    expect(requests[3]?.body).not.toHaveProperty(
      "conferenceData.createRequest",
    );
  });

  it("returns unsupported for a valid calendar with no supported conference provider", async () => {
    await seedConnection();
    const requests: Array<{ method: string; path: string; body?: unknown }> =
      [];
    const nango = fakeNango(async ({ method, path, body }) => {
      requests.push({ method, path, body });
      if (path === "/calendar/v3/calendars/primary")
        return Response.json({
          conferenceProperties: {
            allowedConferenceSolutionTypes: ["eventHangout"],
          },
        });
      return Response.json({ id: (body as { id?: string })?.id });
    });
    const result = await createBookingCalendarAdapter(env.DB, nango).sync({
      ...calendarInput,
      id: "booking-no-meet",
      title: "Consultation",
      startsAt: "2026-03-01T09:00:00Z",
      endsAt: "2026-03-01T10:00:00Z",
      externalId: null,
      cancelled: false,
    });
    expect(result).toEqual({
      externalId: (requests[1]?.body as { id?: string })?.id,
      conference: noConference,
    });
    expect(requests[1]?.body).not.toHaveProperty("conferenceData");
  });

  it.each([
    "teams.microsoft.com",
    "gov.teams.microsoft.us",
    "dod.teams.microsoft.us",
    "teams.microsoftonline.cn",
  ])(
    "creates a Teams meeting at %s when Outlook advertises Teams support",
    async (host) => {
      await seedConnection("outlook");
      const requests: Array<{ method: string; path: string; body?: unknown }> =
        [];
      const nango = fakeNango(async ({ method, path, body }) => {
        requests.push({ method, path, body });
        if (path.startsWith("/v1.0/me/calendar?"))
          return Response.json({
            allowedOnlineMeetingProviders: ["teamsForBusiness"],
          });
        if (method === "GET") return Response.json({ value: [] });
        return Response.json({
          id: "teams-event",
          isOnlineMeeting: true,
          onlineMeetingProvider: "teamsForBusiness",
          onlineMeeting: {
            joinUrl: `https://${host}/l/meetup-join/abc`,
          },
        });
      });
      const result = await createBookingCalendarAdapter(env.DB, nango).sync({
        ...calendarInput,
        provider: "outlook",
        id: "booking-teams-ready",
        title: "Consultation",
        startsAt: "2026-03-01T09:00:00Z",
        endsAt: "2026-03-01T10:00:00Z",
        externalId: null,
        cancelled: false,
      });
      expect(result).toEqual({
        externalId: "teams-event",
        conference: {
          provider: "teams",
          joinUrl: `https://${host}/l/meetup-join/abc`,
          status: "ready",
        },
      });
      expect(requests[2]?.body).toMatchObject({
        isOnlineMeeting: true,
        onlineMeetingProvider: "teamsForBusiness",
      });
    },
  );

  it("fails retryably when conference capability data is malformed", async () => {
    await seedConnection();
    const nango = fakeNango(async () =>
      Response.json({ conferenceProperties: {} }),
    );
    await expect(
      createBookingCalendarAdapter(env.DB, nango).sync({
        ...calendarInput,
        id: "booking-bad-capability",
        title: "Consultation",
        startsAt: "2026-03-01T09:00:00Z",
        endsAt: "2026-03-01T10:00:00Z",
        externalId: null,
        cancelled: false,
      }),
    ).rejects.toThrow(/unavailable/i);
  });

  it("rejects a Google create response whose ID does not match the stable booking ID", async () => {
    await seedConnection();
    const nango = fakeNango(async ({ path }) =>
      path === "/calendar/v3/calendars/primary"
        ? Response.json({
            conferenceProperties: { allowedConferenceSolutionTypes: [] },
          })
        : Response.json({ id: "unexpected-event-id" }),
    );
    await expect(
      createBookingCalendarAdapter(env.DB, nango).sync({
        ...calendarInput,
        id: "booking-unexpected-id",
        title: "Consultation",
        startsAt: "2026-03-01T09:00:00Z",
        endsAt: "2026-03-01T10:00:00Z",
        externalId: null,
        cancelled: false,
      }),
    ).rejects.toThrow(/unavailable/i);
  });

  it("marks a Teams conference failed when Outlook explicitly returns it disabled", async () => {
    await seedConnection("outlook");
    const nango = fakeNango(async ({ path }) =>
      path.startsWith("/v1.0/me/events/")
        ? Response.json({ id: "disabled-teams", isOnlineMeeting: false })
        : Response.json({ id: "disabled-teams" }),
    );
    const result = await createBookingCalendarAdapter(env.DB, nango).sync({
      ...calendarInput,
      provider: "outlook",
      id: "booking-disabled-teams",
      title: "Consultation",
      startsAt: "2026-03-01T09:00:00Z",
      endsAt: "2026-03-01T10:00:00Z",
      externalId: "disabled-teams",
      conferenceProvider: "teams",
      cancelled: false,
    });
    expect(result).toEqual({
      externalId: "disabled-teams",
      conference: { provider: "teams", joinUrl: null, status: "failed" },
    });
  });

  it("keeps the existing Google conference when a booking is rescheduled", async () => {
    await seedConnection();
    const requests: Array<{ method: string; path: string; body?: unknown }> =
      [];
    const nango = fakeNango(async ({ method, path, body }) => {
      requests.push({ method, path, body });
      if (method === "GET")
        return Response.json({
          id: "stable-meet",
          hangoutLink: "https://meet.google.com/abc-defg-hij",
        });
      return Response.json({
        id: "stable-meet",
        hangoutLink: "https://meet.google.com/abc-defg-hij",
      });
    });
    const result = await createBookingCalendarAdapter(env.DB, nango).sync({
      ...calendarInput,
      id: "booking-reschedule",
      title: "Consultation",
      startsAt: "2026-03-02T09:00:00Z",
      endsAt: "2026-03-02T10:00:00Z",
      externalId: "stable-meet",
      cancelled: false,
    });
    expect(result).toEqual({
      externalId: "stable-meet",
      conference: readyConference,
    });
    expect(requests.map(({ method }) => method)).toEqual(["GET", "PATCH"]);
    expect(requests[1]?.path).toContain("conferenceDataVersion=1");
    expect(requests[1]?.body).not.toHaveProperty(
      "conferenceData.createRequest",
    );
  });

  it("treats provider-specific cancellation not-found responses as success", async () => {
    await seedConnection();
    const input = {
      ...calendarInput,
      id: "booking-cancel",
      title: "Consultation",
      startsAt: "2026-03-01T09:00:00Z",
      endsAt: "2026-03-01T10:00:00Z",
      externalId: "persisted-google-id",
      cancelled: true,
    };
    for (const status of [404, 410]) {
      const google = fakeNango(async () => new Response(null, { status }));
      await expect(
        createBookingCalendarAdapter(env.DB, google).sync(input),
      ).resolves.toEqual({
        externalId: "persisted-google-id",
        conference: null,
      });
    }
    await seedConnection("outlook");
    const outlook = fakeNango(async () => new Response(null, { status: 404 }));
    await expect(
      createBookingCalendarAdapter(env.DB, outlook).sync({
        ...input,
        provider: "outlook",
      }),
    ).resolves.toEqual({ externalId: "persisted-google-id", conference: null });
  });

  it("deletes the deterministic Google event when create returned before persistence", async () => {
    await seedConnection();
    const requests: Array<{ method: string; path: string }> = [];
    const nango = fakeNango(async ({ method, path }) => {
      requests.push({ method, path });
      return new Response(null, { status: 204 });
    });
    const input = {
      ...calendarInput,
      id: "booking-google-lost-create",
      title: "Consultation",
      startsAt: "2026-03-01T09:00:00Z",
      endsAt: "2026-03-01T10:00:00Z",
      externalId: null,
      cancelled: true,
    };
    const externalId = await createBookingCalendarAdapter(env.DB, nango).sync(
      input,
    );
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(input.id),
    );
    const expectedId = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    expect(externalId).toEqual({ externalId: expectedId, conference: null });
    expect(requests).toEqual([
      {
        method: "DELETE",
        path: `/calendar/v3/calendars/primary/events/${expectedId}`,
      },
    ]);
  });

  it("uses a stable Outlook transaction ID on create and the persisted ID on update", async () => {
    await seedConnection("outlook");
    const requests: Array<{ method: string; path: string; body?: unknown }> =
      [];
    const nango = fakeNango(async ({ method, path, body }) => {
      requests.push({ method, path, body });
      if (path.startsWith("/v1.0/me/calendar?"))
        return Response.json({
          allowedOnlineMeetingProviders: ["teamsForBusiness"],
        });
      if (path.startsWith("/v1.0/me/events/persisted-outlook-id"))
        return Response.json({ id: "persisted-outlook-id" });
      if (method === "GET") return Response.json({ value: [] });
      return method === "POST"
        ? Response.json({ id: "outlook-event" })
        : new Response(null, { status: 204 });
    });
    const adapter = createBookingCalendarAdapter(env.DB, nango);
    const input = {
      ...calendarInput,
      provider: "outlook" as const,
      id: "booking-outlook",
      title: "Service only",
      startsAt: "2026-03-01T09:00:00Z",
      endsAt: "2026-03-01T10:00:00Z",
      externalId: null,
      cancelled: false,
    };
    await expect(adapter.sync(input)).resolves.toEqual({
      externalId: "outlook-event",
      conference: { provider: "teams", joinUrl: null, status: "pending" },
    });
    expect(requests[2]?.body).toMatchObject({
      isOnlineMeeting: true,
      onlineMeetingProvider: "teamsForBusiness",
    });
    await adapter.sync({ ...input, externalId: "persisted-outlook-id" });
    expect(requests.map(({ method }) => method)).toEqual([
      "GET",
      "GET",
      "POST",
      "GET",
      "PATCH",
    ]);
    expect(
      (requests[2]?.body as { transactionId?: string })?.transactionId,
    ).toBeTruthy();
    expect(requests[2]?.body).toHaveProperty("singleValueExtendedProperties", [
      {
        id: "String {6f8d1c44-1ab2-4e1e-9e8f-0123456789ab} Name SaviaBookingId",
        value: input.id,
      },
    ]);
    expect(requests[4]).toMatchObject({
      method: "PATCH",
      path: "/v1.0/me/events/persisted-outlook-id",
    });
    expect(requests[2]?.body).not.toHaveProperty("attendees");
  });

  it("recovers an Outlook create whose response was lost by finding its booking marker", async () => {
    await seedConnection("outlook");
    const requests: Array<{ method: string; path: string; body?: unknown }> =
      [];
    let lookupCount = 0;
    const nango = fakeNango(async ({ method, path, body }) => {
      requests.push({ method, path, body });
      if (path.startsWith("/v1.0/me/calendar?"))
        return Response.json({
          allowedOnlineMeetingProviders: ["teamsForBusiness"],
        });
      if (method === "POST") throw new Error("simulated lost create response");
      if (method === "GET" && lookupCount++ === 0)
        return Response.json({ value: [] });
      if (method === "GET" && path.includes("filter"))
        return Response.json({
          value: [
            {
              id: "recovered-outlook-event",
              singleValueExtendedProperties: [
                {
                  id: "String {6f8d1c44-1ab2-4e1e-9e8f-0123456789ab} Name SaviaBookingId",
                  value: "booking-outlook-retry",
                },
              ],
            },
          ],
        });
      if (method === "GET")
        return Response.json({ id: "recovered-outlook-event" });
      return new Response(null, { status: 204 });
    });
    const adapter = createBookingCalendarAdapter(env.DB, nango);
    const input = {
      ...calendarInput,
      provider: "outlook" as const,
      id: "booking-outlook-retry",
      title: "Service only",
      startsAt: "2026-03-01T09:00:00Z",
      endsAt: "2026-03-01T10:00:00Z",
      externalId: null,
      cancelled: false,
    };
    await expect(adapter.sync(input)).rejects.toThrow(/unavailable/i);
    await expect(adapter.sync(input)).resolves.toEqual({
      externalId: "recovered-outlook-event",
      conference: { provider: "teams", joinUrl: null, status: "pending" },
    });
    expect(requests.map(({ method }) => method)).toEqual([
      "GET",
      "GET",
      "POST",
      "GET",
      "GET",
      "GET",
      "PATCH",
    ]);
    expect(requests[5]?.path).toContain(
      "/v1.0/me/events/recovered-outlook-event?",
    );
    expect(decodeURIComponent(requests[1]?.path ?? "")).toContain(input.id);
  });

  it("fails closed when Outlook booking marker lookup is malformed or ambiguous", async () => {
    await seedConnection("outlook");
    for (const payload of [
      { value: [{ id: "one" }, { id: "two" }] },
      { value: [{ id: 42 }] },
      { value: [{ id: "missing-marker" }] },
      { value: "not-an-event-list" },
    ]) {
      const nango = fakeNango(async () => Response.json(payload));
      await expect(
        createBookingCalendarAdapter(env.DB, nango).sync({
          ...calendarInput,
          provider: "outlook",
          id: "booking-ambiguous",
          title: "Service",
          startsAt: "2026-03-01T09:00:00Z",
          endsAt: "2026-03-01T10:00:00Z",
          externalId: null,
          cancelled: true,
        }),
      ).rejects.toThrow(/unavailable/i);
    }
  });

  it("cancels an Outlook event recovered by its marker when its ID was not persisted", async () => {
    await seedConnection("outlook");
    const requests: Array<{ method: string; path: string }> = [];
    const nango = fakeNango(async ({ method, path }) => {
      requests.push({ method, path });
      if (method === "GET")
        return Response.json({
          value: [
            {
              id: "lost-outlook-event",
              singleValueExtendedProperties: [
                {
                  id: "String {6f8d1c44-1ab2-4e1e-9e8f-0123456789ab} Name SaviaBookingId",
                  value: "booking-outlook-cancel",
                },
              ],
            },
          ],
        });
      return new Response(null, { status: 204 });
    });
    const result = await createBookingCalendarAdapter(env.DB, nango).sync({
      ...calendarInput,
      provider: "outlook",
      id: "booking-outlook-cancel",
      title: "Service only",
      startsAt: "2026-03-01T09:00:00Z",
      endsAt: "2026-03-01T10:00:00Z",
      externalId: null,
      cancelled: true,
    });
    expect(result).toEqual({
      externalId: "lost-outlook-event",
      conference: null,
    });
    expect(requests.map(({ method }) => method)).toEqual(["GET", "DELETE"]);
    expect(requests[1]?.path).toBe("/v1.0/me/events/lost-outlook-event");
  });
});
