import { describe, expect, it } from "vitest";
import { expandCalendar } from "../src/personal-calendars/ical";

const calendar = (events: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events}\r\nEND:VCALENDAR`;

describe("iCalendar expansion", () => {
  it("inherits a recurring event's free status unless an exception overrides it", () => {
    const result = expandCalendar(
      calendar(
        `BEGIN:VEVENT\r\nUID:free\r\nDTSTART:20261005T090000Z\r\nDTEND:20261005T100000Z\r\nRRULE:FREQ=DAILY;COUNT=2\r\nTRANSP:TRANSPARENT\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:free\r\nRECURRENCE-ID:20261006T090000Z\r\nDTSTART:20261006T110000Z\r\nDTEND:20261006T120000Z\r\nEND:VEVENT`,
      ),
      {
        sourceId: "source",
        from: "2026-10-05T00:00:00Z",
        to: "2026-10-07T00:00:00Z",
        timeZone: "UTC",
      },
    );
    expect(result).toHaveLength(2);
    expect(result.map((event) => event.busy)).toEqual([false, false]);
  });
  it("expands recurring occurrences with exclusions and stable original identities", () => {
    const result = expandCalendar(
      calendar(
        `BEGIN:VEVENT\r\nUID:weekly\r\nDTSTART:20261005T090000Z\r\nDTEND:20261005T100000Z\r\nRRULE:FREQ=WEEKLY;COUNT=4\r\nEXDATE:20261012T090000Z\r\nSUMMARY:Weekly\r\nEND:VEVENT`,
      ),
      {
        sourceId: "source-1",
        from: "2026-10-01T00:00:00.000Z",
        to: "2026-11-01T00:00:00.000Z",
        timeZone: "UTC",
      },
    );

    expect(result.map((event) => event.startsAt)).toEqual([
      "2026-10-05T09:00:00.000Z",
      "2026-10-19T09:00:00.000Z",
      "2026-10-26T09:00:00.000Z",
    ]);
    expect(new Set(result.map((event) => event.id)).size).toBe(3);
  });

  it("keeps all-day dates exclusive and includes events overlapping the range", () => {
    const result = expandCalendar(
      calendar(
        `BEGIN:VEVENT\r\nUID:all-day\r\nDTSTART;VALUE=DATE:20261004\r\nDTEND;VALUE=DATE:20261007\r\nSUMMARY:Conference\r\nEND:VEVENT`,
      ),
      {
        sourceId: "source-1",
        from: "2026-10-06T00:00:00.000Z",
        to: "2026-10-07T00:00:00.000Z",
        timeZone: "America/Los_Angeles",
      },
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      startsAt: "2026-10-04",
      endsAt: "2026-10-07",
      allDay: true,
      title: "Conference",
      timeZone: "America/Los_Angeles",
    });
  });

  it("moves detached exceptions into the requested range and preserves the recurrence identity", () => {
    const result = expandCalendar(
      calendar(
        `BEGIN:VEVENT\r\nUID:moved\r\nDTSTART:20261001T090000Z\r\nDTEND:20261001T100000Z\r\nRRULE:FREQ=DAILY;COUNT=10\r\nSUMMARY:Moved meeting\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:moved\r\nRECURRENCE-ID:20261002T090000Z\r\nDTSTART:20261020T120000Z\r\nDTEND:20261020T130000Z\r\nSUMMARY:Moved meeting\r\nEND:VEVENT`,
      ),
      {
        sourceId: "source-1",
        from: "2026-10-20T00:00:00.000Z",
        to: "2026-10-21T00:00:00.000Z",
        timeZone: "UTC",
      },
    );

    expect(result).toHaveLength(1);
    expect(result[0].startsAt).toBe("2026-10-20T12:00:00.000Z");
    expect(result[0].id).toContain("2026-10-02T09:00:00Z");
  });

  it("suppresses a cancelled detached recurrence instance", () => {
    const result = expandCalendar(
      calendar(
        `BEGIN:VEVENT\r\nUID:cancelled\r\nDTSTART:20261001T090000Z\r\nDTEND:20261001T100000Z\r\nRRULE:FREQ=DAILY;COUNT=5\r\nSUMMARY:Daily\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:cancelled\r\nRECURRENCE-ID:20261003T090000Z\r\nDTSTART:20261003T090000Z\r\nDTEND:20261003T100000Z\r\nSTATUS:CANCELLED\r\nEND:VEVENT`,
      ),
      {
        sourceId: "source-1",
        from: "2026-10-03T00:00:00.000Z",
        to: "2026-10-04T00:00:00.000Z",
        timeZone: "UTC",
      },
    );
    expect(result).toEqual([]);
  });

  it("does not show an original occurrence moved outside the requested range", () => {
    const result = expandCalendar(
      calendar(
        `BEGIN:VEVENT\r\nUID:moved-out\r\nDTSTART:20261001T090000Z\r\nDTEND:20261001T100000Z\r\nRRULE:FREQ=DAILY;COUNT=5\r\nSUMMARY:Daily\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:moved-out\r\nRECURRENCE-ID:20261003T090000Z\r\nDTSTART:20261020T090000Z\r\nDTEND:20261020T100000Z\r\nSUMMARY:Moved away\r\nEND:VEVENT`,
      ),
      {
        sourceId: "source-1",
        from: "2026-10-03T00:00:00.000Z",
        to: "2026-10-04T00:00:00.000Z",
        timeZone: "UTC",
      },
    );
    expect(result).toEqual([]);
  });

  it("includes a zero-duration event whose start is on the range boundary", () => {
    const result = expandCalendar(
      calendar(
        `BEGIN:VEVENT\r\nUID:instant\r\nDTSTART:20261003T000000Z\r\nSUMMARY:Reminder\r\nEND:VEVENT`,
      ),
      {
        sourceId: "source-1",
        from: "2026-10-03T00:00:00.000Z",
        to: "2026-10-04T00:00:00.000Z",
        timeZone: "UTC",
      },
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      startsAt: "2026-10-03T00:00:00.000Z",
      endsAt: "2026-10-03T00:00:00.000Z",
    });
  });

  it("resolves IANA timezone values across daylight-saving changes", () => {
    const result = expandCalendar(
      calendar(
        `BEGIN:VEVENT\r\nUID:iana-zone\r\nDTSTART;TZID=America/New_York:20260308T090000\r\nDTEND;TZID=America/New_York:20260308T100000\r\nSUMMARY:Morning\r\nEND:VEVENT`,
      ),
      {
        sourceId: "source-1",
        from: "2026-03-08T00:00:00.000Z",
        to: "2026-03-09T00:00:00.000Z",
        timeZone: "UTC",
      },
    );
    expect(result[0]).toMatchObject({
      startsAt: "2026-03-08T13:00:00.000Z",
      endsAt: "2026-03-08T14:00:00.000Z",
      timeZone: "America/New_York",
    });
  });

  it("uses an embedded VTIMEZONE definition for event instants", () => {
    const result = expandCalendar(
      `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTIMEZONE\r\nTZID:Custom/PlusTwo\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0200\r\nTZNAME:PLUS2\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT\r\nUID:embedded\r\nDTSTART;TZID=Custom/PlusTwo:20261003T090000\r\nDTEND;TZID=Custom/PlusTwo:20261003T100000\r\nSUMMARY:Embedded zone\r\nEND:VEVENT\r\nEND:VCALENDAR`,
      {
        sourceId: "source-1",
        from: "2026-10-03T00:00:00.000Z",
        to: "2026-10-04T00:00:00.000Z",
        timeZone: "UTC",
      },
    );
    expect(result[0]).toMatchObject({
      startsAt: "2026-10-03T07:00:00.000Z",
      endsAt: "2026-10-03T08:00:00.000Z",
      timeZone: "Custom/PlusTwo",
    });
  });

  it("resolves floating wall times at a month end without crossing UTC boundaries", () => {
    const result = expandCalendar(
      calendar(
        `BEGIN:VEVENT\r\nUID:madrid\r\nDTSTART:20261031T003000\r\nDTEND:20261031T013000\r\nSUMMARY:Month end\r\nEND:VEVENT`,
      ),
      {
        sourceId: "source-1",
        from: "2026-10-30T00:00:00.000Z",
        to: "2026-11-01T00:00:00.000Z",
        timeZone: "Europe/Madrid",
      },
    );
    expect(result[0]).toMatchObject({
      startsAt: "2026-10-30T23:30:00.000Z",
      endsAt: "2026-10-31T00:30:00.000Z",
    });
  });

  it("resolves floating local times in the source fallback timezone", () => {
    const result = expandCalendar(
      calendar(
        `BEGIN:VEVENT\r\nUID:floating\r\nDTSTART:20261003T090000\r\nDTEND:20261003T100000\r\nSUMMARY:Floating\r\nEND:VEVENT`,
      ),
      {
        sourceId: "source-1",
        from: "2026-10-03T00:00:00.000Z",
        to: "2026-10-04T00:00:00.000Z",
        timeZone: "America/New_York",
      },
    );
    expect(result[0]).toMatchObject({
      startsAt: "2026-10-03T13:00:00.000Z",
      timeZone: "America/New_York",
    });
  });

  it("rejects a range that exceeds the visible query limit", () => {
    expect(() =>
      expandCalendar(calendar(""), {
        sourceId: "source-1",
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-03-05T00:00:00.000Z",
        timeZone: "UTC",
      }),
    ).toThrow(/62/);
  });
});
