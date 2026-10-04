import { describe, expect, it, vi } from "vitest";
import { PersonalIntegrationOperations } from "../src/personal-integrations/operations";
import type { PersonalIntegrationRepository } from "../src/personal-integrations/contracts";

function operations(
  provider: "google_calendar" | "outlook",
  pages: Response[],
) {
  const connection = {
    id: "calendar-connection",
    principalId: "principal-1",
    provider,
    status: "connected" as const,
    nangoConnectionId: "nango-connection",
    nangoIntegrationId: "calendar-integration",
    externalAccountLabel: null,
    externalAccountId: null,
    scopes: [],
    lastValidatedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const repository = {
    findActiveConnection: vi.fn().mockResolvedValue(connection),
  } as unknown as PersonalIntegrationRepository;
  const proxy = vi.fn(async () => pages.shift() ?? Response.json({}));
  return {
    service: new PersonalIntegrationOperations(repository, { proxy } as never),
    proxy,
  };
}

const range = {
  from: new Date("2026-01-01T00:00:00.000Z"),
  to: new Date("2026-02-01T00:00:00.000Z"),
};

const outlookCalendarSelect =
  "id,subject,start,end,webLink,isAllDay,isCancelled,showAs,originalStartTimeZone,originalEndTimeZone,isOnlineMeeting,onlineMeetingProvider,onlineMeeting,singleValueExtendedProperties";
const outlookVideoCallExpand =
  "singleValueExtendedProperties($filter=id eq 'String {6f8d1c44-1ab2-4e1e-9e8f-0123456789ac} Name SaviaVideoCall' or id eq 'String {6f8d1c44-1ab2-4e1e-9e8f-0123456789ac} Name SaviaConferenceProvider' or id eq 'String {6f8d1c44-1ab2-4e1e-9e8f-0123456789ac} Name SaviaConferenceUrl')";

function outlookCalendarContinuation(
  overrides: Record<string, string> = {},
): string {
  const params = new URLSearchParams({
    startDateTime: range.from.toISOString(),
    endDateTime: range.to.toISOString(),
    $top: "100",
    $orderby: "start/dateTime",
    $expand: outlookVideoCallExpand,
    $select: outlookCalendarSelect,
    $skiptoken: "opaque",
    ...overrides,
  });
  return `https://graph.microsoft.com/v1.0/me/calendarView?${params.toString()}`;
}

describe("personal calendar provider pagination", () => {
  it("loads all Google events across nextPageToken pages and preserves all-day metadata", async () => {
    const { service, proxy } = operations("google_calendar", [
      Response.json({
        items: [
          {
            id: "timed",
            start: {
              dateTime: "2026-01-01T09:00:00-05:00",
              timeZone: "America/New_York",
            },
            end: {
              dateTime: "2026-01-01T10:00:00-05:00",
              timeZone: "America/New_York",
            },
          },
          {
            id: "all-day",
            start: { date: "2026-01-02" },
            end: { date: "2026-01-03" },
          },
          {
            id: "cancelled",
            status: "cancelled",
            start: { date: "2026-01-04" },
            end: { date: "2026-01-05" },
          },
          ...Array.from({ length: 23 }, (_, index) => ({
            id: `first-page-${index}`,
          })),
        ],
        nextPageToken: "page-two",
      }),
      Response.json({
        items: [
          { id: "second-page", start: { dateTime: "2026-01-05T12:00:00Z" } },
        ],
      }),
    ]);

    const events = await service.listEvents({
      principalId: "principal-1",
      provider: "google_calendar",
      ...range,
    });

    expect(events).toHaveLength(26);
    expect(events.map((event) => event.id)).toEqual([
      "timed",
      "all-day",
      ...Array.from({ length: 23 }, (_, index) => `first-page-${index}`),
      "second-page",
    ]);
    expect(events[0]).toMatchObject({
      allDay: false,
      timeZone: "America/New_York",
    });
    expect(events[1]).toMatchObject({
      allDay: true,
      startsAt: "2026-01-02",
      endsAt: "2026-01-03",
    });
    expect(proxy).toHaveBeenCalledTimes(2);
    expect(proxy.mock.calls[1]?.[0].path).toContain("pageToken=page-two");
  });

  it("follows only Outlook calendarView continuations for the original range", async () => {
    const next = outlookCalendarContinuation();
    const { service, proxy } = operations("outlook", [
      Response.json({
        value: [
          {
            id: "all-day",
            isAllDay: true,
            originalStartTimeZone: "UTC",
            originalEndTimeZone: "UTC",
            start: { dateTime: "2026-01-02T00:00:00", timeZone: "UTC" },
            end: { dateTime: "2026-01-03T00:00:00", timeZone: "UTC" },
          },
          ...Array.from({ length: 49 }, (_, index) => ({
            id: `first-page-${index}`,
            isAllDay: false,
          })),
        ],
        "@odata.nextLink": next,
      }),
      Response.json({
        value: [
          {
            id: "timed",
            isAllDay: false,
            start: { dateTime: "2026-01-04T09:00:00", timeZone: "UTC" },
            end: { dateTime: "2026-01-04T10:00:00", timeZone: "UTC" },
          },
        ],
      }),
    ]);

    const events = await service.listEvents({
      principalId: "principal-1",
      provider: "outlook",
      ...range,
    });

    expect(events).toMatchObject([
      {
        id: "all-day",
        startsAt: "2026-01-02",
        endsAt: "2026-01-03",
        allDay: true,
        timeZone: "UTC",
      },
      ...Array.from({ length: 49 }, (_, index) => ({
        id: `first-page-${index}`,
        allDay: false,
        timeZone: null,
      })),
      { id: "timed", allDay: false, timeZone: "UTC" },
    ]);
    expect(events).toHaveLength(51);
    expect(proxy).toHaveBeenCalledTimes(2);
    expect(proxy.mock.calls[1]?.[0].path).toContain("%24skiptoken=opaque");
  });

  it("returns Outlook all-day boundaries in the original calendar timezone", async () => {
    const { service } = operations("outlook", [
      Response.json({
        value: [
          {
            id: "pacific-day",
            isAllDay: true,
            originalStartTimeZone: "Pacific Standard Time",
            originalEndTimeZone: "Pacific Standard Time",
            start: { dateTime: "2026-01-01T08:00:00", timeZone: "UTC" },
            end: { dateTime: "2026-01-02T08:00:00", timeZone: "UTC" },
          },
          {
            id: "tokyo-day",
            isAllDay: true,
            originalStartTimeZone: "Tokyo Standard Time",
            originalEndTimeZone: "Tokyo Standard Time",
            start: { dateTime: "2026-01-01T15:00:00", timeZone: "UTC" },
            end: { dateTime: "2026-01-02T15:00:00", timeZone: "UTC" },
          },
        ],
      }),
    ]);

    const events = await service.listEvents({
      principalId: "principal-1",
      provider: "outlook",
      ...range,
    });

    expect(events).toMatchObject([
      {
        id: "pacific-day",
        startsAt: "2026-01-01",
        endsAt: "2026-01-02",
        allDay: true,
        timeZone: "America/Los_Angeles",
      },
      {
        id: "tokyo-day",
        startsAt: "2026-01-02",
        endsAt: "2026-01-03",
        allDay: true,
        timeZone: "Asia/Tokyo",
      },
    ]);
  });

  it("fails clearly rather than treating an unmapped Outlook zone as UTC", async () => {
    const { service } = operations("outlook", [
      Response.json({
        value: [
          {
            id: "unknown-zone",
            isAllDay: true,
            originalStartTimeZone: "Unmapped Standard Time",
            originalEndTimeZone: "Unmapped Standard Time",
            start: { dateTime: "2026-01-01T00:00:00", timeZone: "UTC" },
            end: { dateTime: "2026-01-02T00:00:00", timeZone: "UTC" },
          },
        ],
      }),
    ]);

    await expect(
      service.listEvents({
        principalId: "principal-1",
        provider: "outlook",
        ...range,
      }),
    ).rejects.toThrow("The Outlook event timezone is unsupported");
  });

  it("rejects provider ranges longer than 62 days with an explicit input error", async () => {
    const { service, proxy } = operations("outlook", []);

    await expect(
      service.listEvents({
        principalId: "principal-1",
        provider: "outlook",
        from: new Date("2026-01-01T00:00:00.000Z"),
        to: new Date("2026-03-05T00:00:00.000Z"),
      }),
    ).rejects.toThrow("The calendar range cannot exceed 62 days");
    expect(proxy).not.toHaveBeenCalled();
  });

  it.each([
    [
      "foreign host",
      "https://attacker.example/v1.0/me/calendarView?%24skiptoken=x",
    ],
    [
      "different range",
      "https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=2026-02-01T00%3A00%3A00.000Z&endDateTime=2026-03-01T00%3A00%3A00.000Z&%24skiptoken=x",
    ],
    [
      "malformed property expansion",
      outlookCalendarContinuation({
        $expand:
          "singleValueExtendedProperties($filter=id eq 'String {00000000-0000-0000-0000-000000000000} Name OtherProperty')",
      }),
    ],
    [
      "malformed projection",
      outlookCalendarContinuation({ $select: "id,subject,start,end" }),
    ],
  ])(
    "rejects an unsafe Outlook continuation (%s)",
    async (_label, nextLink) => {
      const { service, proxy } = operations("outlook", [
        Response.json({ value: [], "@odata.nextLink": nextLink }),
      ]);

      await expect(
        service.listEvents({
          principalId: "principal-1",
          provider: "outlook",
          ...range,
        }),
      ).rejects.toThrow();
      expect(proxy).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects repeated Google page tokens instead of looping", async () => {
    const { service, proxy } = operations("google_calendar", [
      Response.json({ items: [], nextPageToken: "same" }),
      Response.json({ items: [], nextPageToken: "same" }),
    ]);

    await expect(
      service.listEvents({
        principalId: "principal-1",
        provider: "google_calendar",
        ...range,
      }),
    ).rejects.toThrow();
    expect(proxy).toHaveBeenCalledTimes(2);
  });

  it("fails explicitly when provider page or event bounds would truncate results", async () => {
    const { service: tooManyEvents } = operations("google_calendar", [
      Response.json({
        items: Array.from({ length: 2001 }, (_, index) => ({
          id: `event-${index}`,
        })),
      }),
    ]);
    await expect(
      tooManyEvents.listEvents({
        principalId: "principal-1",
        provider: "google_calendar",
        ...range,
      }),
    ).rejects.toThrow(
      "The calendar contains more events than can be returned at once",
    );

    const { service: tooManyPages, proxy } = operations(
      "google_calendar",
      Array.from({ length: 20 }, (_, index) =>
        Response.json({ items: [], nextPageToken: `page-${index + 1}` }),
      ),
    );
    await expect(
      tooManyPages.listEvents({
        principalId: "principal-1",
        provider: "google_calendar",
        ...range,
      }),
    ).rejects.toThrow(
      "The calendar contains more pages than can be read at once",
    );
    expect(proxy).toHaveBeenCalledTimes(20);
  });
});
