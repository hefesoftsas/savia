import { describe, expect, it } from "vitest";
import {
  calendarRange,
  calendarDays,
  moveCalendarDate,
  eventsForDay,
  dateKey,
} from "./calendar-dates";
import type { CalendarOccurrence } from "@savia/studio-shared/calendar-contracts";

describe("calendar date boundaries", () => {
  it("starts weeks on Monday across year boundaries", () => {
    const range = calendarRange(new Date(2027, 0, 1), "week");
    expect(dateKey(range.start)).toBe("2026-12-28");
    expect(dateKey(range.end)).toBe("2027-01-04");
    expect(calendarDays(range.start, range.end)).toHaveLength(7);
  });
  it("includes whole weeks touching a month", () => {
    const range = calendarRange(new Date(2026, 7, 31), "month");
    expect(dateKey(range.start)).toBe("2026-07-27");
    expect(dateKey(range.end)).toBe("2026-09-07");
    expect(calendarDays(range.start, range.end)).toHaveLength(42);
  });
  it("clamps January 31 when moving into February", () => {
    expect(dateKey(moveCalendarDate(new Date(2026, 0, 31), "month", 1))).toBe(
      "2026-02-28",
    );
    expect(dateKey(moveCalendarDate(new Date(2026, 11, 31), "month", 1))).toBe(
      "2027-01-31",
    );
  });
  it("uses exclusive all-day ends and includes events overlapping a day", () => {
    const allDay: CalendarOccurrence = {
      id: "one",
      sourceId: "team",
      title: "Holiday",
      startsAt: "2026-10-02",
      endsAt: "2026-10-04",
      allDay: true,
      timeZone: "UTC",
      webLink: null,
    };
    expect(eventsForDay([allDay], new Date(2026, 9, 3))).toEqual([allDay]);
    expect(eventsForDay([allDay], new Date(2026, 9, 4))).toEqual([]);
    const timed = {
      ...allDay,
      allDay: false,
      startsAt: new Date(2026, 9, 2, 23).toISOString(),
      endsAt: new Date(2026, 9, 3, 1).toISOString(),
    };
    expect(eventsForDay([timed], new Date(2026, 9, 3))).toEqual([timed]);
  });
});
