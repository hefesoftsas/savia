import { describe, expect, it } from "vitest";
import {
  calendarPreferencesSchema,
  calendarRangeSchema,
  createCalendarSourceSchema,
  calendarLimits,
} from "../src/calendar-contracts";

describe("personal calendar contracts", () => {
  it("requires an explicit source kind and valid fallback timezone", () => {
    const input = {
      kind: "subscription",
      name: "Team",
      url: "webcal://calendar.example.org/team.ics",
      timeZone: "Europe/Madrid",
    };
    expect(createCalendarSourceSchema.parse(input).color).toBe("blue");
    expect(
      createCalendarSourceSchema.safeParse({
        ...input,
        timeZone: "Unknown/Zone",
      }).success,
    ).toBe(false);
    expect(
      createCalendarSourceSchema.safeParse({ ...input, kind: "import" })
        .success,
    ).toBe(false);
  });
  it("defaults provider visibility and rejects invalid settings", () => {
    expect(calendarPreferencesSchema.parse({})).toEqual({
      google_calendar: true,
      outlook: true,
    });
    expect(
      calendarPreferencesSchema.safeParse({ outlook: "yes" }).success,
    ).toBe(false);
  });
  it("rejects reversed or oversized calendar ranges", () => {
    const range = {
      from: "2026-10-01T00:00:00Z",
      to: "2026-11-12T00:00:00Z",
      timeZone: "UTC",
    };
    expect(calendarRangeSchema.safeParse(range).success).toBe(true);
    expect(
      calendarRangeSchema.safeParse({ ...range, to: range.from }).success,
    ).toBe(false);
    expect(
      calendarRangeSchema.safeParse({ ...range, to: "2027-01-01T00:00:00Z" })
        .success,
    ).toBe(false);
    expect(calendarLimits).toMatchObject({
      maxSources: 20,
      maxBytes: 1048576,
      maxEvents: 2000,
      maxDays: 62,
      maxRecurrenceSteps: 100000,
      maxProviderPages: 20,
    });
  });
});
