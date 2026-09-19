import { it, expect } from "vitest";
import { toICS, validateEvent } from "../src/domain";
const event = {
  id: "one",
  title: "Meeting, team; review\nNext",
  start: "2026-11-01T01:30:00-04:00",
  end: "2026-11-01T01:30:00-05:00",
  description: "Hello",
  timeZone: "America/New_York",
};
it("preserves distinct DST instants and escapes ICS text", () => {
  const ics = toICS(event);
  expect(ics).toContain("DTSTART:20261101T053000Z");
  expect(ics).toContain("DTEND:20261101T063000Z");
  expect(ics).toContain("SUMMARY:Meeting\\, team\\; review\\nNext");
});
it("rejects ambiguous times and backwards intervals", () => {
  expect(() =>
    validateEvent({ ...event, start: "2026-11-01T01:30:00" }),
  ).toThrow();
  expect(() => validateEvent({ ...event, end: event.start })).toThrow();
});
import { syncOperationKey } from "../src/domain";
it("retries the same saved revision with the same key and distinguishes edited revisions", () => {
  expect(syncOperationKey("event", 3)).toBe(syncOperationKey("event", 3));
  expect(syncOperationKey("event", 3)).not.toBe(syncOperationKey("event", 4));
  expect(() => syncOperationKey("event", undefined)).toThrow();
});
it("rejects invalid end instants, normalized calendar dates, and out-of-range offsets", () => {
  for (const end of [
    "2026-13-01T10:00:00Z",
    "2027-02-30T10:00:00Z",
    "2027-01-01T10:00:00+15:00",
  ]) {
    expect(() => validateEvent({ ...event, end })).toThrow();
  }
});
import { localToInstant, instantToLocal } from "../src/domain";
it("converts Bogota local input independently of the browser timezone", () => {
  expect(localToInstant("2026-09-20T09:30", "America/Bogota")).toBe(
    "2026-09-20T14:30:00.000Z",
  );
  expect(instantToLocal("2026-09-20T14:30:00Z", "America/Bogota")).toBe(
    "2026-09-20T09:30",
  );
});
it("rejects nonexistent and repeated New York local times without guessing", () => {
  expect(() => localToInstant("2026-03-08T02:30", "America/New_York")).toThrow(
    "no existe",
  );
  expect(() => localToInstant("2026-11-01T01:30", "America/New_York")).toThrow(
    "dos veces",
  );
});
it("formats stored instants in the chosen timezone and validates local dates", () => {
  expect(instantToLocal("2026-11-01T06:30:00Z", "America/New_York")).toBe(
    "2026-11-01T01:30",
  );
  expect(() => localToInstant("2026-02-30T09:00", "America/Bogota")).toThrow();
  expect(localToInstant("2026-09-20T09:30", "Asia/Kathmandu")).toBe(
    "2026-09-20T03:45:00.000Z",
  );
});
