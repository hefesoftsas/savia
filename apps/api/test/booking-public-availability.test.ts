import { expect, it } from "vitest";
import {
  defaultSettings,
  type ResolvedBookingLink,
} from "../src/bookings/contracts";
import { getPublicAvailability } from "../src/bookings/public-availability";
function linkFixture(zone = "UTC"): ResolvedBookingLink {
  const settings = defaultSettings("Calendar fixture");
  settings.enabled = settings.published = true;
  settings.timeZone = zone;
  settings.leadMinutes = 0;
  settings.horizonDays = 180;
  settings.professionals = [
    {
      id: "00000000-0000-4000-8000-000000000002",
      principalId: "principal",
      enabled: true,
      weekly: Array.from({ length: 7 }, (_, day) => ({
        day,
        start: "00:00",
        end: "23:00",
      })),
      exceptions: [],
    },
  ];
  settings.services = [
    {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Consultation",
      description: "",
      durationMinutes: 30,
      bufferMinutes: 15,
      enabled: true,
      professionalIds: ["00000000-0000-4000-8000-000000000002"],
    },
  ];
  return {
    id: "link",
    tenantId: 1,
    publicToken: "opaque",
    scope: {
      kind: "professional",
      professionalId: "00000000-0000-4000-8000-000000000002",
    },
    serviceId: null,
    dailyLimit: 25,
    settings,
    legacy: false,
  };
}
it("fetches busy intervals once for a month and omits occupied slots", async () => {
  const link = linkFixture(),
    calls: any[] = [];
  const result = await getPublicAvailability(
    link,
    {
      serviceId: "00000000-0000-4000-8000-000000000001",
      from: "2026-10-01",
      to: "2026-10-31",
    },
    {
      now: () => Date.parse("2026-09-30T00:00:00Z"),
      loadBusy: async (_p, from, to) => {
        calls.push({ from, to });
        return [{ start: "2026-10-04T09:00:00Z", end: "2026-10-04T10:00:00Z" }];
      },
    },
  );
  expect(calls).toHaveLength(1);
  expect(result.days).toHaveLength(31);
  const day = result.days.find((d) => d.date === "2026-10-04")!;
  expect(day.slots.some((s) => s.startsAt === "2026-10-04T09:00:00.000Z")).toBe(
    false,
  );
  expect(day.slots.some((s) => s.startsAt === "2026-10-04T10:00:00.000Z")).toBe(
    true,
  );
});
it("groups cross-midnight slots by display zone instead of business dates", async () => {
  const result = await getPublicAvailability(
    linkFixture(),
    {
      serviceId: "00000000-0000-4000-8000-000000000001",
      from: "2026-10-04",
      to: "2026-10-04",
      displayTimeZone: "America/Bogota",
    },
    { now: () => Date.parse("2026-10-01T00:00:00Z"), loadBusy: async () => [] },
  );
  expect(result.days[0].slots[0].startsAt).toBe("2026-10-04T05:00:00.000Z");
  expect(
    result.days[0].slots.some((s) => s.startsAt === "2026-10-05T04:00:00.000Z"),
  ).toBe(true);
  expect(
    result.days[0].slots.some((s) => s.startsAt === "2026-10-04T00:00:00.000Z"),
  ).toBe(false);
});
it("preserves distinct UTC identities for repeated display-zone hours", async () => {
  const result = await getPublicAvailability(
    linkFixture(),
    {
      serviceId: "00000000-0000-4000-8000-000000000001",
      from: "2026-11-01",
      to: "2026-11-01",
      displayTimeZone: "America/New_York",
    },
    { now: () => Date.parse("2026-10-01T00:00:00Z"), loadBusy: async () => [] },
  );
  const slots = result.days[0].slots;
  expect(slots.some((s) => s.startsAt === "2026-11-01T05:00:00.000Z")).toBe(
    true,
  );
  expect(slots.some((s) => s.startsAt === "2026-11-01T06:00:00.000Z")).toBe(
    true,
  );
});
it("propagates provider failure instead of returning free days", async () => {
  await expect(
    getPublicAvailability(
      linkFixture(),
      {
        serviceId: "00000000-0000-4000-8000-000000000001",
        from: "2026-10-04",
        to: "2026-10-04",
      },
      {
        now: () => Date.parse("2026-10-01T00:00:00Z"),
        loadBusy: async () => {
          throw Error("provider unavailable");
        },
      },
    ),
  ).rejects.toThrow();
});
it("validates range and display zone and respects date exceptions and horizon", async () => {
  const link = linkFixture();
  link.settings.horizonDays = 3;
  link.settings.professionals[0].exceptions = [
    { date: "2026-10-02", periods: [] },
  ];
  const deps = {
    now: () => Date.parse("2026-10-01T00:00:00Z"),
    loadBusy: async () => [],
  };
  await expect(
    getPublicAvailability(
      link,
      {
        serviceId: "00000000-0000-4000-8000-000000000001",
        from: "2026-10-01",
        to: "2026-11-01",
      },
      deps,
    ),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    getPublicAvailability(
      link,
      {
        serviceId: "00000000-0000-4000-8000-000000000001",
        from: "2026-10-01",
        to: "2026-10-02",
        displayTimeZone: "Not/AZone",
      },
      deps,
    ),
  ).rejects.toMatchObject({ status: 422 });
  const result = await getPublicAvailability(
    link,
    {
      serviceId: "00000000-0000-4000-8000-000000000001",
      from: "2026-10-01",
      to: "2026-10-10",
    },
    deps,
  );
  expect(result.days.find((d) => d.date === "2026-10-02")!.slots).toEqual([]);
  expect(result.days.find((d) => d.date === "2026-10-05")!.slots).toEqual([]);
});
