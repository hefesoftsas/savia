import { expect, it } from "vitest";
import {
  localInstant,
  slotsForDate,
  occupancyMinutes,
} from "../src/bookings/domain";
import { defaultSettings, settingsSchema } from "../src/bookings/contracts";
it("rejects nonexistent and ambiguous local times and respects fractional zone offsets", () => {
  expect(localInstant("2026-03-08", "02:30", "America/New_York")).toBeNull();
  expect(localInstant("2026-11-01", "01:30", "America/New_York")).toBeNull();
  expect(
    new Date(
      localInstant("2026-10-06", "09:00", "Asia/Kathmandu")!,
    ).toISOString(),
  ).toBe("2026-10-06T03:15:00.000Z");
});
it("uses date exceptions and requires the service plus buffer to fit working hours", () => {
  const settings = {
    ...defaultSettings("Appointments"),
    timeZone: "UTC",
    leadMinutes: 0,
    horizonDays: 10,
  };
  const pro = {
    id: crypto.randomUUID(),
    principalId: "user",
    enabled: true,
    weekly: [{ day: 2, start: "09:00", end: "10:00" }],
    exceptions: [],
  };
  const service = {
    id: crypto.randomUUID(),
    name: "Meeting",
    description: "",
    durationMinutes: 30,
    bufferMinutes: 15,
    enabled: true,
    professionalIds: [pro.id],
  };
  const slots = slotsForDate(
    settings,
    pro,
    service,
    "2026-10-06",
    [],
    Date.parse("2026-10-04T12:00:00Z"),
  );
  expect(slots.map((s) => s.startsAt)).toEqual([
    "2026-10-06T09:00:00.000Z",
    "2026-10-06T09:15:00.000Z",
  ]);
  expect(
    slotsForDate(
      settings,
      { ...pro, exceptions: [{ date: "2026-10-06", periods: [] }] },
      service,
      "2026-10-06",
      [],
      Date.parse("2026-10-04T12:00:00Z"),
    ),
  ).toEqual([]);
  expect(occupancyMinutes(slots[0].startsAt, slots[0].endsAt, 15)).toHaveLength(
    9,
  );
});
it("rejects duplicate professionals and overlapping working periods", () => {
  const pro = {
    id: crypto.randomUUID(),
    principalId: "user",
    enabled: true,
    weekly: [
      { day: 2, start: "09:00", end: "10:00" },
      { day: 2, start: "09:30", end: "11:00" },
    ],
    exceptions: [],
  };
  expect(
    settingsSchema.safeParse({
      ...defaultSettings("Bookings"),
      professionals: [pro],
    }).success,
  ).toBe(false);
  expect(
    settingsSchema.safeParse({
      ...defaultSettings("Bookings"),
      professionals: [
        { ...pro, weekly: [] },
        { ...pro, id: crypto.randomUUID(), weekly: [] },
      ],
    }).success,
  ).toBe(false);
});
